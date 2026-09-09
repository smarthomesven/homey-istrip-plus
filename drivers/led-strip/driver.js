'use strict';

const Homey = require('homey');
const { SERVICE_UUID } = require('../../lib/protocol');

// Matches BleConfig.BROADCAST_AiTURE_PRODUCT = {84, 82, 0, 87} i.e. "TR\0W",
// used by the original app to recognise its manufacturer-specific
// advertisement data regardless of the advertised local name.
const AITURE_PRODUCT_PREFIX = Buffer.from([0x54, 0x52, 0x00, 0x57]);

class IStripDriver extends Homey.Driver {

  async onInit() {
    this.log('iStrip+ driver initialized');
  }

  _isIStripDevice(advertisement) {
    if (Buffer.isBuffer(advertisement.manufacturerData)
      && advertisement.manufacturerData.length >= AITURE_PRODUCT_PREFIX.length
      && advertisement.manufacturerData.slice(0, AITURE_PRODUCT_PREFIX.length).equals(AITURE_PRODUCT_PREFIX)) {
      return true;
    }

    if (Array.isArray(advertisement.serviceUuids)
      && advertisement.serviceUuids.some(uuid => uuid.toLowerCase().replace(/-/g, '') === SERVICE_UUID)) {
      return true;
    }

    if (typeof advertisement.localName === 'string' && /^YH-/i.test(advertisement.localName)) {
      return true;
    }

    return false;
  }

  async onPairListDevices() {
    const advertisements = await this.homey.ble.discover();

    return advertisements
      .filter(advertisement => this._isIStripDevice(advertisement))
      .map(advertisement => ({
        name: advertisement.localName || `iStrip+ LED (${advertisement.address})`,
        data: {
          id: advertisement.uuid,
        },
        store: {
          peripheralUuid: advertisement.uuid,
          address: advertisement.address,
          groupId: 0,
        },
      }));
  }

}

module.exports = IStripDriver;