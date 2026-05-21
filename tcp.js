// Plain-TCP listeners with auto-port allocation. No SNI peek.
// Each entry: { name, target: "host:port", type: "tcp", listenPort: number|null }

const net = require('net');
const logger = require('./logger');

const listeners = new Map(); // name -> net.Server

function parseHostPort(s) {
  if (!s) return null;
  const i = s.lastIndexOf(':');
  if (i < 0) return null;
  const port = parseInt(s.slice(i + 1), 10);
  if (!port || port < 1 || port > 65535) return null;
  return { host: s.slice(0, i), port };
}

function pickFreePort(range, used) {
  const [lo, hi] = Array.isArray(range) && range.length === 2 ? range : [20000, 29999];
  for (let i = 0; i < 200; i++) {
    const p = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (!used.has(p)) return p;
  }
  return 0;
}

function startService(svc) {
  if (listeners.has(svc.name)) return;
  const target = parseHostPort(svc.target);
  if (!target) {
    logger.log({ event: 'tcp-skip', name: svc.name, reason: 'bad target' });
    return;
  }
  const srv = net.createServer(client => {
    const up = net.connect(target.port, target.host);
    const opened = Date.now();
    let bIn = 0, bOut = 0;
    up.on('error', e => {
      logger.log({ event: 'tcp-upstream-error', name: svc.name, error: e.message });
      client.destroy();
    });
    client.on('error', () => up.destroy());
    client.on('data', c => { bIn += c.length; });
    up.on('data', c => { bOut += c.length; });
    client.pipe(up).pipe(client);
    client.on('close', () => {
      logger.log({ event: 'tcp-close', name: svc.name, durMs: Date.now() - opened, in: bIn, out: bOut });
      up.destroy();
    });
    logger.log({
      event: 'tcp-open',
      name: svc.name,
      from: `${client.remoteAddress}:${client.remotePort}`,
      to: svc.target,
    });
  });
  srv.on('error', e => {
    logger.log({ event: 'tcp-listen-error', name: svc.name, port: svc.listenPort, error: e.message });
  });
  const desired = svc.listenPort || 0;
  srv.listen(desired, '0.0.0.0', () => {
    const port = srv.address().port;
    listeners.set(svc.name, srv);
    svc.listenPort = port;
    logger.log({ event: 'tcp-listen', name: svc.name, port, target: svc.target });
  });
}

// services: live array (mutated in place to assign listenPort).
// persist: callback fired once after auto-port assignment.
function reconcile(services, autoRange, persist) {
  const want = new Set((services || []).map(s => s.name));
  for (const [name, srv] of listeners) {
    if (!want.has(name)) {
      try { srv.close(); } catch {}
      listeners.delete(name);
    }
  }
  const used = new Set();
  for (const s of services || []) if (s.listenPort) used.add(s.listenPort);
  let assigned = false;
  for (const s of services || []) {
    if (!s.listenPort) {
      s.listenPort = pickFreePort(autoRange, used);
      used.add(s.listenPort);
      assigned = true;
    }
  }
  if (assigned && persist) persist();
  for (const s of services || []) {
    if (!listeners.has(s.name)) startService(s);
  }
}

function destroyAll() {
  for (const [, srv] of listeners) {
    try { srv.close(); } catch {}
  }
  listeners.clear();
}

function status() {
  return [...listeners.entries()].map(([name, srv]) => ({
    name,
    port: srv.address() ? srv.address().port : null,
  }));
}

module.exports = { reconcile, destroyAll, status };
