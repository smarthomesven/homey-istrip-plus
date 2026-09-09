'use strict';

const { encryptPacket, decryptPacket } = require('./crypto');

const SERVICE_UUID = '0000ac501212efde1523785fedbeda25';
const CHAR_NOTIFY_UUID = '0000ac511212efde1523785fedbeda25'; // NOTIFY
const CHAR_WRITE_UUID = '0000ac521212efde1523785fedbeda25'; // WRITE NO RESPONSE
const CHAR_READ_UUID = '0000ac531212efde1523785fedbeda25'; // READ (device string, plaintext)

const HEADER = [0x54, 0x52, 0x00, 0x57];

const CMD = {
  SET_GROUP: 0x01,
  SET_COLOR: 0x02,
  SET_RHYTHM: 0x03,
  SET_TIMER: 0x04,
  SET_SEQUENCE: 0x05,
  SET_SPEED: 0x06,
  SET_BRIGHTNESS: 0x07,
};

/**
 * Builds a 16-byte plaintext command packet: HEADER + cmd + groupId + payload,
 * right-padded with zeroes to 16 bytes total.
 * @param {number} cmd One of CMD.*
 * @param {number} groupId
 * @param {number[]} payload Additional command-specific bytes (max 10).
 * @returns {Buffer}
 */
function buildPacket(cmd, groupId, payload = []) {
  const bytes = [...HEADER, cmd & 0xff, groupId & 0xff, ...payload];
  if (bytes.length > 16) {
    throw new Error(`Packet payload too long: ${bytes.length} bytes (max 16)`);
  }
  while (bytes.length < 16) bytes.push(0);
  return Buffer.from(bytes);
}

/**
 * Mirrors BleProtocol.sendColor(): sets effect/color/brightness/speed at once.
 * @param {object} opts
 * @param {number} opts.groupId
 * @param {number} opts.effect Effect/mode id (0 = solid color).
 * @param {number} opts.r 0-255
 * @param {number} opts.g 0-255
 * @param {number} opts.b 0-255
 * @param {number} opts.brightness 0-100
 * @param {number} opts.speed 0-100
 */
function encodeColor({ groupId, effect = 0, r, g, b, brightness, speed }) {
  const pkt = buildPacket(CMD.SET_COLOR, groupId, [
    effect & 0xff,
    r & 0xff,
    g & 0xff,
    b & 0xff,
    brightness & 0xff,
    speed & 0xff,
  ]);
  return encryptPacket(pkt);
}

/** Mirrors BleProtocol.sendLedOff(): keeps brightness/speed, zeroes color/effect. */
function encodeOff({ groupId, brightness, speed }) {
  const pkt = buildPacket(CMD.SET_COLOR, groupId, [
    0, 0, 0, 0,
    brightness & 0xff,
    speed & 0xff,
  ]);
  return encryptPacket(pkt);
}

/** Mirrors BleProtocol.sendSpeed(). */
function encodeSpeed({ groupId, speed }) {
  const pkt = buildPacket(CMD.SET_SPEED, groupId, [speed & 0xff]);
  return encryptPacket(pkt);
}

/** Mirrors BleProtocol.sendLight() (brightness). */
function encodeBrightness({ groupId, brightness }) {
  const pkt = buildPacket(CMD.SET_BRIGHTNESS, groupId, [brightness & 0xff]);
  return encryptPacket(pkt);
}

/** Mirrors BleProtocol.sendRGBLineSequence(): selects a built-in preset effect. */
function encodeSequence({ groupId, sequenceId }) {
  const pkt = buildPacket(CMD.SET_SEQUENCE, groupId, [sequenceId & 0xff]);
  return encryptPacket(pkt);
}

/** Mirrors BleDataAgreement.sendGroup(). */
function encodeSetGroup({ groupId }) {
  const pkt = buildPacket(CMD.SET_GROUP, groupId, []);
  return encryptPacket(pkt);
}

/**
 * Mirrors Agreement.getEnterDiyCommand(): a distinct, UNENCRYPTED 16-byte
 * packet with its own magic ("SMVEW" instead of "TR\0W"). Never called from
 * any of the classes reverse-engineered so far, but present in the APK and
 * plausibly required to switch the MCU into "DIY color" mode before it will
 * honor sendColor()-style packets. Send this RAW (no AES) as a first
 * troubleshooting step if plain encodeColor() packets are ignored.
 */
function getEnterDiyCommand() {
  return Buffer.from([6, 83, 77, 86, 69, 87, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

/**
 * Decrypts and loosely parses a notification packet from AC51.
 * Mirrors BleDataAgreement.parseDataReok(): a well-formed reply repeats the
 * HEADER magic in the first 4 bytes.
 * @param {Buffer} raw
 * @returns {{ ok: boolean, cmd?: number, groupId?: number, raw?: Buffer }}
 */
function decodeNotification(raw) {
  if (!raw || raw.length !== 16) return { ok: false };
  const decoded = decryptPacket(raw);
  const isValid = HEADER.every((b, i) => decoded[i] === b);
  if (!isValid) return { ok: false, raw: decoded };
  return {
    ok: true,
    cmd: decoded[4],
    groupId: decoded[5],
    raw: decoded,
  };
}

module.exports = {
  SERVICE_UUID,
  CHAR_NOTIFY_UUID,
  CHAR_WRITE_UUID,
  CHAR_READ_UUID,
  CMD,
  buildPacket,
  encodeColor,
  encodeOff,
  encodeSpeed,
  encodeBrightness,
  encodeSequence,
  encodeSetGroup,
  decodeNotification,
  getEnterDiyCommand,
};