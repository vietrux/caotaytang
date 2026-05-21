#!/usr/bin/env node
// CLI for managing CAOTAYTANG routes + TCP services in config.json.
// Writes directly to disk; the running proxy's fs.watch reloads on change.
// Use --reload to also flush upstream keep-alive sockets via the admin API.

const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '9000', 10);

// ---------- io ----------

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) die(`config not found: ${CONFIG_PATH}`);
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    die(`config parse error: ${e.message}`);
  }
}

function saveConfig(cfg) {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

function adminRequest(method, path) {
  return new Promise(resolve => {
    const req = http.request(
      { host: '127.0.0.1', port: ADMIN_PORT, path, method, timeout: 2000 },
      res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body }));
      }
    );
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

const reloadProxy = () => adminRequest('POST', '/api/reload');
const getPreview  = () => adminRequest('GET',  '/api/preview');

function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function out(s) { process.stdout.write(s); }

// ---------- validators ----------

function validateHost(host) {
  if (!host || typeof host !== 'string') die('host required');
  if (!/^[a-z0-9.*_-]+$/i.test(host)) die(`invalid host: ${host}`);
  return host.toLowerCase();
}

function validateTarget(target) {
  if (!target || typeof target !== 'string') die('target required');
  if (/^https?:\/\//i.test(target)) {
    try { new URL(target); } catch { die(`invalid http target: ${target}`); }
    return target;
  }
  const m = target.match(/^(tcp|tls):\/\/(.+)$/i);
  if (m) {
    const scheme = m[1].toLowerCase();
    const rest = m[2];
    if (!/^[^/\s:]+:\d{1,5}$/.test(rest)) die(`${scheme}:// target must be host:port (got ${target})`);
    return `${scheme}://${rest}`;
  }
  die(`target scheme must be http(s)://, tls://, or tcp:// : ${target}`);
}

function validateHostPort(s) {
  if (!s || !/^[^/\s:]+:\d{1,5}$/.test(s)) die(`target must be host:port (got ${s})`);
  return s;
}

function validateSvcName(name) {
  if (!name || !/^[a-z0-9._-]+$/i.test(name)) die(`invalid service name: ${name}`);
  return name;
}

function targetKind(t) {
  if (!t) return '?';
  if (t.startsWith('tls://')) return 'tls-passthrough';
  if (t.startsWith('tcp://')) return 'tcp-terminate';
  if (/^https?:\/\//.test(t)) return 'http';
  return '?';
}

// ---------- flag parsing ----------

function parseArgs(argv) {
  const flags = { reload: false, json: false, port: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reload') flags.reload = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--port') {
      const v = argv[++i];
      if (!v) die('--port requires a value');
      const n = parseInt(v, 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) die(`--port must be 1-65535 (got ${v})`);
      flags.port = n;
    } else if (a.startsWith('--port=')) {
      const n = parseInt(a.slice(7), 10);
      if (!Number.isInteger(n) || n < 1 || n > 65535) die(`--port must be 1-65535`);
      flags.port = n;
    } else pos.push(a);
  }
  return { pos, flags };
}

// ---------- commands ----------

function cmdList({ json }) {
  const cfg = loadConfig();
  const routes = cfg.routes || {};
  const svcs   = cfg.tcpServices || [];

  if (json) {
    out(JSON.stringify({ routes, tcpServices: svcs }, null, 2) + '\n');
    return;
  }

  out('SNI routes:\n');
  const keys = Object.keys(routes).sort();
  if (!keys.length) {
    out('  (none)\n');
  } else {
    const w = Math.max(...keys.map(k => k.length));
    const kw = Math.max(...keys.map(k => targetKind(routes[k]).length), 'kind'.length);
    out(`  ${'host'.padEnd(w)}  ${'kind'.padEnd(kw)}  target\n`);
    for (const k of keys) {
      out(`  ${k.padEnd(w)}  ${targetKind(routes[k]).padEnd(kw)}  ${routes[k]}\n`);
    }
  }

  out('\nTCP services:\n');
  if (!svcs.length) {
    out('  (none)\n');
    return;
  }
  const nw = Math.max(...svcs.map(s => s.name.length), 'name'.length);
  const tw = Math.max(...svcs.map(s => s.target.length), 'target'.length);
  out(`  ${'name'.padEnd(nw)}  ${'listen'.padEnd(6)}  ${'target'.padEnd(tw)}\n`);
  for (const s of svcs) {
    const lp = s.listenPort != null ? String(s.listenPort) : 'auto';
    out(`  ${s.name.padEnd(nw)}  ${lp.padEnd(6)}  ${s.target}\n`);
  }
}

