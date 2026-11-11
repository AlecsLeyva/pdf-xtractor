/**
 * Web Worker que construye el ZIP final en streaming.
 *
 * Su objetivo es que el hilo principal nunca acumule los PDF: cada archivo se
 * transfiere aquí, se escribe en el almacenamiento privado del navegador
 * (OPFS) y se libera. Si OPFS no está disponible, se usa un Blob en memoria
 * como respaldo para no perder compatibilidad.
 *
 * También calcula el CRC-32 y las cabeceras ZIP fuera de la interfaz para que
 * el proceso no bloquee la página.
 */
import { ZipStreamWriter } from '../src/zip-writer.js';
import { OUTPUT_STORAGE_PREFIX, OUTPUT_STORAGE_SUFFIX } from '../src/output-store.js';

let backend = null;
let writer = null;

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    code: error?.code || null,
  };
}

function post(message, transfer = []) {
  self.postMessage(message, transfer);
}

function createMemoryBackend() {
  const chunks = [];

  return {
    kind: 'memory',
    sink: {
      write(chunk) {
        chunks.push(chunk);
      },
      async close() {},
    },
    async finish() {
      return {
        storage: null,
        blob: new Blob(chunks, { type: 'application/zip' }),
      };
    },
    async discard() {
      chunks.length = 0;
    },
  };
}

async function createOpfsBackend() {
  const storage = self.navigator?.storage;
  if (!storage?.getDirectory) return null;

  let root = null;
  let name = null;

  try {
    root = await storage.getDirectory();
    name = `${OUTPUT_STORAGE_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}${OUTPUT_STORAGE_SUFFIX}`;
    const handle = await root.getFileHandle(name, { create: true });

    if (typeof handle.createWritable !== 'function') {
      await root.removeEntry(name).catch(() => {});
      return null;
    }

    const writable = await handle.createWritable();

    return {
      kind: 'opfs',
      sink: {
        write(chunk) {
          return writable.write(chunk);
        },
        close() {
          return writable.close();
        },
      },
      async finish() {
        return { storage: { kind: 'opfs', name }, blob: null };
      },
      async discard() {
        try {
          await writable.abort();
        } catch {
          // Si ya se cerró, abortar no es necesario.
        }
        try {
          await root.removeEntry(name);
        } catch {
          // El archivo puede no existir todavía.
        }
      },
    };
  } catch {
    if (root && name) {
      await root.removeEntry(name).catch(() => {});
    }
    return null;
  }
}

async function createBackend() {
  return (await createOpfsBackend()) ?? createMemoryBackend();
}

async function handleMessage(message) {
  switch (message.type) {
    case 'init': {
      backend = await createBackend();
      writer = new ZipStreamWriter(backend.sink);
      post({ id: message.id, type: 'ready', streaming: backend.kind === 'opfs' });
      break;
    }

    case 'add': {
      if (!writer) throw new Error('El ZIP de salida no está inicializado.');
      const data =
        message.data instanceof ArrayBuffer ? new Uint8Array(message.data) : message.data;
      await writer.addFile(message.name, data, message.lastModified);
      post({ id: message.id, type: 'added' });
      break;
    }

    case 'finalize': {
      if (!writer) throw new Error('El ZIP de salida no está inicializado.');
      const info = await writer.finalize();
      const result = await backend.finish();
      writer = null;
      backend = null;
      post({
        id: message.id,
        type: 'finalized',
        entries: info.entries,
        bytes: info.bytes,
        storage: result.storage,
        blob: result.blob,
      });
      break;
    }

    case 'discard': {
      if (backend) {
        await backend.discard();
        backend = null;
        writer = null;
      }
      post({ id: message.id, type: 'discarded' });
      break;
    }

    case 'close': {
      if (backend) {
        await backend.discard().catch(() => {});
        backend = null;
        writer = null;
      }
      self.close();
      break;
    }

    default:
      break;
  }
}

let queue = Promise.resolve();

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;

  // Los mensajes se procesan estrictamente en orden para que las escrituras
  // del ZIP no se entrelacen.
  queue = queue
    .then(() => handleMessage(message))
    .catch((error) => {
      post({
        id: message.id,
        type: 'error',
        error: serializeError(error),
      });
    });
});
