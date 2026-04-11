export class Scanner {
  constructor(containerId, onResult) {
    this.containerId = containerId;
    this.onResult = onResult;
    this.active = false;
    this._instance = null;
    this._lastCode = null;
    this._debounce = null;
  }

  async start() {
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error('La librería de cámara no cargó. Verificá la conexión a internet.');
    }

    if (this._instance) {
      try { await this._instance.stop(); } catch (_) {}
      try { this._instance.clear(); } catch (_) {}
      this._instance = null;
    }

    // Habilitar todos los formatos de código de barras comunes
    const formats = [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
    ];

    this._instance = new Html5Qrcode(this.containerId, {
      formatsToSupport: formats,
      verbose: false
    });

    const config = {
      fps: 15,
      qrbox: { width: 280, height: 100 },  // Rectangular: mejor para EAN/CODE128
      aspectRatio: 1.5,
    };

    const onDecode = (decodedText) => {
      if (decodedText !== this._lastCode) {
        this._lastCode = decodedText;
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => { this._lastCode = null; }, 2000);
        this.onResult(decodedText);
      }
    };

    try {
      await this._instance.start({ facingMode: 'environment' }, config, onDecode, () => {});
    } catch (_) {
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) throw new Error('No se encontró ninguna cámara.');
      await this._instance.start(devices[0].id, config, onDecode, () => {});
    }

    this.active = true;
  }

  async stop() {
    if (this._instance) {
      try { await this._instance.stop(); } catch (_) {}
      try { this._instance.clear(); } catch (_) {}
      this._instance = null;
    }
    this.active = false;
    this._lastCode = null;
  }
}
