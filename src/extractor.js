/**
 * Orquestador de la extracción. Recorre los ZIP y RAR seleccionados (y sus
 * comprimidos anidados si se activa), reúne únicamente los PDF, resuelve
 * nombres duplicados y construye un único ZIP.
 */
import { ZipExtractor } from './zip-handler.js';
import { extractRarPdfs } from './rar-handler.js';
import { ZipBuilder } from './zip-builder.js';
import { DEFAULT_OPTIONS, LIMITS, NAMING_MODE } from './config.js';
import {
  ARCHIVE_TYPE,
  OUTPUT_FILE_NAME,
  createNameRegistry,
  createOutputBudget,
  describeError,
  detectArchiveType,
  ExtractionError,
  sanitizeArchivePrefix,
} from './utils.js';

const EXPECTED_ARCHIVE_ERRORS = new Set([
  'ERR_ENCRYPTED',
  'ERR_MULTIPART',
  'ERR_CORRUPT',
  'ERR_UNSUPPORTED',
  'ERR_MEMORY',
  'ERR_READ',
  'ERR_LIMIT',
  'ERR_INVALID_PDF',
]);

function cancelledError() {
  return new ExtractionError('ERR_CANCELLED', 'La extracción se canceló.');
}

function isCancellation(error) {
  return error?.code === 'ERR_CANCELLED';
}

/**
 * @param {File[]} files
 * @param {{
 *   onEvent?: (event: object) => void,
 *   signal?: AbortSignal,
 *   namingMode?: 'flat' | 'archive-prefix',
 *   recursive?: boolean,
 *   validatePdf?: boolean,
 *   limits?: object,
 * }} options
 * @returns {Promise<{ blob: Blob | null, stats: object, outputName: string }>}
 */
