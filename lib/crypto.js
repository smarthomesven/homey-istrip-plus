'use strict';

const crypto = require('crypto');

// Extracted from libAES.so (csh.tiro.cc.aes / Java_csh_tiro_cc_aes_keyExpansionDefault)
// found in an older release of the iStrip+ app (com.beniao.istripplus).
// AES-128, ECB mode, single 16-byte block, no IV, no padding.
const AES_KEY = Buffer.from([
  0x34, 0x52, 0x2a, 0x5b, 0x7a, 0x6e, 0x49, 0x2c,
  0x08, 0x09, 0x0a, 0x9d, 0x8d, 0x2a, 0x23, 0xf8,
]);

/**
 * Encrypts a 16-byte command packet (mirrors Agreement.getEncryptData()).
 * @param {Buffer} buf Exactly 16 bytes.
 * @returns {Buffer}
 */
function encryptPacket(buf) {
  if (buf.length !== 16) {
    throw new Error(`encryptPacket expects a 16-byte buffer, got ${buf.length}`);
  }
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(buf), cipher.final()]);
}

/**
 * Decrypts a 16-byte notification packet (mirrors Agreement.getDecodeData()).
 * @param {Buffer} buf Exactly 16 bytes.
 * @returns {Buffer}
 */
function decryptPacket(buf) {
  if (buf.length !== 16) {
    throw new Error(`decryptPacket expects a 16-byte buffer, got ${buf.length}`);
  }
  const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(buf), decipher.final()]);
}

module.exports = { encryptPacket, decryptPacket, AES_KEY };