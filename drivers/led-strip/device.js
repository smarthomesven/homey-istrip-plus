'use strict';

const Homey = require('homey');
const {
  SERVICE_UUID,
  CHAR_NOTIFY_UUID,
  CHAR_WRITE_UUID,
  encodeColor,
  encodeOff,
  encodeBrightness,
  getEnterDiyCommand,
} = require('../../lib/protocol');

// The old app kept a live connection open (BleManager auto-subscribes to
// notifications in onReady). We do the same rather than reconnecting per
// write, since these controllers are typically slow to (re)negotiate a
// connection and the strip is meant to be controlled interactively.
const RECONNECT_DELAY_MS = 5000;

class IStripDevice extends Homey.Device {

  async onInit() {
    this.log('iStrip+ device initialized:', this.getName());

    this._groupId = 1;
    this._peripheral = null;
    this._writeChar = null;
    this._connecting = null;

    this.registerCapabilityListener('onoff', this._onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('dim', this._onCapabilityDim.bind(this));
    this.registerMultipleCapabilityListener(
      ['light_hue', 'light_saturation'],
      this._onCapabilityColor.bind(this),
      500,
    );
    this.registerCapabilityListener('light_mode', () => Promise.resolve());
    this._ensureConnected().catch(err => {
      this.error('Initial connect failed, will retry on first command:', err.message);
    });
  }

  async onUninit() {
    if (this._peripheral) {
      await this._peripheral.disconnect().catch(() => {});
    }
  }

  async onDeleted() {
    if (this._peripheral) {
      await this._peripheral.disconnect().catch(() => {});
    }
  }

  /**
   * Connects to the peripheral (if not already connected), discovers the
   * write characteristic, and subscribes to notifications for ACKs.
   * Reuses an in-flight connection attempt if one is already running.
   */
  async _ensureConnected() {
    if (this._peripheral && this._writeChar) return;
    if (this._connecting) return this._connecting;

    this._connecting = this._connect();
    try {
      await this._connecting;
    } finally {
      this._connecting = null;
    }
  }

  async _connect() {
    const { peripheralUuid } = this.getStore();
    if (!peripheralUuid) {
      throw new Error('Device is missing its peripheralUuid, re-pair the device');
    }

    this.log('Connecting to peripheral', peripheralUuid);
    const advertisement = await this.homey.ble.find(peripheralUuid);
    const peripheral = await advertisement.connect();

    peripheral.once('disconnect', () => {
      this.log('Peripheral disconnected');
      this._peripheral = null;
      this._writeChar = null;
      this.setUnavailable('Disconnected, reconnecting...').catch(() => {});
      this.homey.setTimeout(() => {
        this._ensureConnected().catch(err => this.error('Reconnect failed:', err.message));
      }, RECONNECT_DELAY_MS);
    });

    const services = await peripheral.discoverServices();
    const service = services.find(s => s.uuid.toLowerCase() === SERVICE_UUID);
    if (!service) throw new Error(`Service ${SERVICE_UUID} not found on peripheral`);

    const characteristics = await service.discoverCharacteristics();
    const writeChar = characteristics.find(c => c.uuid.toLowerCase() === CHAR_WRITE_UUID);
    if (!writeChar) throw new Error(`Write characteristic ${CHAR_WRITE_UUID} not found`);

    this.log('Discovered characteristics:', characteristics.map(c => c.uuid).join(', '));

    const notifyChar = characteristics.find(c => c.uuid.toLowerCase() === CHAR_NOTIFY_UUID);
    if (notifyChar) {
      await notifyChar.subscribeToNotifications(data => this._onNotification(data));
      this.log('Subscribed to notifications on', CHAR_NOTIFY_UUID);
    } else {
      this.log('Notify characteristic not found, continuing without ACKs');
    }

    this._peripheral = peripheral;
    this._writeChar = writeChar;
    await this.setAvailable().catch(() => {});
    this.log('Connected and ready');

    try {
      const diyPacket = getEnterDiyCommand();
      this.log('Sending unencrypted DIY-unlock packet:', diyPacket.toString('hex'));
      await writeChar.write(diyPacket);
      this.log('DIY-unlock write resolved');
    } catch (err) {
      this.error('DIY-unlock write failed (continuing anyway):', err);
    }
  }

  _onNotification(data) {
    this.log('Notification received:', data.toString('hex'));
  }

  async _write(packet) {
    await this._ensureConnected();
    this.log('Writing packet:', packet.toString('hex'));
    try {
      const result = await this._writeChar.write(packet);
      this.log('Write resolved:', result === undefined ? '(no return value)' : result);
    } catch (err) {
      this.error('Write failed:', err);
      this._peripheral = null;
      this._writeChar = null;
      throw err;
    }
  }

  _currentBrightness() {
    const dim = this.getCapabilityValue('dim');
    return Math.round((typeof dim === 'number' ? dim : 1) * 100);
  }

  _currentSpeed() {
    return 50;
  }

  _hsToRgb(hue, saturation) {
    const h = hue * 360;
    const s = saturation;
    const v = 1;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r1, g1, b1;
    if (h < 60) [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255),
    };
  }

  async _onCapabilityOnoff(value) {
    if (value) {
      const hue = this.getCapabilityValue('light_hue') ?? 0;
      const sat = this.getCapabilityValue('light_saturation') ?? 1;
      const { r, g, b } = this._hsToRgb(hue, sat);
      const packet = encodeColor({
        groupId: this._groupId,
        effect: 0,
        r, g, b,
        brightness: this._currentBrightness(),
        speed: this._currentSpeed(),
      });
      await this._write(packet);
    } else {
      const packet = encodeOff({
        groupId: this._groupId,
        brightness: this._currentBrightness(),
        speed: this._currentSpeed(),
      });
      await this._write(packet);
    }
  }

  async _onCapabilityDim(value) {
    const brightness = Math.round(value * 100);
    const packet = encodeBrightness({ groupId: this._groupId, brightness });
    await this._write(packet);
  }

  async _onCapabilityColor({ light_hue, light_saturation }) {
    const hue = light_hue ?? this.getCapabilityValue('light_hue') ?? 0;
    const sat = light_saturation ?? this.getCapabilityValue('light_saturation') ?? 1;
    const { r, g, b } = this._hsToRgb(hue, sat);
    const packet = encodeColor({
      groupId: this._groupId,
      effect: 0,
      r, g, b,
      brightness: this._currentBrightness(),
      speed: this._currentSpeed(),
    });
    await this._write(packet);
  }

}

module.exports = IStripDevice;