function cmdAdd(pos) {
  const host   = validateHost(pos[1]);
  const target = validateTarget(pos[2]);
  const cfg = loadConfig();
  cfg.routes = cfg.routes || {};
  const existed = cfg.routes[host];
  cfg.routes[host] = target;
  saveConfig(cfg);
  out(`${existed ? 'updated' : 'added'} ${host} [${targetKind(target)}] -> ${target}\n`);
}

function cmdRemove(pos) {
  const host = validateHost(pos[1]);
  const cfg = loadConfig();
  if (!cfg.routes || !(host in cfg.routes)) die(`route not found: ${host}`);
  delete cfg.routes[host];
  saveConfig(cfg);
  out(`removed ${host}\n`);
}

function cmdSvcList({ json }) {
  const cfg = loadConfig();
  const svcs = cfg.tcpServices || [];
  if (json) { out(JSON.stringify(svcs, null, 2) + '\n'); return; }
  if (!svcs.length) { out('(no services)\n'); return; }
  const nw = Math.max(...svcs.map(s => s.name.length), 'name'.length);
  const tw = Math.max(...svcs.map(s => s.target.length), 'target'.length);
  out(`${'name'.padEnd(nw)}  ${'listen'.padEnd(6)}  ${'target'.padEnd(tw)}\n`);
  for (const s of svcs) {
    const lp = s.listenPort != null ? String(s.listenPort) : 'auto';
    out(`${s.name.padEnd(nw)}  ${lp.padEnd(6)}  ${s.target}\n`);
  }
}

function cmdSvcAdd(pos, flags) {
  const name = validateSvcName(pos[2]);
  const target = validateHostPort(pos[3]);
  const cfg = loadConfig();
  cfg.tcpServices = cfg.tcpServices || [];
  const idx = cfg.tcpServices.findIndex(s => s.name === name);
  const entry = { name, target, type: 'tcp', listenPort: flags.port };
  if (idx >= 0) { cfg.tcpServices[idx] = entry; saveConfig(cfg); out(`updated svc ${name} -> ${target} (listen: ${entry.listenPort ?? 'auto'})\n`); }
  else { cfg.tcpServices.push(entry); saveConfig(cfg); out(`added svc ${name} -> ${target} (listen: ${entry.listenPort ?? 'auto on next start'})\n`); }
}

function cmdSvcRemove(pos) {
  const name = validateSvcName(pos[2]);
  const cfg = loadConfig();
  const arr = cfg.tcpServices || [];
  const idx = arr.findIndex(s => s.name === name);
  if (idx < 0) die(`service not found: ${name}`);
  arr.splice(idx, 1);
  cfg.tcpServices = arr;
  saveConfig(cfg);
  out(`removed svc ${name}\n`);
}

async function cmdStatus({ json }) {
  const r = await getPreview();
  if (!r.ok) die(`status failed: ${r.error || r.status}`);
  let p;
  try { p = JSON.parse(r.body); } catch { die(`status: bad JSON from admin`); }
  if (json) { out(JSON.stringify(p, null, 2) + '\n'); return; }
  out(`proxyPort        : ${p.proxyPort}\n`);
  out(`bodyPatterns     : ${p.bodyPatternCount}\n`);
  out(`autoPatterns     : ${(p.autoPatterns || []).length}\n`);
  out(`stripHeaders     : ${(p.effectiveStripHeaders || []).length}\n`);
  out(`stripCookies     : ${(p.effectiveStripCookies || []).length}\n`);
  out(`tcpServices      : ${(p.tcpServices || []).length} configured\n`);
  out(`tcpRunning       : ${(p.tcpRunning || []).length} listening\n`);
  for (const r of p.tcpRunning || []) out(`  ${r.name.padEnd(20)} :${r.port}\n`);
}

