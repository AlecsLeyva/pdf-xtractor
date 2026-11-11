/**
 * Lógica de lectura de ZIP con JSZip. Se usa desde el Web Worker y desde los
 * tests de Node, por eso no depende del DOM.
 */
import JSZip from 'jszip';
import {
  ExtractionError,
  baseName,
  isNestedArchiveName,
  isPdfName,
  isPdfSignature,
} from './utils.js';
import { LIMITS } from './config.js';

/** Carga un File/Blob (o Buffer en Node) como archivo ZIP de JSZip. */
export function loadZip(file) {
  return JSZip.loadAsync(file);
}

/** Cuenta todos los archivos (no carpetas) del ZIP. */
export function countFiles(zip) {
  let total = 0;
  zip.forEach((_path, entry) => {
    if (!entry.dir) total += 1;
  });
  return total;
}

function entrySize(entry) {
  const size = entry?._data?.uncompressedSize;
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function toEntryInfo(path, entry) {
  return {
    path,
    name: baseName(entry.name),
    entry,
    size: entrySize(entry),
    lastModified: entry.date instanceof Date ? entry.date.getTime() : Date.now(),
  };
}

/**
 * Analiza el ZIP y separa PDF y comprimidos anidados. No descomprime nada.
 * Lanza ERR_LIMIT si se superan los límites de seguridad.
 */
export function analyzeZip(zip, options = {}) {
  const { recursive = false, limits = LIMITS } = options;
  const pdfs = [];
  const nested = [];
  let totalEntries = 0;
  let totalFiles = 0;
  let bytesWithoutSize = 0;

  zip.forEach((path, entry) => {
    totalEntries += 1;
    if (entry.dir) return;
    totalFiles += 1;

    if (isPdfName(entry.name)) {
      const info = toEntryInfo(path, entry);
      pdfs.push(info);
      if (info.size === null) bytesWithoutSize += 1;
    } else if (recursive && isNestedArchiveName(entry.name)) {
      const info = toEntryInfo(path, entry);
      nested.push(info);
      if (info.size === null) bytesWithoutSize += 1;
    }
  });

  if (totalEntries > limits.maxEntriesPerArchive) {
    throw new ExtractionError(
      'ERR_LIMIT',
      `El ZIP contiene ${totalEntries.toLocaleString('es-ES')} entradas y el límite de seguridad es ${limits.maxEntriesPerArchive.toLocaleString('es-ES')}.`,
    );
  }

  pdfs.sort((a, b) => a.path.localeCompare(b.path, 'es'));
  nested.sort((a, b) => a.path.localeCompare(b.path, 'es'));

  const knownBytes = [...pdfs, ...nested].reduce((sum, item) => sum + (item.size ?? 0), 0);

  if (knownBytes > limits.maxTotalUncompressedBytes) {
    throw new ExtractionError(
      'ERR_LIMIT',
      `El contenido descomprimido supera el límite de ${Math.round(limits.maxTotalUncompressedBytes / 1024 ** 2).toLocaleString('es-ES')} MB.`,
    );
  }

  if (!recursive && totalFiles > 0) {
    nested.length = 0;
  }

  return {
    pdfs,
    nested,
    totalEntries,
    totalFiles,
    knownBytes,
    bytesWithoutSize,
  };
}

/**
 * Devuelve las entradas PDF del ZIP, ordenadas por ruta para que el resultado
 * sea determinista. Se mantiene por compatibilidad y para tests.
 */
export function collectPdfEntries(zip) {
  return analyzeZip(zip, { recursive: false }).pdfs;
}

/**
 * Extrae los PDF y, opcionalmente, los comprimidos anidados de un ZIP.
 * No aborta el archivo completo si falla una entrada concreta; sí aborta si se
 * supera un límite global de seguridad.
 */
export async function extractZipEntries(zip, options = {}) {
  const {
    onPdf = () => {},
    onPdfError = () => {},
    onNestedArchive = () => {},
    onNestedError = () => {},
    onProgress = () => {},
    recursive = false,
    validatePdf = false,
    limits = LIMITS,
  } = options;

  const analysis = analyzeZip(zip, { recursive, limits });
  const work = [
    ...analysis.pdfs.map((item) => ({ ...item, kind: 'pdf' })),
    ...analysis.nested.map((item) => ({ ...item, kind: 'nested' })),
  ];
  work.sort((a, b) => a.path.localeCompare(b.path, 'es'));

  let processed = 0;
  let extractedBytes = 0;
  let nestedBytes = 0;

  for (const item of work) {
    try {
      if (item.size !== null && item.size > limits.maxSinglePdfBytes && item.kind === 'pdf') {
        throw new ExtractionError(
          'ERR_LIMIT',
          `El PDF "${item.name}" supera el límite de ${Math.round(limits.maxSinglePdfBytes / 1024 ** 2).toLocaleString('es-ES')} MB.`,
        );
      }

      const data = await item.entry.async('arraybuffer');
      const size = data.byteLength;

      if (size > limits.maxSinglePdfBytes && item.kind === 'pdf') {
        throw new ExtractionError(
          'ERR_LIMIT',
          `El PDF "${item.name}" supera el límite de tamaño permitido.`,
        );
      }

      if (item.kind === 'nested') {
        nestedBytes += size;
        if (nestedBytes > limits.maxNestedBytes) {
          throw new ExtractionError(
            'ERR_LIMIT',
            `Los comprimidos anidados superan el límite de ${Math.round(limits.maxNestedBytes / 1024 ** 2).toLocaleString('es-ES')} MB.`,
          );
        }

        await onNestedArchive({
          name: item.name,
          path: item.path,
          data,
          size,
          lastModified: item.lastModified,
        });
      } else {
        if (validatePdf && !isPdfSignature(data)) {
          throw new ExtractionError(
            'ERR_INVALID_PDF',
            `El archivo "${item.name}" tiene extensión .pdf pero no contiene una firma PDF válida.`,
          );
        }

        extractedBytes += size;
        if (extractedBytes > limits.maxTotalUncompressedBytes) {
          throw new ExtractionError(
            'ERR_LIMIT',
            'El contenido descomprimido supera el límite de seguridad del procesamiento.',
          );
        }

        await onPdf({
          name: item.name,
          path: item.path,
          data,
          size,
          lastModified: item.lastModified,
        });
      }
    } catch (error) {
      if (error?.code === 'ERR_LIMIT' || error?.code === 'ERR_WRITE') throw error;
      if (item.kind === 'nested') {
        onNestedError(error, item);
      } else {
        onPdfError(error, item);
      }
    }

    processed += 1;
    onProgress({
      processed,
      total: work.length,
      pdfCount: analysis.pdfs.length,
      nestedCount: analysis.nested.length,
    });
  }

  return {
    pdfCount: analysis.pdfs.length,
    nestedCount: analysis.nested.length,
    totalEntries: analysis.totalEntries,
    totalFiles: analysis.totalFiles,
    processed,
  };
}

/** Compatibilidad con la API anterior. */
export async function extractZipPdfEntries(zip, options = {}) {
  const result = await extractZipEntries(zip, { ...options, recursive: false });
  return { pdfCount: result.pdfCount, processed: result.processed };
}
