// CAOTAYTANG — multi-vhost TLS forwarding proxy with Cloudflare scrubbing.
// Dispatches per Host header to an upstream origin. Forwards http/https/ws/wss.
// Config + dashboard at http://127.0.0.1:<ADMIN_PORT> (default 9000).
//
// Prereqs:
//   1. Local DNS (dnsmasq) or /etc/hosts mapping each vhost (or *.own_lab.htb)
//      to 127.0.0.1.
//   2. Cert at certs/mylab.{crt,key} with SANs covering every vhost
//      (use *.own_lab.htb SAN for wildcard routing).
//   3. npm install
//
// Run:
//   PORT=8765 ADMIN_PORT=9000 node proxy.js
//
// Routes support exact host match and "*.suffix" wildcard. Suffix match is
// the fallback when no exact match exists; longest suffix wins.

const https = require('https');
const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');
const { agentFor } = require('./agents');
const config = require('./config');
const logger = require('./logger');
const startAdmin = require('./admin');

const PORT       = parseInt(process.env.PORT || '8765', 10);
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '9000', 10);
const CERT_DIR   = process.env.CERT_DIR || path.join(__dirname, 'certs');
const CERT       = process.env.CERT || path.join(CERT_DIR, 'mylab.crt');
const KEY        = process.env.KEY  || path.join(CERT_DIR, 'mylab.key');

// Rewrite a URL string that points at upstream host to point at the
// host the client used (so redirects keep traffic on the proxy).
function rewriteUpstreamUrl(value, target, requestHost) {
  if (!value || !target || !requestHost) return value;
  try {
    const t = new URL(target);
    const u = new URL(value, target);
    if (u.host !== t.host) return value;
    u.protocol = 'https:';
    u.host = requestHost; // includes port
    return u.toString();
  } catch {
    return value;
  }
}

// Strip or rewrite cookie attributes that pin the cookie to the upstream host.
function rewriteSetCookie(cookie, target, requestHost) {
  if (!target) return cookie;
  let t;
  try { t = new URL(target); } catch { return cookie; }
  const reqHostName = (requestHost || '').split(':')[0];
  return cookie
    .split(';')
    .map(part => {
      const [k, ...rest] = part.split('=');
      const name = k.trim().toLowerCase();
      if (name === 'domain') {
        const dom = rest.join('=').trim().replace(/^\./, '').toLowerCase();
        if (dom === t.hostname || t.hostname.endsWith('.' + dom)) {
          return ` Domain=${reqHostName}`;
        }
      }
      return part;
    })
    .join(';');
}

function filterHeaders(headers, req) {
  const c = config.compiled;
  const target = req && req._proxyTarget;
  const reqHost = req && req.headers && req.headers.host;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (c.stripHeaders.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  out['server'] = c.serverDecoy;

  if (out['location']) {
    out['location'] = rewriteUpstreamUrl(out['location'], target, reqHost);
  }

  const sc = out['set-cookie'];
  if (sc) {
    const arr = Array.isArray(sc) ? sc : [sc];
    const kept = arr
      .filter(ck => {
        const name = ck.split('=')[0].trim().toLowerCase();
        return !c.stripCookies.includes(name);
      })
      .map(ck => rewriteSetCookie(ck, target, reqHost));
    if (kept.length) out['set-cookie'] = kept;
    else delete out['set-cookie'];
  }
  return out;
}

function scrubBody(buf) {
  let s = buf.toString('utf8');
  for (const [re, sub] of config.compiled.bodyPatterns) s = s.replace(re, sub);
  return Buffer.from(s, 'utf8');
}

function isScrubbableType(ct) {
  ct = (ct || '').toLowerCase();
  return ct.includes('text/html')
      || ct.includes('text/plain')
      || ct.includes('text/css')
      || ct.includes('application/json')
      || ct.includes('application/javascript')
      || ct.includes('text/javascript')
      || ct.includes('application/xml')
      || ct.includes('text/xml');
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  secure: false,
  xfwd: false,
  followRedirects: false,
  selfHandleResponse: true,
  proxyTimeout: 30000,
  timeout: 30000,
});


proxy.on('proxyReq', (proxyReq, req) => {
  proxyReq.removeHeader('via');
  proxyReq.removeHeader('forwarded');
  proxyReq.removeHeader('x-forwarded-for');
  proxyReq.removeHeader('x-forwarded-host');
  proxyReq.removeHeader('x-forwarded-proto');
  if (config.compiled.scrubBody) {
    proxyReq.setHeader('accept-encoding', 'identity');
  }
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  const headers = filterHeaders(proxyRes.headers, req);
  const wantScrub = config.compiled.scrubBody && isScrubbableType(proxyRes.headers['content-type']);

  logger.log({
    host: req.headers.host,
    method: req.method,
    url: req.url,
    status: proxyRes.statusCode,
    scrubbed: wantScrub,
  });

  if (!wantScrub) {
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
    return;
  }

  const chunks = [];
  proxyRes.on('data', c => chunks.push(c));
  proxyRes.on('end', () => {
    const body = scrubBody(Buffer.concat(chunks));
    delete headers['content-length'];
    delete headers['content-encoding'];
    res.writeHead(proxyRes.statusCode, headers);
    res.end(body);
  });
  proxyRes.on('error', e => {
    console.error('[proxyRes error]', e.message);
    res.destroy();
  });
});

proxy.on('error', (err, req, res) => {
  console.error('[proxy error]', err.message);
  logger.log({
    host: req && req.headers && req.headers.host,
    method: req && req.method,
    url: req && req.url,
    error: err.message,
  });
  if (res && !res.headersSent && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway: ' + err.message);
  } else if (res && res.destroy) {
    res.destroy();
  }
});

// Route resolution: exact host match wins, then longest "*.suffix" wildcard.
function resolveTarget(req) {
  const raw = (req.headers.host || '').toLowerCase();
  const host = raw.split(':')[0];
  const routes = config.compiled.routes;
  if (routes[host]) return routes[host];
  let bestKey = null;
  for (const k of Object.keys(routes)) {
    if (!k.startsWith('*.')) continue;
    const suffix = k.slice(1); // ".own_lab.htb"
    if (host.endsWith(suffix) && (!bestKey || suffix.length > bestKey.length - 1)) {
      bestKey = k;
    }
  }
  return bestKey ? routes[bestKey] : null;
}

const tlsOptions = {
  cert: fs.readFileSync(CERT),
  key:  fs.readFileSync(KEY),
};

const server = https.createServer(tlsOptions, (req, res) => {
  const target = resolveTarget(req);
  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`No route for Host: ${req.headers.host}\n`);
    return;
  }
  req._proxyTarget = target;
  proxy.web(req, res, { target, agent: agentFor(target) });
});

server.on('upgrade', (req, socket, head) => {
  const target = resolveTarget(req);
  if (!target) {
    socket.destroy();
    return;
  }
  req._proxyTarget = target;
  proxy.ws(req, socket, head, { target, agent: agentFor(target) });
});

config.on('change', d => {
  console.log('[config] reloaded');
  logger.log({ event: 'config-reload', routes: Object.keys(d.routes).length });
});

server.listen(PORT, () => {
  console.log(`CAOTAYTANG · multi-vhost TLS proxy on :${PORT}  (SCRUB_BODY=${config.compiled.scrubBody ? 'on' : 'off'})`);
  for (const [host, target] of Object.entries(config.compiled.routes)) {
    console.log(`  https://${host}:${PORT}  ->  ${target}`);
  }
});

startAdmin(ADMIN_PORT);