export async function extractAllPdfs(files, options = {}) {
  const {
    onEvent = () => {},
    signal = null,
    namingMode = DEFAULT_OPTIONS.namingMode,
    recursive = DEFAULT_OPTIONS.recursive,
    validatePdf = DEFAULT_OPTIONS.validatePdf,
  } = options;

  const limits = { ...LIMITS, ...(options.limits || {}) };

  const emit = (event) => {
    try {
      onEvent(event);
    } catch (error) {
      console.error('Error en el manejador de progreso:', error);
    }
  };

  const stats = {
    archivesTotal: files.length,
    archivesDone: 0,
    archivesWithoutPdf: 0,
    topLevelArchives: files.length,
    nestedArchives: 0,
    nestedFailed: 0,
    nestedSkipped: 0,
    nestedBytes: 0,
    pdfFound: 0,
    pdfExtracted: 0,
    pdfFailed: 0,
    extractedBytes: 0,
    cancelled: false,
    limitReached: false,
    errors: [],
    records: [],
  };

  // Un único AbortController combina la cancelación del usuario con el corte
  // de seguridad por límites globales del lote.
  const abortController = new AbortController();
  const effectiveSignal = abortController.signal;
  const handleExternalAbort = () => abortController.abort();

  if (signal?.aborted) abortController.abort();
  else signal?.addEventListener?.('abort', handleExternalAbort, { once: true });

  const outputBudget = createOutputBudget(limits);
  let fatalError = null;

  const stopForLimit = (message) => {
    if (!fatalError) {
      fatalError = new ExtractionError('ERR_BATCH_LIMIT', message);
      stats.limitReached = true;
      abortController.abort();
    }
    return fatalError;
  };

  // Un fallo al escribir el ZIP de salida (disco lleno, almacenamiento no
  // disponible...) detiene el lote: seguir extrayendo solo gastaría tiempo.
  const stopForWrite = (cause) => {
    if (!fatalError) {
      fatalError = new ExtractionError(
        'ERR_WRITE',
        'No se pudo guardar el ZIP de salida. Comprueba el espacio libre del dispositivo y prueba con un lote más pequeño.',
        { cause },
      );
      abortController.abort();
    }
    return fatalError;
  };

  const throwIfCancelled = () => {
    if (fatalError) throw fatalError;
    if (effectiveSignal.aborted) throw cancelledError();
  };

  const nameRegistry = createNameRegistry();
  const zipExtractor = new ZipExtractor();

  // El ZIP final se escribe en streaming (OPFS o memoria) desde un worker:
  // los PDF se transfieren y se liberan uno a uno en lugar de acumularse.
  const output = new ZipBuilder();
  const outputMode = await output.start();

  function addError(entry) {
    stats.errors.push(entry);
    return entry;
  }

  async function processArchive(context) {
    const { file, label, format, depth = 0, namePrefix = '', parentLabel = '' } = context;

    throwIfCancelled();

    emit({
      type: 'archive-start',
      name: label,
      format,
      depth,
      parent: parentLabel,
      index: stats.archivesDone,
      total: stats.archivesTotal,
    });

    let archivePdfCount = 0;
    let infoRegistered = false;
    let archiveHadError = false;
    const nestedItems = [];

    const registerArchiveInfo = (info) => {
      if (infoRegistered) return;
      infoRegistered = true;
      archivePdfCount = Number(info?.pdfCount) || 0;
      stats.pdfFound += archivePdfCount;

      emit({
        type: 'archive-info',
        name: label,
        totalEntries: Number(info?.totalEntries) || 0,
        pdfCount: archivePdfCount,
        nestedCount: Number(info?.nestedCount) || 0,
        pdfFound: stats.pdfFound,
      });
    };

    const handlePdf = async (pdf) => {
      if (fatalError) return;
      throwIfCancelled();

      const pdfBytes = Number(pdf.data?.byteLength ?? pdf.size ?? 0);
      const exceeded = outputBudget.describeExceeded(pdfBytes);

      if (exceeded) {
        const limitError = stopForLimit(exceeded);
        const path = pdf.path || pdf.name;
        addError({
          archive: label,
          path,
          code: limitError.code,
          message: limitError.message,
          detail: '',
        });
        emit({ type: 'batch-limit', archive: label, path, message: limitError.message });
        return;
      }

      const rawName =
        namingMode === NAMING_MODE.ARCHIVE_PREFIX && namePrefix
          ? `${namePrefix}_${pdf.name}`
          : pdf.name;
      const uniqueName = nameRegistry.getUniqueName(rawName);
      const lastModified = Number(pdf.lastModified) || Date.now();

      try {
        // El búfer se transfiere al worker del ZIP y se escribe en streaming:
        // después de esta llamada ya no se conserva en memoria.
        await output.add({ name: uniqueName, data: pdf.data, lastModified });
      } catch (error) {
        if (error?.code === 'ERR_WRITE') throw stopForWrite(error);
        if (fatalError) throw fatalError;
        if (isCancellation(error) || effectiveSignal.aborted) throw cancelledError();

        stats.pdfFailed += 1;
        const info = describeError(error);
        const entry = addError({
          archive: label,
          path: pdf.path || pdf.name,
          ...info,
        });
        emit({ type: 'pdf-error', archive: label, path: entry.path, ...info });
        return;
      }

      const record = {
        archive: label,
        originalPath: pdf.path || pdf.name,
        originalName: pdf.name,
        outputName: uniqueName,
        size: pdfBytes,
        lastModified,
        nestedDepth: depth,
      };

      outputBudget.add(pdfBytes);
      stats.pdfExtracted += 1;
      stats.extractedBytes = outputBudget.bytes;
      stats.records.push(record);

      emit({
        type: 'pdf-extracted',
        archive: label,
        originalName: pdf.name,
        name: uniqueName,
        path: record.originalPath,
        extracted: stats.pdfExtracted,
        record,
      });
    };

    const handlePdfError = (error, entry) => {
      if (fatalError || effectiveSignal.aborted) return;

      stats.pdfFailed += 1;
      const info = describeError(error);
      const path = entry?.path || entry?.name || label;
      addError({ archive: label, path, ...info });
      emit({ type: 'pdf-error', archive: label, path, ...info });
    };

    const queueNested = (nested) => {
      if (fatalError || effectiveSignal.aborted) return;
      nestedItems.push(nested);
      emit({
        type: 'nested-found',
        archive: label,
        name: nested.name,
        path: nested.path,
      });
    };

    const handleNestedError = (error, entry) => {
      if (fatalError || effectiveSignal.aborted) return;

      stats.nestedFailed += 1;
      const info = describeError(error);
      const path = entry?.path || entry?.name || label;
      addError({ archive: label, path, ...info });
      emit({ type: 'nested-error', archive: label, path, ...info });
    };

    const commonCallbacks = {
      signal: effectiveSignal,
      recursive,
      validatePdf,
      limits,
      onStart: registerArchiveInfo,
      onPdf: handlePdf,
      onPdfError: handlePdfError,
      onNestedArchive: queueNested,
      onNestedError: handleNestedError,
      onProgress: ({ processed, total }) => {
        emit({
          type: 'archive-progress',
          name: label,
          processed,
          total,
          fraction: total > 0 ? processed / total : 0,
        });
      },
    };

    try {
      if (format === ARCHIVE_TYPE.ZIP) {
        await zipExtractor.extract(file, commonCallbacks);
      } else if (format === ARCHIVE_TYPE.RAR) {
        await extractRarPdfs(file, {
          ...commonCallbacks,
          nested: depth > 0,
        });
      } else {
        throw new ExtractionError(
          'ERR_UNSUPPORTED',
          'Solo se admiten archivos con extensión ZIP o RAR.',
        );
      }
    } catch (error) {
      if (fatalError) throw fatalError;
      if (isCancellation(error) || effectiveSignal.aborted) throw cancelledError();

      archiveHadError = true;
      const info = describeError(error);
      addError({ archive: label, ...info });
      emit({ type: 'archive-error', archive: label, ...info });

      if (!EXPECTED_ARCHIVE_ERRORS.has(info.code)) {
        console.error(`No se pudo procesar "${label}":`, error);
      } else {
        console.warn(`Incidencia controlada en "${label}": ${info.message}`);
      }
    } finally {
      stats.archivesDone += 1;

      if (!archiveHadError && archivePdfCount === 0) {
        stats.archivesWithoutPdf += 1;
      }

      emit({
        type: 'archive-done',
        name: label,
        archivesDone: stats.archivesDone,
        archivesTotal: stats.archivesTotal,
        totalEntries: 0,
        nestedCount: nestedItems.length,
      });
    }

    // Los comprimidos anidados se procesan de uno en uno, después de cerrar el
    // archivo contenedor, para no multiplicar el uso de memoria. Se sacan de la
    // cola con shift() para liberar cada búfer en cuanto se procesa.
    while (nestedItems.length > 0) {
      const item = nestedItems.shift();
      if (fatalError) throw fatalError;
      if (effectiveSignal.aborted) return;

      if (depth + 1 > limits.maxNestedDepth) {
        stats.nestedSkipped += 1;
        const info = {
          code: 'ERR_LIMIT',
          message: `No se abrió "${item.name}" porque se alcanzó la profundidad máxima de comprimidos anidados (${limits.maxNestedDepth}).`,
        };
        addError({ archive: label, path: item.path || item.name, ...info });
        emit({
          type: 'nested-error',
          archive: label,
          path: item.path || item.name,
          ...info,
        });
        continue;
      }

      if (stats.nestedArchives >= limits.maxNestedArchives) {
        stats.nestedSkipped += 1;
        const info = {
          code: 'ERR_LIMIT',
          message: `No se abrió "${item.name}" porque se alcanzó el límite de ${limits.maxNestedArchives} comprimidos anidados.`,
        };
        addError({ archive: label, path: item.path || item.name, ...info });
        emit({
          type: 'nested-error',
          archive: label,
          path: item.path || item.name,
          ...info,
        });
        continue;
      }

      const nestedSize = Number(item.size) || item.data?.byteLength || 0;
      if (stats.nestedBytes + nestedSize > limits.maxNestedBytes) {
        stats.nestedSkipped += 1;
        const info = {
          code: 'ERR_LIMIT',
          message: `No se abrió "${item.name}" porque los comprimidos anidados superan el límite de ${Math.round(
            limits.maxNestedBytes / 1024 ** 2,
          ).toLocaleString('es-ES')} MB.`,
        };
        addError({ archive: label, path: item.path || item.name, ...info });
        emit({
          type: 'nested-error',
          archive: label,
          path: item.path || item.name,
          ...info,
        });
        continue;
      }

      const nestedFormat = detectArchiveType({ name: item.name });
      if (nestedFormat === ARCHIVE_TYPE.UNKNOWN) {
        stats.nestedFailed += 1;
        const info = {
          code: 'ERR_UNSUPPORTED',
          message: `El comprimido anidado "${item.name}" no tiene un formato compatible.`,
        };
        addError({ archive: label, path: item.path || item.name, ...info });
        emit({
          type: 'nested-error',
          archive: label,
          path: item.path || item.name,
          ...info,
        });
        continue;
      }

      stats.nestedArchives += 1;
      stats.nestedBytes += nestedSize;
      stats.archivesTotal += 1;

      const nestedLabel = `${label} → ${item.name}`;
      const nestedPrefix = sanitizeArchivePrefix(
        `${namePrefix || sanitizeArchivePrefix(label)}_${item.name}`,
      );

      emit({
        type: 'nested-start',
        name: item.name,
        archive: nestedLabel,
        parent: label,
        depth: depth + 1,
        nestedArchives: stats.nestedArchives,
      });

      try {
        await processArchive({
          file: new File([item.data], item.name, {
            type: nestedFormat === ARCHIVE_TYPE.ZIP ? 'application/zip' : 'application/vnd.rar',
            lastModified: Number(item.lastModified) || Date.now(),
          }),
          label: nestedLabel,
          format: nestedFormat,
          depth: depth + 1,
          namePrefix: nestedPrefix,
          parentLabel: label,
        });
      } catch (error) {
        if (fatalError) throw fatalError;
        if (isCancellation(error) || effectiveSignal.aborted) return;
        stats.nestedFailed += 1;
        const info = describeError(error);
        addError({ archive: nestedLabel, ...info });
        emit({ type: 'nested-error', archive: nestedLabel, ...info });
      }
    }
  }

  emit({ type: 'start', totalArchives: files.length });
  emit({ type: 'output-ready', streaming: Boolean(outputMode?.streaming) });

  for (let index = 0; index < files.length; index += 1) {
    if (fatalError) break;

    if (effectiveSignal.aborted) {
      stats.cancelled = true;
      break;
    }

    const file = files[index];
    const format = detectArchiveType(file);
    const prefix = sanitizeArchivePrefix(file.name);

    try {
      await processArchive({
        file,
        label: file.name,
        format,
        depth: 0,
        namePrefix: prefix,
      });
      if (fatalError) break;
    } catch (error) {
      if (fatalError) break;

      if (isCancellation(error) || effectiveSignal.aborted) {
        stats.cancelled = true;
        break;
      }

      const info = describeError(error);
      addError({ archive: 'Proceso general', path: file.name, ...info });
      emit({ type: 'archive-error', archive: file.name, ...info });
    }
  }

  if (fatalError?.code === 'ERR_BATCH_LIMIT') stats.limitReached = true;
  else if (!fatalError && effectiveSignal.aborted) stats.cancelled = true;

  // Si falló la escritura del ZIP no tiene sentido intentar cerrarlo: se
  // descarta y se informa del error real.
  if (fatalError?.code === 'ERR_WRITE') {
    await output.discard();
    throw fatalError;
  }

  if (stats.cancelled) {
    emit({
      type: 'cancelled',
      message: 'La extracción se canceló. Se conservarán los PDF ya extraídos.',
      stats,
    });
  }

  let blob = null;
  let storage = null;

  if (stats.pdfExtracted > 0) {
    emit({ type: 'zip-start' });

    try {
      const result = await output.finalize();
      blob = result.blob;
      storage = result.storage;
    } catch (error) {
      await output.discard();
      throw error;
    }

    emit({ type: 'zip-progress', percent: 100 });
  } else {
    await output.discard();
  }

  emit({ type: 'done', stats });
  signal?.removeEventListener?.('abort', handleExternalAbort);

  return {
    blob,
    stats,
    outputName: OUTPUT_FILE_NAME,
    storage,
  };
}
