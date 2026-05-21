// TLS SNI multiplexer. Peeks ClientHello on raw TCP, routes by SNI:
//   { kind: 'http' }              -> hand to existing https server (HTTP scrub path)
//   { kind: 'tls-passthrough', target: 'host:port' } -> raw socket pipe (no decrypt)
//   { kind: 'tcp-terminate',  target: 'host:port' } -> terminate TLS, forward plain
//   null                          -> drop

const net = require('net');
const tls = require('tls');
const { parseSNI } = require('./sni');
const logger = require('./logger');

function splitHostPort(s) {
  const i = s.lastIndexOf(':');
  return [s.slice(0, i), parseInt(s.slice(i + 1), 10)];
}

function rawPipe(client, target, sni, kind) {
  const [host, port] = splitHostPort(target);
  if (!port) { client.destroy(); return; }
  const up = net.connect(port, host);
  logger.log({ event: kind + '-open', sni, target });
  up.on('error', e => {
    logger.log({ event: kind + '-upstream-error', sni, error: e.message });
    client.destroy();
  });
  client.on('error', () => up.destroy());
  client.pipe(up).pipe(client);
  client.on('close', () => {
    logger.log({ event: kind + '-close', sni });
    up.destroy();
  });
}

function start({ port, tlsOptions, httpsServer, resolve }) {
  const srv = net.createServer(socket => {
    socket.once('data', chunk => {
      socket.pause();
      socket.unshift(chunk);
      const sni = parseSNI(chunk);
      const route = resolve(sni);
      if (!route) {
        logger.log({ event: 'mux-drop', sni });
        socket.destroy();
        return;
      }
      if (route.kind === 'http') {
        httpsServer.emit('connection', socket);
        return;
      }
      if (route.kind === 'tls-passthrough') {
        socket.resume();
        rawPipe(socket, route.target, sni, 'tls-passthrough');
        return;
      }
      if (route.kind === 'tcp-terminate') {
        const tlsSock = new tls.TLSSocket(socket, {
          isServer: true,
          ...tlsOptions,
        });
        tlsSock.on('secure', () => rawPipe(tlsSock, route.target, sni, 'tcp-terminate'));
        tlsSock.on('error', e => {
          logger.log({ event: 'tcp-terminate-tls-error', sni, error: e.message });
          socket.destroy();
        });
        return;
      }
      socket.destroy();
    });
    socket.on('error', () => { /* swallow; client gone */ });
  });
  srv.listen(port, () => {
    logger.log({ event: 'mux-listen', port });
  });
  return srv;
}

module.exports = { start };
