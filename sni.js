// Parse TLS ClientHello SNI extension. Returns lowercase hostname or null.

function readU16(buf, off) { return buf.readUInt16BE(off); }
function readU24(buf, off) { return (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2]; }

function parseSNI(buf) {
  try {
    if (buf.length < 5) return null;
    if (buf[0] !== 0x16) return null;                      // TLS handshake
    const recLen = readU16(buf, 3);
    if (buf.length < 5 + recLen) return null;
    let off = 5;
    if (buf[off] !== 0x01) return null;                    // ClientHello
    off += 1 + 3;                                          // handshake type + length
    off += 2 + 32;                                         // client_version + random
    const sidLen = buf[off]; off += 1 + sidLen;            // session_id
    const csLen = readU16(buf, off); off += 2 + csLen;     // cipher_suites
    const cmLen = buf[off]; off += 1 + cmLen;              // compression_methods
    if (off + 2 > buf.length) return null;
    const extLen = readU16(buf, off); off += 2;            // extensions length
    const extEnd = off + extLen;
    while (off + 4 <= extEnd) {
      const extType = readU16(buf, off); off += 2;
      const extDataLen = readU16(buf, off); off += 2;
      if (extType === 0x0000) {                            // server_name
        const listLen = readU16(buf, off);
        let p = off + 2;
        const listEnd = p + listLen;
        while (p + 3 <= listEnd) {
          const nameType = buf[p]; p += 1;
          const nameLen = readU16(buf, p); p += 2;
          if (nameType === 0) {
            return buf.slice(p, p + nameLen).toString('ascii').toLowerCase();
          }
          p += nameLen;
        }
        return null;
      }
      off += extDataLen;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { parseSNI };
