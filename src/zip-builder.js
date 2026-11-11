/**
 * Cliente del Web Worker que construye el ZIP final.
 *
 * Cada PDF se transfiere al worker (sin copiarlo) y allí se escribe en OPFS o,
 * si no está disponible, en un Blob en memoria. El hilo principal solo espera
 * la confirmación, de modo que nunca retiene el lote completo de PDF.
 */
import { ExtractionError, OUTPUT_FILE_NAME } from './utils.js';
import { discardOutput, resolveOutputFile } from './output-store.js';

function createJobId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function writeError(message, cause) {
  return new ExtractionError(
    'ERR_WRITE',
    message ||
      `No se pudo guardar ${OUTPUT_FILE_NAME}. Comprueba el espacio libre del dispositivo y prueba con un lote más pequeño.`,
    { cause },
  );
}

export class ZipBuilder {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.failure = null;
    this.streaming = false;
  }

  /** Inicia el worker y el almacenamiento de salida. */
  async start() {
    try {
      this.worker = new Worker(new URL('../workers/zip-builder-worker.js', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      throw writeError(null, error);
    }

    this.worker.addEventListener('message', (event) => this.handleMessage(event));
    this.worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      this.fail(
        writeError(
          `El proceso que crea ${OUTPUT_FILE_NAME} dejó de responder. Vuelve a intentarlo.`,
        ),
      );
    });
    this.worker.addEventListener('messageerror', () => {
      this.fail(writeError(`No se pudo transferir el contenido a ${OUTPUT_FILE_NAME}.`));
    });

    let ready;
    try {
      ready = await this.request({ type: 'init' });
    } catch (error) {
      this.terminate();
      throw error;
    }

    this.streaming = Boolean(ready?.streaming);
    return { streaming: this.streaming };
  }

  request(message, transfer = []) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.worker) return Promise.reject(writeError());

    const id = createJobId();

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      try {
        this.worker.postMessage({ ...message, id }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(writeError(null, error));
      }
    });
  }

  handleMessage(event) {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'error') {
      const pending = message.id ? this.pending.get(message.id) : null;
      if (pending) {
        this.pending.delete(message.id);
        pending.reject(
          writeError(
            `No se pudo escribir ${OUTPUT_FILE_NAME} en el almacenamiento del navegador. Comprueba el espacio libre y prueba con un lote más pequeño.`,
            message.error,
          ),
        );
      } else {
        this.fail(writeError(undefined, message.error));
      }
      return;
    }

    const pending = message.id ? this.pending.get(message.id) : null;
    if (!pending) return;

    this.pending.delete(message.id);
    pending.resolve(message);
  }

  fail(error) {
    if (!this.failure) this.failure = error;

    for (const { reject } of this.pending.values()) {
      reject(this.failure);
    }
    this.pending.clear();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /** Añade un PDF al ZIP. El búfer se transfiere y deja de ser utilizable. */
  async add({ name, data, lastModified }) {
    const transfer = data instanceof ArrayBuffer ? [data] : [];
    await this.request({ type: 'add', name, data, lastModified }, transfer);
  }

  /** Cierra el ZIP y devuelve el Blob/File descargable y su ubicación. */
  async finalize() {
    const result = await this.request({ type: 'finalize' });

    let blob = result.blob || null;
    const storage = result.storage || null;

    if (!blob && storage) {
      try {
        blob = await resolveOutputFile(storage);
      } catch (error) {
        await discardOutput(storage);
        this.terminate();
        throw writeError(
          `El ZIP se creó, pero no se pudo preparar la descarga de ${OUTPUT_FILE_NAME}. Recarga la página e inténtalo de nuevo.`,
          error,
        );
      }
    }

    this.terminate();

    if (!blob) {
      await discardOutput(storage);
      throw writeError(`No se pudo preparar la descarga de ${OUTPUT_FILE_NAME}.`);
    }

    return { blob, storage };
  }

  /** Descarta el ZIP parcial (cancelación, límite o error de escritura). */
  async discard() {
    if (!this.worker) return;

    try {
      await this.request({ type: 'discard' });
    } catch {
      // Descartar es best-effort: el worker terminará de todas formas.
    }

    this.terminate();
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
