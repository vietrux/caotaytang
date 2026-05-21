const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const agents = require('./agents');
const tcp = require('./tcp');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > 1024 * 1024) { req.destroy(); reject(new Error('payload too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  let rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { sendJson(res, 403, { error: 'forbidden' }); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { sendJson(res, 404, { error: 'not found' }); return; }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

function validateItemGroups(groups, label, itemKey) {
  if (!groups || typeof groups !== 'object') throw new Error(`${label} must be object`);
  for (const [gk, g] of Object.entries(groups)) {
    if (!g || typeof g !== 'object') throw new Error(`${label}.${gk} must be object`);
    if (typeof g.enabled !== 'boolean') throw new Error(`${label}.${gk}.enabled must be bool`);
    if (!Array.isArray(g[itemKey])) throw new Error(`${label}.${gk}.${itemKey} must be array`);
    if (itemKey === 'items') {
      for (const it of g.items) {
        if (typeof it !== 'string') throw new Error(`${label}.${gk}.items entries must be string`);
      }
    } else if (itemKey === 'patterns') {
      for (const p of g.patterns) {
        if (!p || typeof p.pattern !== 'string') throw new Error(`${label}.${gk}.patterns entry must have pattern string`);
        new RegExp(p.pattern, p.flags || 'g'); // throws on bad regex
      }
    }
  }
}

function validateConfig(body) {
  if (!body || typeof body !== 'object') throw new Error('body must be object');
  if (!body.routes || typeof body.routes !== 'object') throw new Error('routes must be object');
  for (const [k, v] of Object.entries(body.routes)) {
    if (typeof v !== 'string' || !/^(https?|tcp|tls):\/\//.test(v)) {
      throw new Error(`route ${k} target must be http(s)://, tcp://, or tls:// URL`);
    }
    if ((v.startsWith('tcp://') || v.startsWith('tls://')) && !/^(tcp|tls):\/\/[^/]+:\d{1,5}$/.test(v)) {
      throw new Error(`route ${k}: tcp/tls target must be scheme://host:port`);
    }
  }
  if (body.proxyPort != null && (!Number.isInteger(body.proxyPort) || body.proxyPort < 1 || body.proxyPort > 65535)) {
    throw new Error('proxyPort must be 1-65535');
  }
  validateItemGroups(body.stripHeaderGroups, 'stripHeaderGroups', 'items');
  validateItemGroups(body.stripCookieGroups, 'stripCookieGroups', 'items');
  validateItemGroups(body.bodyPatternGroups, 'bodyPatternGroups', 'patterns');
  validateTcpServices(body.tcpServices);
  validateTcpRange(body.tcpAutoPortRange);
}

function validateTcpServices(arr) {
  if (arr == null) return;
  if (!Array.isArray(arr)) throw new Error('tcpServices must be array');
  const names = new Set();
  const ports = new Set();
  for (const s of arr) {
    if (!s || typeof s !== 'object') throw new Error('tcpServices entry must be object');
    if (typeof s.name !== 'string' || !s.name) throw new Error('tcpServices.name required');
    if (names.has(s.name)) throw new Error(`tcpServices duplicate name: ${s.name}`);
    names.add(s.name);
    if (typeof s.target !== 'string' || !/^[^/\s:]+:\d{1,5}$/.test(s.target)) {
      throw new Error(`tcpServices ${s.name}: target must be host:port`);
    }
    if (s.type !== 'tcp') throw new Error(`tcpServices ${s.name}: type must be "tcp"`);
    if (s.listenPort != null) {
      if (!Number.isInteger(s.listenPort) || s.listenPort < 1 || s.listenPort > 65535) {
        throw new Error(`tcpServices ${s.name}: listenPort must be 1-65535 or null`);
      }
      if (ports.has(s.listenPort)) throw new Error(`tcpServices duplicate listenPort: ${s.listenPort}`);
      ports.add(s.listenPort);
    }
  }
}

function validateTcpRange(r) {
  if (r == null) return;
  if (!Array.isArray(r) || r.length !== 2) throw new Error('tcpAutoPortRange must be [lo, hi]');
  const [lo, hi] = r;
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > 65535 || lo >= hi) {
    throw new Error('tcpAutoPortRange invalid');
  }
}

async function handleApi(req, res, route) {
  if (route === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, config.data);
  }
  if (route === '/api/config' && req.method === 'PUT') {
    try {
      const body = await readJson(req);
      validateConfig(body);
      config.write(body);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (route === '/api/log' && req.method === 'GET') {
    return sendJson(res, 200, logger.recent());
  }
  if (route === '/api/reload' && req.method === 'POST') {
    config.reload();
    agents.destroyAll();
    logger.log({ event: 'manual-reload' });
    return sendJson(res, 200, { ok: true, routes: Object.keys(config.compiled.routes).length });
  }
  if (route === '/api/preview' && req.method === 'GET') {
    return sendJson(res, 200, {
      autoPatterns: config.compiled.autoPatternsPreview,
      effectiveStripHeaders: [...config.compiled.stripHeaders].sort(),
      effectiveStripCookies: [...config.compiled.stripCookies].sort(),
      bodyPatternCount: config.compiled.bodyPatterns.length,
      proxyPort: config.compiled.proxyPort,
      tcpServices: (config.data.tcpServices || []).map(s => ({
        name: s.name, target: s.target, type: s.type, listenPort: s.listenPort,
      })),
      tcpRunning: tcp.status(),
    });
  }
  if (route === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: {}\n\n`);
    const onLog = entry => res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    const onConfig = d => res.write(`event: config\ndata: ${JSON.stringify(d)}\n\n`);
    logger.on('log', onLog);
    config.on('change', onConfig);
    const ka = setInterval(() => res.write(`:ka\n\n`), 15000);
    req.on('close', () => {
      clearInterval(ka);
      logger.off('log', onLog);
      config.off('change', onConfig);
    });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
}

module.exports = function startAdmin(port) {
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/')) return handleApi(req, res, url);
    serveStatic(req, res);
  });
  srv.listen(port, '127.0.0.1', () => {
    console.log(`Admin dashboard on http://127.0.0.1:${port}`);
  });
  return srv;
};
