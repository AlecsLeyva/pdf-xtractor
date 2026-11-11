/**
 * Cliente del Web Worker que procesa ZIP. El worker lee el archivo, recorre
 * todas sus carpetas y devuelve únicamente los PDF (y comprimidos anidados si
 * se activa la recursión).
 */
import { ExtractionError } from './utils.js';

function createJobId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class ZipExtractor {
  /**
   * @param {File} file
   * @param {{
   *   signal?: AbortSignal,
   *   recursive?: boolean,
   *   validatePdf?: boolean,
   *   limits?: object,
   *   onStart?: (info: object) => void,
   *   onPdf?: (pdf: object) => void,
   *   onPdfError?: (error: object, entry: { path: string }) => void,
   *   onNestedArchive?: (nested: object) => void,
   *   onNestedError?: (error: object, entry: { path: string }) => void,
   *   onProgress?: (info: { processed: number, total: number }) => void,
   * }} callbacks
   */
  extract(file, callbacks = {}) {
    const id = createJobId();
    const signal = callbacks.signal;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ExtractionError('ERR_CANCELLED', 'La extracción se canceló.'));
        return;
      }

      let worker;
      try {
        worker = new Worker(new URL('../workers/zip-worker.js', import.meta.url), {
          type: 'module',
        });
      } catch (error) {
        reject(
          new ExtractionError(
            'ERR_WORKER',
            'No se pudo iniciar el procesador ZIP en segundo plano del navegador.',
            { cause: error },
          ),
        );
        return;
      }

      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.('abort', handleAbort);
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleWorkerError);
        worker.removeEventListener('messageerror', handleMessageError);
        worker.terminate();
        callback(value);
      };

      const handleAbort = () => {
        finish(reject, new ExtractionError('ERR_CANCELLED', 'La extracción se canceló.'));
      };

      const handleMessage = (event) => {
        const message = event.data;
        if (!message || message.id !== id) return;

        switch (message.type) {
          case 'start':
            callbacks.onStart?.({
              totalEntries: message.totalEntries,
              totalFiles: message.totalFiles,
              pdfCount: message.pdfCount,
              nestedCount: message.nestedCount,
            });
            break;

          case 'pdf': {
            // El worker espera esta confirmación antes de extraer el siguiente
            // PDF; así el lote nunca se acumula en memoria.
            const acknowledge = () => {
              if (settled) return;
              try {
                worker.postMessage({ type: 'ack', id, sequence: message.sequence });
              } catch {
                // El worker ya puede estar terminado.
              }
            };

            Promise.resolve()
              .then(() => callbacks.onPdf?.(message.pdf))
              .then(acknowledge, acknowledge);
            break;
          }

          case 'pdf-error':
            callbacks.onPdfError?.(message.error, { path: message.path });
            break;

          case 'nested-archive':
            callbacks.onNestedArchive?.(message.nested);
            break;

          case 'nested-error':
            callbacks.onNestedError?.(message.error, { path: message.path });
            break;

          case 'progress':
            callbacks.onProgress?.({
              processed: message.processed,
              total: message.total,
            });
            break;

          case 'done':
            finish(resolve, {
              totalEntries: message.totalEntries,
              totalFiles: message.totalFiles,
              pdfCount: message.pdfCount,
              nestedCount: message.nestedCount,
            });
            break;

          case 'error': {
            const error = message.error?.code
              ? new ExtractionError(message.error.code, message.error.message)
              : new Error(message.error?.message || 'No se pudo leer el ZIP.');
            error.name = message.error?.name || 'Error';
            finish(reject, error);
            break;
          }

          default:
            break;
        }
      };

      const handleWorkerError = (event) => {
        event.preventDefault?.();
        finish(
          reject,
          new ExtractionError(
            'ERR_WORKER',
            'El procesador ZIP dejó de responder. Vuelve a intentarlo.',
          ),
        );
      };

      const handleMessageError = () => {
        finish(
          reject,
          new ExtractionError('ERR_READ', 'No se pudo recibir el contenido del ZIP.'),
        );
      };

      signal?.addEventListener?.('abort', handleAbort, { once: true });
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleWorkerError);
      worker.addEventListener('messageerror', handleMessageError);

      try {
        worker.postMessage({
          id,
          type: 'extract-zip',
          file,
          options: {
            recursive: Boolean(callbacks.recursive),
            validatePdf: Boolean(callbacks.validatePdf),
            limits: callbacks.limits,
          },
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }
}
