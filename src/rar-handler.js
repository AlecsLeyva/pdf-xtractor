/**
 * Lectura de RAR mediante libarchive.js.
 * libarchive.js ejecuta la descompresión en su propio Web Worker, de modo que
 * la interfaz no se bloquea. Solo se extraen los PDF y, si se activa, los
 * comprimidos anidados.
 */
import { LIMITS } from './config.js';
import {
  ExtractionError,
  baseName,
  isEncryptedError,
  isMultipartRar,
  isNestedArchiveName,
  isPdfName,
  isPdfSignature,
} from './utils.js';

let archiveClassPromise = null;

/** Carga libarchive.js solo cuando el usuario aporta un RAR. */
function loadArchiveClass() {
  if (!archiveClassPromise) {
    archiveClassPromise = import('libarchive.js')
      .then(({ Archive }) => {
        const base = import.meta.env?.BASE_URL ?? '/';
        const workerUrl = new URL(`${base}libarchive/worker-bundle.js`, document.baseURI).href;

        Archive.init({ workerUrl });
        return Archive;
      })
      .catch((error) => {
        archiveClassPromise = null;
        throw error;
      });
  }

  return archiveClassPromise;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new ExtractionError('ERR_CANCELLED', 'La extracción se canceló.');
  }
}

function entryName(entry) {
  return String(entry?.file?.name ?? entry?.name ?? '');
}

function entryPath(entry) {
  return `${entry?.path ?? ''}${entryName(entry)}`;
}

