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

    // Limpiar instancia anterior si quedó colgada
    if (this._instance) {
      try { await this._instance.stop(); } catch (_) {}
      try { this._instance.clear(); } catch (_) {}
      this._instance = null;
    }

    this._instance = new Html5Qrcode(this.containerId, { verbose: false });

    const config = { fps: 10, qrbox: { width: 250, height: 180 } };
    const onDecode = (decodedText) => {
      if (decodedText !== this._lastCode) {
        this._lastCode = decodedText;
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => { this._lastCode = null; }, 2000);
        this.onResult(decodedText);
      }
    };
    const onError = () => {};

    // Intentar cámara trasera primero; si falla, usar cualquier cámara disponible
    try {
      await this._instance.start({ facingMode: 'environment' }, config, onDecode, onError);
    } catch (envErr) {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (!devices || devices.length === 0) {
          throw new Error('No se encontró ninguna cámara en este dispositivo.');
        }
        await this._instance.start(devices[0].id, config, onDecode, onError);
      } catch (fallbackErr) {
        const msg = fallbackErr?.message || String(fallbackErr) || 'Error desconocido al iniciar la cámara';
        throw new Error(msg);
      }
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
