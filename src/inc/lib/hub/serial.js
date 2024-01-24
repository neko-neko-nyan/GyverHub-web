class SerialJS extends Transport {
  #port;
  #reader;
  #running;

  constructor() {
    super();
  }

  getName() {
    let id = this.#port ? this.#port.getInfo().usbProductId : null;
    switch (id) {
      case 0x7584: return 'CH340S';
      case 0x55d3: return 'CH343';
      case 0x7522: case 0x7523: return 'CH340';
      case 0x5512: case 0x5523: case 0x5584: return 'CH341';
      case 0x9500: case 0x0102: case 0x0501: case 0x80a9: case 0xea60: case 0xea61: case 0xea63: return 'CP210x';
      case 0x0402: case 0x0403: case 0x0404: case 0x0405: case 0x6001: case 0x0602: case 0x6010: return 'FT232';
      case null: return 'none';
      default: return 'unknown';
    }
  }

  async auto_open(baud) {
    try {
      const ports = await navigator.serial.getPorts();
      if (ports)
        this.#port = ports[0];

    } catch (e) {
      return;
    }
    
    await this.open(baud)
  }

  async select() {
    await this.close();
    this.#port = undefined;
    this._setState(ConnectionState.CONNECTING);

    try {
      const ports = await navigator.serial.getPorts();
      for (let port of ports) await port.forget();
      
      this.#port = await navigator.serial.requestPort();
    } finally {
      this._setState(ConnectionState.DISCONNECTED);
    }
  }

  async open(baud) {
    if (!this.#port)
      return;

    await this.close();

    this._setState(ConnectionState.CONNECTING);

    try {
      await this.#port.open({ baudRate: baud });
    } catch (e) {
      if (!(e instanceof InvaidStateError)) {
        this._setState(ConnectionState.DISCONNECTED);
        throw e;
      }
    }
    this._setState(ConnectionState.CONNECTED);

    this.#readLoop();
  }

  async close() {
    if (!this.#port)
      return;

    this.#running = false;
    if (this.#reader) await this.#reader.cancel();

    try {
      await this.#port.close();
    } catch (e) {}
    this._setState(ConnectionState.DISCONNECTED);
  }

  async send(data) {
    data = new TextEncoder().encode(data);

    if (!this.#port || !this.#port.writable)
      return;

    const writer = this.#port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  async _handleDisconnection(event) {
    this.close();
    this.#port = undefined;
  }
  _disconnect_h = this._handleDisconnection.bind(this);

  async #readLoop() {
    this.#running = true;
    while (this.#running && this.#port && this.#port.readable) {
      this.#reader = this.#port.readable.getReader();
      try {
        while (true) {
          const read = await this.#reader.read();
          if (read.done) break;
          const data = new TextDecoder().decode(read.value);
          this.dispatchEvent(new MessageEvent(data));
        }
      } finally {
        this.#reader.releaseLock();
        this.#reader = null;
      }
    }
  }
}