function entrySize(entry) {
  const size = Number(entry?.file?.size);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function entryDate(entry) {
  const value = Number(entry?.file?.lastModified);
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

function encryptedError(name) {
  return new ExtractionError(
    'ERR_ENCRYPTED',
    `El archivo "${name}" está protegido con contraseña y no se puede extraer. Extráelo con 7-Zip o WinRAR y vuelve a comprimirlo sin contraseña.`,
  );
}

/**
 * Extrae PDF y comprimidos anidados de un archivo usando una implementación de
 * `Archive` de libarchive.js. Está separado del cargador para poder probarlo en
 * Node con `libarchive-node.mjs`.
 *
 * @param {{ open: (file: File) => Promise<any> }} ArchiveClass
 * @param {File} file
 * @param {object} callbacks
 */
export async function extractArchiveWith(ArchiveClass, file, callbacks = {}) {
  const {
    onStart = () => {},
    onPdf = () => {},
    onPdfError = () => {},
    onNestedArchive = () => {},
    onNestedError = () => {},
    onProgress = () => {},
    signal = null,
    recursive = false,
    validatePdf = false,
  } = callbacks;

  const limits = { ...LIMITS, ...(callbacks.limits || {}) };
  const archiveName = file?.name || 'archivo';

  throwIfAborted(signal);

  let archive = null;

  try {
    archive = await ArchiveClass.open(file);

    let hasEncryptedData = null;
    try {
      hasEncryptedData = await archive.hasEncryptedData();
    } catch {
      // Si no se puede determinar, se intentará listar y extraer.
    }

    if (hasEncryptedData === true) {
      throw encryptedError(archiveName);
    }

    // La lista de entradas también puede estar cifrada.
    let entries;
    try {
      entries = await archive.getFilesArray();
    } catch (error) {
      if (isEncryptedError(error)) throw encryptedError(archiveName);
      throw error;
    }

    const files = (entries ?? []).filter((entry) => entry?.file && !entry.file.dir);
    const pdfs = [];
    const nestedArchives = [];

    for (const entry of files) {
      const name = baseName(entryName(entry));
      if (isPdfName(name)) {
        pdfs.push(entry);
      } else if (recursive && isNestedArchiveName(name)) {
        nestedArchives.push(entry);
      }
    }

    if (files.length > limits.maxEntriesPerArchive) {
      throw new ExtractionError(
        'ERR_LIMIT',
        `El archivo contiene ${files.length.toLocaleString('es-ES')} entradas y el límite de seguridad es ${limits.maxEntriesPerArchive.toLocaleString('es-ES')}.`,
      );
    }

    const byPath = (a, b) => entryPath(a).localeCompare(entryPath(b), 'es');
    pdfs.sort(byPath);
    nestedArchives.sort(byPath);

    const knownBytes = [...pdfs, ...nestedArchives].reduce(
      (sum, entry) => sum + (entrySize(entry) ?? 0),
      0,
    );

    if (knownBytes > limits.maxTotalUncompressedBytes) {
      throw new ExtractionError(
        'ERR_LIMIT',
        `El contenido descomprimido supera el límite de ${Math.round(
          limits.maxTotalUncompressedBytes / 1024 ** 2,
        ).toLocaleString('es-ES')} MB.`,
      );
    }

    const work = [
      ...pdfs.map((entry) => ({ entry, kind: 'pdf' })),
      ...nestedArchives.map((entry) => ({ entry, kind: 'nested' })),
    ].sort((a, b) => entryPath(a.entry).localeCompare(entryPath(b.entry), 'es'));

    onStart({
      totalEntries: files.length,
      pdfCount: pdfs.length,
      nestedCount: nestedArchives.length,
    });

    let processed = 0;
    let extractedBytes = 0;
    let nestedBytes = 0;

    for (const item of work) {
      throwIfAborted(signal);

      const path = entryPath(item.entry);
      const name = baseName(entryName(item.entry));
      const declaredSize = entrySize(item.entry);

      try {
        if (
          item.kind === 'pdf' &&
          declaredSize !== null &&
          declaredSize > limits.maxSinglePdfBytes
        ) {
          throw new ExtractionError(
            'ERR_LIMIT',
            `El PDF "${name}" supera el límite de ${Math.round(
              limits.maxSinglePdfBytes / 1024 ** 2,
            ).toLocaleString('es-ES')} MB.`,
          );
        }

        let extractedFile;
        try {
          extractedFile = await item.entry.file.extract();
        } catch (error) {
          if (isEncryptedError(error)) throw encryptedError(archiveName);
          throw error;
        }

        const data = await extractedFile.arrayBuffer();
        const size = data.byteLength;

        if (item.kind === 'pdf') {
          if (size > limits.maxSinglePdfBytes) {
            throw new ExtractionError(
              'ERR_LIMIT',
              `El PDF "${name}" supera el límite de tamaño permitido.`,
            );
          }

          extractedBytes += size;
          if (extractedBytes > limits.maxTotalUncompressedBytes) {
            throw new ExtractionError(
              'ERR_LIMIT',
              'El contenido descomprimido supera el límite de seguridad del procesamiento.',
            );
          }

          if (validatePdf && !isPdfSignature(data)) {
            throw new ExtractionError(
              'ERR_INVALID_PDF',
              `El archivo "${name}" tiene extensión .pdf pero no contiene una firma PDF válida.`,
            );
          }

          await onPdf({
            name,
            path,
            data,
            size,
            lastModified: entryDate(item.entry),
          });
        } else {
          nestedBytes += size;
          if (nestedBytes > limits.maxNestedBytes) {
            throw new ExtractionError(
              'ERR_LIMIT',
              `Los comprimidos anidados superan el límite de ${Math.round(
                limits.maxNestedBytes / 1024 ** 2,
              ).toLocaleString('es-ES')} MB.`,
            );
          }

          await onNestedArchive({
            name,
            path,
            data,
            size,
            lastModified: entryDate(item.entry),
          });
        }
      } catch (error) {
        if (error?.code === 'ERR_CANCELLED' || signal?.aborted) {
          throw error?.code === 'ERR_CANCELLED'
            ? error
            : new ExtractionError('ERR_CANCELLED', 'La extracción se canceló.');
        }
        if (error?.code === 'ERR_ENCRYPTED') {
          throw error;
        }
        if (error?.code === 'ERR_LIMIT' || error?.code === 'ERR_WRITE') throw error;
        if (item.kind === 'nested') {
          onNestedError(error, { name, path });
        } else {
          onPdfError(error, { name, path });
        }
      }

      processed += 1;
      onProgress({
        processed,
        total: work.length,
        pdfCount: pdfs.length,
        nestedCount: nestedArchives.length,
      });
    }

    return {
      totalEntries: files.length,
      pdfCount: pdfs.length,
      nestedCount: nestedArchives.length,
      processed,
    };
  } finally {
    // `archive.close()` termina el worker de libarchive y libera los recursos
    // del motor WASM.
    if (archive) {
      try {
        await archive.close();
      } catch {
        // Cerrar el worker es una limpieza: no debe ocultar el resultado real.
      }
    }
  }
}

/** Compatibilidad con el nombre anterior de la API. */
export const extractRarPdfsWith = extractArchiveWith;

/** Extrae usando el build de navegador de libarchive.js. */
export async function extractWithLibarchive(file, callbacks = {}) {
  const Archive = await loadArchiveClass();
  return extractArchiveWith(Archive, file, callbacks);
}

/** Extrae los PDF de un RAR usando el build de navegador de libarchive.js. */
export async function extractRarPdfs(file, callbacks = {}) {
  if (isMultipartRar(file.name)) {
    throw new ExtractionError(
      'ERR_MULTIPART',
      'Este RAR es multiparte (está dividido en varios volúmenes). Combínalos en un único archivo RAR antes de extraer.',
    );
  }

  return extractWithLibarchive(file, callbacks);
}