async function cmdReload() {
  const r = await reloadProxy();
  if (r.ok) out(`reloaded: ${r.body}\n`);
  else die(`reload failed: ${r.error || r.status}`);
}

// ---------- usage ----------

function usage() {
  out(`CAOTAYTANG CLI — manage routes and TCP services in config.json

usage: caotaytang <command> [args] [flags]

route commands:
  list [--json]                                 list SNI routes + TCP services
  add <host> <target> [--reload]                add/overwrite SNI route
  rm  <host> [--reload]                         remove SNI route

  <target> schemes:
    http://upstream            HTTP forward + scrub (Cloudflare/CDN cleanup)
    https://upstream           HTTPS forward + scrub
    tls://host:port            raw TLS pass-through (no decrypt)
    tcp://host:port            terminate TLS at proxy, forward as plain TCP

tcp service commands (plain-TCP listeners, no SNI):
  svc list [--json]                             list tcpServices
  svc add <name> <host:port> [--port N] [--reload]
                                                add/overwrite plain-TCP listener
  svc rm  <name> [--reload]                     remove tcpService

other:
  status [--json]                               show running listeners + scrub counts
  reload                                        POST /api/reload (flush keep-alive sockets)
  help                                          this help

flags:
  --reload                                      after editing config, hit admin /api/reload
  --json                                        machine-readable output (list / status)
  --port N                                      svc add: explicit listen port (else auto in range)

env:
  CONFIG_PATH   path to config.json (default: ./config.json)
  ADMIN_PORT    admin port for --reload / status (default: 9000)

examples:
  caotaytang add concak.own_lab.htb https://example.com/
  caotaytang add grpc.own_lab.htb   tls://10.0.0.2:443 --reload
  caotaytang add api.own_lab.htb    tcp://10.0.0.3:8080
  caotaytang svc add ssh-lab 10.0.0.1:22 --port 2222
  caotaytang svc add db-lab  10.0.0.4:5432            # auto-port
  caotaytang rm  concak.own_lab.htb --reload
  caotaytang status
  caotaytang list --json
`);
}

// ---------- dispatch ----------

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    usage();
    process.exit(cmd ? 0 : 1);
  }

  let mutated = false;

  if (cmd === 'list' || cmd === 'ls') {
    cmdList(flags);
  } else if (cmd === 'add') {
    cmdAdd(pos); mutated = true;
  } else if (cmd === 'remove' || cmd === 'rm' || cmd === 'del') {
    cmdRemove(pos); mutated = true;
  } else if (cmd === 'svc') {
    const sub = pos[1];
    if (sub === 'list' || sub === 'ls') cmdSvcList(flags);
    else if (sub === 'add') { cmdSvcAdd(pos, flags); mutated = true; }
    else if (sub === 'rm' || sub === 'remove' || sub === 'del') { cmdSvcRemove(pos); mutated = true; }
    else die(`unknown svc subcommand: ${sub || '(none)'} — try: svc list | add | rm`);
  } else if (cmd === 'status') {
    await cmdStatus(flags);
  } else if (cmd === 'reload') {
    await cmdReload();
  } else {
    die(`unknown command: ${cmd} — run 'caotaytang help'`);
  }

  if (mutated && flags.reload) {
    const r = await reloadProxy();
    if (r.ok) out(`reloaded admin\n`);
    else process.stderr.write(`warn: reload skipped (${r.error || r.status}); fs.watch will pick up change\n`);
  }
}

main().catch(e => die(e.message));
