const EventEmitter = require('events');

class Logger extends EventEmitter {
  constructor(max = 500) {
    super();
    this.max = max;
    this.buf = [];
    this.setMaxListeners(100);
  }

  log(entry) {
    const e = { ts: Date.now(), ...entry };
    this.buf.push(e);
    if (this.buf.length > this.max) this.buf.shift();
    this.emit('log', e);
  }

  recent() {
    return this.buf.slice();
  }
}

module.exports = new Logger();
