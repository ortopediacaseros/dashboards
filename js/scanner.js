import { BrowserMultiFormatReader } from 'https://cdn.jsdelivr.net/npm/@zxing/browser@latest/esm/index.js';

export class Scanner {
  constructor(videoElementId, onResult) {
    this.reader = new BrowserMultiFormatReader();
    this.videoId = videoElementId;
    this.onResult = onResult;
    this.active = false;
    this._lastCode = null;
    this._debounce = null;
  }

  async start() {
    this.active = true;
    try {
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      if (!devices || devices.length === 0) {
        throw new Error('No se encontró cámara disponible');
      }
      // Preferir cámara trasera
      const back = devices.find(d =>
        d.label.toLowerCase().includes('back') ||
        d.label.toLowerCase().includes('rear') ||
        d.label.toLowerCase().includes('trasera') ||
        d.label.toLowerCase().includes('environment')
      );
      const deviceId = back?.deviceId || devices[devices.length - 1]?.deviceId;

      await this.reader.decodeFromVideoDevice(deviceId, this.videoId, (result, err) => {
        if (result) {
          const code = result.getText();
          // Debounce: evitar múltiples disparos del mismo código
          if (code !== this._lastCode) {
            this._lastCode = code;
            clearTimeout(this._debounce);
            this._debounce = setTimeout(() => { this._lastCode = null; }, 2000);
            this.onResult(code);
          }
        }
      });
    } catch (err) {
      this.active = false;
      throw err;
    }
  }

  stop() {
    this.reader.reset();
    this.active = false;
    this._lastCode = null;
  }
}
