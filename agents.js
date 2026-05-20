const http = require('http');
const https = require('https');

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 64,
  rejectUnauthorized: false,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 64,
});

function destroyAll() {
  httpsAgent.destroy();
  httpAgent.destroy();
}

function agentFor(target) {
  return target.startsWith('https:') ? httpsAgent : httpAgent;
}

module.exports = { httpsAgent, httpAgent, destroyAll, agentFor };
