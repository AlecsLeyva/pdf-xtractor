/**
 * Web Worker dedicado a leer ZIP y extraer sus PDF y comprimidos anidados.
 * Cada archivo ZIP se procesa en un worker nuevo para liberar memoria al
 * terminar. El ZIP final se construye en el hilo principal.
 */
import { analyzeZip, extractZipEntries, loadZip } from '../src/zip-core.js';
import { LIMITS } from '../src/config.js';

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    code: error?.code || null,
  };
}

const post = (message, transfer = []) => self.postMessage(message, transfer);

// Confirmaciones del hilo principal: el worker no extrae el siguiente PDF
// hasta que el anterior se ha escrito en el ZIP de salida. Así el lote no se
// acumula en la cola de mensajes y la memoria se mantiene acotada.
const ackWaiters = new Map();
let ackSequence = 0;

function waitForAck(id, sequence) {
  return new Promise((resolve) => {
    ackWaiters.set(`${id}:${sequence}`, resolve);
  });
}

self.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'ack') {
    const key = `${data.id}:${data.sequence}`;
    const resolve = ackWaiters.get(key);
    if (resolve) {
      ackWaiters.delete(key);
      resolve();
    }
    return;
  }

  if (data.type !== 'extract-zip') return;

  const { id, file } = data;
  const options = {
    recursive: Boolean(data.options?.recursive),
    validatePdf: Boolean(data.options?.validatePdf),
    limits: data.options?.limits ?? LIMITS,
  };

  try {
    const zip = await loadZip(file);
    const analysis = analyzeZip(zip, options);

    post({
      id,
      type: 'start',
      totalEntries: analysis.totalEntries,
      totalFiles: analysis.totalFiles,
      pdfCount: analysis.pdfs.length,
      nestedCount: analysis.nested.length,
    });

    await extractZipEntries(zip, {
      ...options,
      onPdf: async (pdf) => {
        const sequence = ++ackSequence;
        post({ id, type: 'pdf', sequence, pdf }, [pdf.data]);
        await waitForAck(id, sequence);
      },
      onPdfError: (error, entry) => {
        post({
          id,
          type: 'pdf-error',
          path: entry.path,
          error: serializeError(error),
        });
      },
      onNestedArchive: (nested) => {
        post({ id, type: 'nested-archive', nested }, [nested.data]);
      },
      onNestedError: (error, entry) => {
        post({
          id,
          type: 'nested-error',
          path: entry.path,
          error: serializeError(error),
        });
      },
      onProgress: ({ processed, total }) => {
        post({ id, type: 'progress', processed, total });
      },
    });

    post({
      id,
      type: 'done',
      totalEntries: analysis.totalEntries,
      totalFiles: analysis.totalFiles,
      pdfCount: analysis.pdfs.length,
      nestedCount: analysis.nested.length,
    });
  } catch (error) {
    post({ id, type: 'error', error: serializeError(error) });
  }
});
