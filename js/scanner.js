// Usa html5-qrcode (cargado como script global en pos.html)
// https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js

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
    this._instance = new Html5Qrcode(this.containerId);

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 180 },
      aspectRatio: 1.5,
    };

    await this._instance.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        // Debounce: evitar múltiples disparos del mismo código
        if (decodedText !== this._lastCode) {
          this._lastCode = decodedText;
          clearTimeout(this._debounce);
          this._debounce = setTimeout(() => { this._lastCode = null; }, 2000);
          this.onResult(decodedText);
        }
      },
      () => { /* errores de frame ignorados */ }
    );

    this.active = true;
  }

  async stop() {
    if (this._instance) {
      try {
        await this._instance.stop();
        this._instance.clear();
      } catch (e) { /* ignorar si ya estaba detenido */ }
    }
    this.active = false;
    this._lastCode = null;
  }
}
