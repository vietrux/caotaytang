#!/usr/bin/env node
// CLI for managing proxy routes in config.json.
// Writes directly to disk; the running proxy's fs.watch reloads on change.
// Use --reload to also poke the admin API (flushes upstream agents).

const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '9000', 10);

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    die(`config not found: ${CONFIG_PATH}`);
  }
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

function validateHost(host) {
  if (!host || typeof host !== 'string') die('host required');
  if (!/^[a-z0-9.*_-]+$/i.test(host)) die(`invalid host: ${host}`);
  return host.toLowerCase();
}

function validateTarget(target) {
  if (!target || typeof target !== 'string') die('target required');
  if (!/^https?:\/\//i.test(target)) die(`target must start with http:// or https:// : ${target}`);
  try { new URL(target); } catch { die(`invalid target URL: ${target}`); }
  return target;
}

function reloadProxy() {
  return new Promise(resolve => {
    const req = http.request(
      { host: '127.0.0.1', port: ADMIN_PORT, path: '/api/reload', method: 'POST', timeout: 2000 },
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

function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function usage() {
  process.stdout.write(`usage: caotaytang <command> [args] [--reload]

commands:
  list                              print all routes
  add <host> <target> [--reload]    add or overwrite a route
  remove <host> [--reload]          remove a route
  reload                            POST /api/reload to running proxy

env:
  CONFIG_PATH   path to config.json (default: ./config.json)
  ADMIN_PORT    admin port for --reload (default: 9000)

examples:
  caotaytang add concak.own_lab.htb https://example.com/
  caotaytang remove concak.own_lab.htb --reload
  caotaytang list
`);
}

async function main() {
  const args = process.argv.slice(2);
  const reloadFlag = args.includes('--reload');
  const positional = args.filter(a => a !== '--reload');
  const cmd = positional[0];

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    usage();
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'list') {
    const cfg = loadConfig();
    const routes = cfg.routes || {};
    const keys = Object.keys(routes).sort();
    if (!keys.length) {
      process.stdout.write('(no routes)\n');
      return;
    }
    const w = Math.max(...keys.map(k => k.length));
    for (const k of keys) {
      process.stdout.write(`${k.padEnd(w)}  ->  ${routes[k]}\n`);
    }
    return;
  }

  if (cmd === 'add') {
    const host = validateHost(positional[1]);
    const target = validateTarget(positional[2]);
    const cfg = loadConfig();
    cfg.routes = cfg.routes || {};
    const existed = cfg.routes[host];
    cfg.routes[host] = target;
    saveConfig(cfg);
    process.stdout.write(`${existed ? 'updated' : 'added'} ${host} -> ${target}\n`);
  } else if (cmd === 'remove' || cmd === 'rm' || cmd === 'del') {
    const host = validateHost(positional[1]);
    const cfg = loadConfig();
    if (!cfg.routes || !(host in cfg.routes)) die(`route not found: ${host}`);
    delete cfg.routes[host];
    saveConfig(cfg);
    process.stdout.write(`removed ${host}\n`);
  } else if (cmd === 'reload') {
    const r = await reloadProxy();
    if (r.ok) process.stdout.write(`reloaded: ${r.body}\n`);
    else die(`reload failed: ${r.error || r.status}`);
    return;
  } else {
    die(`unknown command: ${cmd}`);
  }

  if (reloadFlag) {
    const r = await reloadProxy();
    if (r.ok) process.stdout.write(`reloaded admin\n`);
    else process.stderr.write(`warn: reload skipped (${r.error || r.status}); fs.watch will pick up change\n`);
  }
}

main().catch(e => die(e.message));
