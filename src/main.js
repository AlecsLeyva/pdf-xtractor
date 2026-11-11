import './style.css';
import { extractAllPdfs } from './extractor.js';
import { DEFAULT_OPTIONS, LIMITS, NAMING_MODE } from './config.js';
import { cleanupStaleOutputs, discardOutput } from './output-store.js';
import {
  ARCHIVE_TYPE,
  CSV_FILE_NAME,
  OUTPUT_FILE_NAME,
  buildExtractionCsv,
  describeError,
  detectArchiveType,
  fileFingerprint,
  formatBytes,
  formatNumber,
  isMultipartRar,
} from './utils.js';

const $ = (id) => document.getElementById(id);

const els = {
  dropzone: $('dropzone'),
  selectButton: $('selectButton'),
  fileInput: $('fileInput'),
  selectionNotice: $('selectionNotice'),
  filesPanel: $('filesPanel'),
  fileList: $('fileList'),
  fileCount: $('fileCount'),
  fileCountLabel: $('fileCountLabel'),
  totalSize: $('totalSize'),
  formatSummary: $('formatSummary'),
  clearButton: $('clearButton'),
  optionsPanel: $('optionsPanel'),
  recursiveOption: $('recursiveOption'),
  validateOption: $('validateOption'),
  actionRow: $('actionRow'),
  extractButton: $('extractButton'),
  progressPanel: $('progressPanel'),
  progressStage: $('progressStage'),
  progressPercent: $('progressPercent'),
  progressTrack: $('progressTrack'),
  progressBar: $('progressBar'),
  currentFile: $('currentFile'),
  currentFileText: $('currentFileText'),
  cancelButton: $('cancelButton'),
  statArchives: $('statArchives'),
  statFound: $('statFound'),
  statExtracted: $('statExtracted'),
  statNestedWrapper: $('statNestedWrapper'),
  statNested: $('statNested'),
  statErrors: $('statErrors'),
  progressHint: $('progressHint'),
  resultsPanel: $('resultsPanel'),
  resultIcon: $('resultIcon'),
  resultsTitle: $('results-title'),
  resultMessage: $('resultMessage'),
  resultArchives: $('resultArchives'),
  resultNested: $('resultNested'),
  resultFound: $('resultFound'),
  resultExtracted: $('resultExtracted'),
  resultErrors: $('resultErrors'),
  resultErrorsStat: $('resultErrorsStat'),
  resultNotes: $('resultNotes'),
  extractedDetails: $('extractedDetails'),
  extractedCount: $('extractedCount'),
  extractedList: $('extractedList'),
  extractedMore: $('extractedMore'),
  errorSection: $('errorSection'),
  errorList: $('errorList'),
  downloadButton: $('downloadButton'),
  csvButton: $('csvButton'),
  resetButton: $('resetButton'),
  installButton: $('installButton'),
};

const RESULT_ICON_STROKE = Object.freeze({
  stroke: 'currentColor',
  'stroke-width': '1.9',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
});
const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

/** Construye los iconos con DOM API; nunca se inyecta HTML dinámico. */
function createResultIcon(variant) {
  const svg = createSvgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
  });

  if (variant === 'success') {
    svg.append(
      createSvgElement('path', {
        d: 'm5 12.5 4.5 4.5L19 7.5',
        ...RESULT_ICON_STROKE,
        'stroke-width': '2.2',
      }),
    );
  } else if (variant === 'warning') {
    svg.append(
      createSvgElement('path', {
        d: 'M12 4.2 21 20H3L12 4.2Z',
        ...RESULT_ICON_STROKE,
        'stroke-linejoin': 'round',
      }),
      createSvgElement('path', { d: 'M12 9.6v4.6', ...RESULT_ICON_STROKE }),
      createSvgElement('circle', {
        cx: '12',
        cy: '17.1',
        r: '1.1',
        fill: 'currentColor',
      }),
    );
  } else {
    svg.append(
      createSvgElement('circle', {
        cx: '12',
        cy: '12',
        r: '8.5',
        ...RESULT_ICON_STROKE,
      }),
      createSvgElement('path', { d: 'm9 9 6 6m0-6-6 6', ...RESULT_ICON_STROKE }),
    );
  }

  return svg;
}

function createRemoveIcon() {
  const svg = createSvgElement('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
  });
  svg.append(
    createSvgElement('path', {
      d: 'M7.5 7.5 16.5 16.5m0-9-9 9',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
    }),
  );
  return svg;
}

const state = {
  files: [],
  result: null,
  processing: false,
  nextId: 1,
  controller: null,
  installPrompt: null,
  options: { ...DEFAULT_OPTIONS },
};

let archivesDone = 0;
let archivesTotal = 0;
let uiErrors = 0;
let uiExtracted = 0;
let uiNested = 0;
let currentArchiveName = '';

/* -------------------------------------------------------------------------- */
/* Opciones                                                                    */
/* -------------------------------------------------------------------------- */

function readOptionsFromUI() {
  const selected = document.querySelector('input[name="namingMode"]:checked')?.value;
  return {
    namingMode:
      selected === NAMING_MODE.ARCHIVE_PREFIX ? NAMING_MODE.ARCHIVE_PREFIX : NAMING_MODE.FLAT,
    recursive: Boolean(els.recursiveOption?.checked),
    validatePdf: Boolean(els.validateOption?.checked),
  };
}

function syncOptionsFromUI() {
  state.options = readOptionsFromUI();
}

/* -------------------------------------------------------------------------- */
/* Selección de archivos                                                       */
/* -------------------------------------------------------------------------- */

function addFiles(fileList) {
  if (state.processing) return;

  const incoming = Array.from(fileList ?? []);
  if (incoming.length === 0) return;

  const existingFingerprints = new Set(state.files.map((item) => item.fingerprint));
  const available = Math.max(0, LIMITS.maxSelectedArchives - state.files.length);
  let added = 0;
  let rejected = 0;
  let duplicated = 0;
  let limitReached = false;
  let bytesLimitReached = false;
  let incomingBytes = 0;
  const currentBytes = state.files.reduce(
    (sum, item) => sum + (Number(item.file.size) || 0),
    0,
  );

  for (const file of incoming) {
    const type = detectArchiveType(file);

    if (type === ARCHIVE_TYPE.UNKNOWN) {
      rejected += 1;
      continue;
    }

    if (added >= available) {
      limitReached = true;
      break;
    }

    const fileBytes = Number(file.size) || 0;
    if (currentBytes + incomingBytes + fileBytes > LIMITS.maxInputBytes) {
      bytesLimitReached = true;
      break;
    }

    const fingerprint = fileFingerprint(file);
    if (existingFingerprints.has(fingerprint)) {
      duplicated += 1;
      continue;
    }

    existingFingerprints.add(fingerprint);
    incomingBytes += fileBytes;
    state.files.push({
      id: state.nextId,
      file,
      type,
      fingerprint,
    });
    state.nextId += 1;
    added += 1;
  }

  if (added > 0) {
    clearResult();
    els.progressPanel.hidden = true;
    renderFiles();
  }

  const notices = [];
  if (rejected > 0) {
    notices.push(
      `${rejected} ${rejected === 1 ? 'archivo se ignoró' : 'archivos se ignoraron'}: solo se admiten ZIP y RAR.`,
    );
  }
  if (duplicated > 0) {
    notices.push(
      `${duplicated} ${duplicated === 1 ? 'archivo ya estaba' : 'archivos ya estaban'} en la lista.`,
    );
  }
  if (limitReached) {
    notices.push(
      `Solo se pueden añadir ${formatNumber(LIMITS.maxSelectedArchives)} comprimidos por lote.`,
    );
  }
  if (bytesLimitReached) {
    notices.push(
      `El lote no puede superar ${formatBytes(LIMITS.maxInputBytes)} en total. Se han añadido solo los archivos que cabían.`,
    );
  }
  if (incomingBytes > LIMITS.warnInputBytes) {
    notices.push(
      `El lote supera ${formatBytes(LIMITS.warnInputBytes)}. El proceso puede tardar y consumir bastante memoria.`,
    );
  }

  showNotice(notices.join(' '));
}

function showNotice(message) {
  if (!message) {
    els.selectionNotice.hidden = true;
    els.selectionNotice.textContent = '';
    return;
  }
  els.selectionNotice.textContent = message;
  els.selectionNotice.hidden = false;
}

function removeFile(id) {
  if (state.processing) return;

  state.files = state.files.filter((item) => item.id !== id);
  clearResult();
  renderFiles();
  showNotice('');
}

function clearAllFiles() {
  if (state.processing) return;

  state.files = [];
  state.nextId = 1;
  clearResult();
  els.progressPanel.hidden = true;
  els.fileInput.value = '';
  renderFiles();
  showNotice('');
}

function createFileRow(entry) {
  const row = document.createElement('li');
  row.className = 'file-row';

  const badge = document.createElement('span');
  badge.className = `file-badge file-badge--${entry.type}`;
  badge.textContent = entry.type.toUpperCase();
  badge.setAttribute('aria-hidden', 'true');

  const info = document.createElement('span');
  info.className = 'file-row__info';

  const name = document.createElement('span');
  name.className = 'file-row__name';
  name.textContent = entry.file.name;
  name.title = entry.file.name;

  const meta = document.createElement('span');
  meta.className = 'file-row__meta';
  const details = [formatBytes(entry.file.size), entry.type.toUpperCase()];
  if (entry.type === ARCHIVE_TYPE.RAR && isMultipartRar(entry.file.name)) {
    details.push('multiparte · no compatible');
  }
  meta.textContent = details.join(' · ');

  info.append(name, meta);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'icon-button';
  removeButton.dataset.remove = String(entry.id);
  removeButton.setAttribute('aria-label', `Quitar ${entry.file.name} de la lista`);
  removeButton.title = 'Quitar de la lista';
  removeButton.disabled = state.processing;
  removeButton.append(createRemoveIcon());

  row.append(badge, info, removeButton);
  return row;
}

function renderFiles() {
  const count = state.files.length;

  els.filesPanel.hidden = count === 0;
  els.optionsPanel.hidden = count === 0;
  els.actionRow.hidden = count === 0;

  els.fileCount.textContent = formatNumber(count);
  els.fileCountLabel.textContent = count === 1 ? 'archivo' : 'archivos';

  const totalBytes = state.files.reduce((sum, item) => sum + (item.file.size || 0), 0);
  els.totalSize.textContent = formatBytes(totalBytes);

  const zipCount = state.files.filter((item) => item.type === ARCHIVE_TYPE.ZIP).length;
  const rarCount = state.files.filter((item) => item.type === ARCHIVE_TYPE.RAR).length;
  const formats = [];
  if (zipCount > 0) formats.push(`${formatNumber(zipCount)} ZIP`);
  if (rarCount > 0) formats.push(`${formatNumber(rarCount)} RAR`);
  els.formatSummary.textContent = formats.join(' · ') || '—';

  const fragment = document.createDocumentFragment();
  for (const entry of state.files) {
    fragment.append(createFileRow(entry));
  }
  els.fileList.replaceChildren(fragment);

  els.clearButton.disabled = state.processing || count === 0;
  els.extractButton.disabled = state.processing || count === 0;
}

/* -------------------------------------------------------------------------- */
/* Resultado y descargas                                                       */
/* -------------------------------------------------------------------------- */

function clearResult() {
  if (state.result?.url) {
    URL.revokeObjectURL(state.result.url);
  }
  if (state.result?.storage) {
    void discardOutput(state.result.storage);
  }
  state.result = null;
  els.resultsPanel.hidden = true;
  els.downloadButton.disabled = true;
  els.csvButton.disabled = true;
  els.extractedDetails.hidden = true;
  els.extractedList.replaceChildren();
}

function downloadResult() {
  if (!state.result?.url) return;

  const link = document.createElement('a');
  link.href = state.result.url;
  link.download = OUTPUT_FILE_NAME;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadCsv() {
  const records = state.result?.stats?.records ?? [];
  if (records.length === 0) return;

  const blob = new Blob([buildExtractionCsv(records)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = CSV_FILE_NAME;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderExtractedList(records) {
  els.extractedList.replaceChildren();

  if (records.length === 0) {
    els.extractedDetails.hidden = true;
    return;
  }

  els.extractedDetails.hidden = false;
  els.extractedCount.textContent = formatNumber(records.length);

  const maxVisible = 300;
  const fragment = document.createDocumentFragment();

  for (const record of records.slice(0, maxVisible)) {
    const item = document.createElement('li');
    item.className = 'extracted-item';

    const name = document.createElement('span');
    name.className = 'extracted-item__name';
    name.textContent = record.outputName;
    name.title = record.outputName;

    const meta = document.createElement('span');
    meta.className = 'extracted-item__meta';
    const nested = record.nestedDepth > 0 ? ' · anidado' : '';
    meta.textContent = `${record.archive} → ${record.originalPath} · ${formatBytes(
      record.size,
    )}${nested}`;
    meta.title = meta.textContent;

    item.append(name, meta);
    fragment.append(item);
  }

  els.extractedList.append(fragment);

  if (records.length > maxVisible) {
    els.extractedMore.hidden = false;
    els.extractedMore.textContent = `… y ${formatNumber(
      records.length - maxVisible,
    )} PDF más. El informe CSV incluye la lista completa.`;
  } else {
    els.extractedMore.hidden = true;
    els.extractedMore.textContent = '';
  }
}

function renderErrorList(errors) {
  els.errorList.replaceChildren();

  if (errors.length === 0) {
    els.errorSection.hidden = true;
    return;
  }

  els.errorSection.hidden = false;
  const maxVisible = 60;
  const fragment = document.createDocumentFragment();

  for (const error of errors.slice(0, maxVisible)) {
    const item = document.createElement('li');
    item.className = 'error-item';

    const archive = document.createElement('span');
    archive.className = 'error-item__archive';
    archive.textContent =
      error.path && error.path !== error.archive
        ? `${error.archive} → ${error.path}`
        : error.archive;

    const message = document.createElement('span');
    message.className = 'error-item__message';
    message.textContent = error.message;

    item.append(archive, message);

    if (error.detail && error.detail !== error.message) {
      const detail = document.createElement('span');
      detail.className = 'error-item__detail';
      detail.textContent = `Detalle técnico: ${error.detail}`;
      item.append(detail);
    }

    fragment.append(item);
  }

  if (errors.length > maxVisible) {
    const item = document.createElement('li');
    item.className = 'error-item';

    const message = document.createElement('span');
    message.className = 'error-item__message';
    message.textContent = `… y ${formatNumber(errors.length - maxVisible)} incidencias más.`;
    item.append(message);
    fragment.append(item);
  }

  els.errorList.append(fragment);
}

function showResults(stats) {
  const errors = stats.errors ?? [];
  const errorCount = errors.length;
  const extracted = stats.pdfExtracted;
  const cancelled = Boolean(stats.cancelled);
  let variant;
  let title;
  let message;

  if (cancelled) {
    variant = 'warning';
    title = 'Extracción cancelada';
    message =
      extracted > 0
        ? `Se canceló el proceso, pero se conservan ${formatNumber(extracted)} PDF ya extraídos. Puedes descargarlos o generar el informe CSV.`
        : 'Se canceló el proceso antes de extraer ningún PDF. No se ha generado ningún archivo.';
  } else if (stats.limitReached) {
    variant = 'warning';
    title = 'Extracción detenida por seguridad';
    message =
      extracted > 0
        ? `El lote alcanzó un límite de seguridad. Se detuvo el proceso y se conservan ${formatNumber(extracted)} PDF ya extraídos.`
        : 'El lote alcanzó un límite de seguridad antes de extraer ningún PDF. No se ha generado ningún archivo.';
  } else if (extracted > 0 && errorCount === 0) {
    variant = 'success';
    title = '¡Extracción completada!';
    message = `Se han reunido ${formatNumber(extracted)} PDF de ${formatNumber(
      stats.archivesDone,
    )} ${stats.archivesDone === 1 ? 'comprimido' : 'comprimidos'} en un único ${OUTPUT_FILE_NAME}.`;
  } else if (extracted > 0) {
    variant = 'warning';
    title = 'Extracción completada con incidencias';
    message = `Se han extraído ${formatNumber(extracted)} PDF, pero se encontraron ${formatNumber(
      errorCount,
    )} ${errorCount === 1 ? 'incidencia' : 'incidencias'}. El ZIP contiene solo los PDF que se pudieron leer.`;
  } else if (errorCount > 0) {
    variant = 'error';
    title = 'No se pudo extraer ningún PDF';
    message =
      'Ningún archivo pudo procesarse correctamente. Revisa las incidencias para conocer el motivo.';
  } else {
    variant = 'warning';
    title = 'No se encontraron PDF';
    message =
      'Los comprimidos se revisaron correctamente, pero no contenían ningún archivo con extensión .pdf.';
  }

  els.resultsPanel.classList.remove(
    'results-panel--success',
    'results-panel--warning',
    'results-panel--error',
  );
  els.resultsPanel.classList.add(`results-panel--${variant}`);

  els.resultIcon.classList.remove(
    'results__icon--success',
    'results__icon--warning',
    'results__icon--error',
  );
  els.resultIcon.classList.add(`results__icon--${variant}`);
  els.resultIcon.replaceChildren(createResultIcon(variant));

  els.resultsTitle.textContent = title;
  els.resultMessage.textContent = message;

  els.resultArchives.textContent = `${formatNumber(stats.archivesDone)} / ${formatNumber(
    stats.archivesTotal,
  )}`;
  els.resultNested.textContent = formatNumber(stats.nestedArchives ?? 0);
  els.resultFound.textContent = formatNumber(stats.pdfFound);
  els.resultExtracted.textContent = formatNumber(extracted);
  els.resultErrors.textContent = formatNumber(errorCount);
  els.resultErrorsStat.classList.toggle('result-stat--has-errors', errorCount > 0);

  const notes = [];
  if (stats.archivesWithoutPdf > 0) {
    notes.push(
      `${formatNumber(stats.archivesWithoutPdf)} ${
        stats.archivesWithoutPdf === 1 ? 'comprimido no contenía' : 'comprimidos no contenían'
      } ningún PDF.`,
    );
  }
  if (stats.pdfFailed > 0) {
    notes.push(
      `${formatNumber(stats.pdfFailed)} ${
        stats.pdfFailed === 1 ? 'PDF no se pudo extraer' : 'PDF no se pudieron extraer'
      } aunque el archivo se abrió correctamente.`,
    );
  }
  if ((stats.nestedArchives ?? 0) > 0) {
    notes.push(
      `${formatNumber(stats.nestedArchives)} ${
        stats.nestedArchives === 1
          ? 'comprimido anidado abierto'
          : 'comprimidos anidados abiertos'
      }.`,
    );
  }
  if ((stats.nestedSkipped ?? 0) > 0) {
    notes.push(
      `${formatNumber(stats.nestedSkipped)} ${
        stats.nestedSkipped === 1
          ? 'comprimido anidado se omitió'
          : 'comprimidos anidados se omitieron'
      } por los límites de seguridad.`,
    );
  }
  if (stats.limitReached) {
    notes.push(
      `El proceso se detuvo al superar un límite global del lote (${formatNumber(
        LIMITS.maxPdfsPerBatch,
      )} PDF o ${formatBytes(LIMITS.maxTotalExtractedBytes)}).`,
    );
  }
  if (extracted === 0) {
    notes.push(`No se generó ${OUTPUT_FILE_NAME} porque no había PDF que incluir.`);
  }

  els.resultNotes.textContent = notes.join(' ');
  els.resultNotes.hidden = notes.length === 0;

  renderExtractedList(stats.records ?? []);
  renderErrorList(errors);

  const canDownload = Boolean(state.result?.blob) && extracted > 0;
  els.downloadButton.disabled = !canDownload;
  els.downloadButton.title = canDownload
    ? `Descargar ${formatBytes(state.result.blob.size)} en ${OUTPUT_FILE_NAME}`
    : 'No hay ningún PDF para descargar';

  const canDownloadCsv = (stats.records?.length ?? 0) > 0;
  els.csvButton.disabled = !canDownloadCsv;
  els.csvButton.title = canDownloadCsv
    ? `Descargar el informe de ${formatNumber(stats.records.length)} PDF en ${CSV_FILE_NAME}`
    : 'No hay PDF para incluir en el informe';

  els.resultsPanel.hidden = false;
  els.resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  els.resultsPanel.focus({ preventScroll: true });
}

/* -------------------------------------------------------------------------- */
/* Progreso                                                                    */
/* -------------------------------------------------------------------------- */

function setProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const rounded = Math.round(safePercent);

  els.progressBar.style.width = `${safePercent}%`;
  els.progressPercent.textContent = `${rounded} %`;
  els.progressTrack.setAttribute('aria-valuenow', String(rounded));
}

function setCurrentFile(text, done = false) {
  els.currentFileText.textContent = text;
  els.currentFile.classList.toggle('progress__current--done', done);
}

function resetProgressUI() {
  archivesDone = 0;
  archivesTotal = state.files.length;
  uiErrors = 0;
  uiExtracted = 0;
  uiNested = 0;
  currentArchiveName = '';

  setProgress(0);
  els.progressStage.textContent = 'Preparando la extracción';
  setCurrentFile('Iniciando el análisis de los comprimidos…');
  els.statArchives.textContent = `0 / ${formatNumber(archivesTotal)}`;
  els.statFound.textContent = '0';
  els.statExtracted.textContent = '0';
  els.statNested.textContent = '0';
  els.statNestedWrapper.hidden = true;
  els.statErrors.textContent = '0';
  els.statErrors.dataset.zero = 'true';
  els.progressHint.hidden = true;
  els.progressHint.textContent = '';
  els.cancelButton.disabled = false;
}

function markErrorCount() {
  els.statErrors.textContent = formatNumber(uiErrors);
  els.statErrors.dataset.zero = uiErrors === 0 ? 'true' : 'false';
}

function handleProgressEvent(event) {
  switch (event.type) {
    case 'start':
      archivesTotal = event.totalArchives;
      archivesDone = 0;
      uiErrors = 0;
      els.statArchives.textContent = `0 / ${formatNumber(archivesTotal)}`;
      break;

    case 'archive-start':
      currentArchiveName = event.name;
      els.progressStage.textContent =
        event.depth > 0 ? 'Abriendo un comprimido anidado' : 'Analizando y extrayendo PDF';
      setCurrentFile(
        event.depth > 0 && event.parent
          ? `Dentro de ${event.parent}: ${event.name}…`
          : `Analizando ${event.name}…`,
      );
      setProgress((archivesDone / Math.max(archivesTotal, 1)) * 90);
      break;

    case 'archive-info':
      els.statFound.textContent = formatNumber(event.pdfFound);
      if (event.nestedCount > 0) {
        els.progressHint.textContent = `${formatNumber(
          event.nestedCount,
        )} comprimido(s) anidado(s) encontrado(s) en ${event.name}.`;
        els.progressHint.hidden = false;
      }
      break;

    case 'archive-progress': {
      const fraction = event.total > 0 ? event.fraction : 0;
      const overall = ((archivesDone + fraction) / Math.max(archivesTotal, 1)) * 90;
      setProgress(overall);
      setCurrentFile(
        event.total > 0
          ? `Analizando ${currentArchiveName} · ${formatNumber(event.processed)} de ${formatNumber(
              event.total,
            )} entradas`
          : `Analizando ${currentArchiveName}…`,
      );
      break;
    }

    case 'nested-found':
      els.progressHint.textContent = `Encontrado comprimido anidado: ${event.path || event.name}`;
      els.progressHint.hidden = false;
      break;

    case 'nested-start':
      uiNested += 1;
      els.statNestedWrapper.hidden = false;
      els.statNested.textContent = formatNumber(uiNested);
      els.progressStage.textContent = 'Abriendo un comprimido anidado';
      setCurrentFile(`Abriendo ${event.archive}…`);
      break;

    case 'batch-limit':
      els.progressHint.textContent = event.message;
      els.progressHint.hidden = false;
      els.progressStage.textContent = 'Deteniendo el proceso por seguridad';
      setCurrentFile('Se alcanzó un límite global del lote. Preparando los PDF ya extraídos…');
      break;

    case 'pdf-extracted':
      uiExtracted = event.extracted;
      els.statExtracted.textContent = formatNumber(event.extracted);
      break;

    case 'pdf-error':
    case 'archive-error':
    case 'nested-error':
      uiErrors += 1;
      markErrorCount();
      break;

    case 'archive-done':
      archivesDone = event.archivesDone;
      archivesTotal = event.archivesTotal;
      els.statArchives.textContent = `${formatNumber(archivesDone)} / ${formatNumber(
        archivesTotal,
      )}`;
      setProgress((archivesDone / Math.max(archivesTotal, 1)) * 90);
      if (archivesDone < archivesTotal) {
        setCurrentFile(`Comprimido revisado: ${event.name}`);
      } else {
        setCurrentFile('Todos los comprimidos han sido revisados.');
      }
      break;

    case 'cancelled':
      els.progressStage.textContent = 'Cancelando y preparando los PDF ya extraídos';
      setCurrentFile('La extracción se ha cancelado. Preparando el resultado parcial…');
      els.cancelButton.disabled = true;
      break;

    case 'output-ready':
      if (event.streaming) {
        els.progressHint.textContent =
          'Los PDF se guardan en disco a medida que se extraen para no llenar la memoria.';
        els.progressHint.hidden = false;
      }
      break;

    case 'zip-start':
      els.progressStage.textContent = `Creando ${OUTPUT_FILE_NAME}`;
      setProgress(90);
      setCurrentFile(`Guardando ${formatNumber(uiExtracted)} PDF en un único ZIP…`);
      break;

    case 'zip-progress':
      els.progressStage.textContent = `Creando ${OUTPUT_FILE_NAME}`;
      setProgress(90 + (event.percent / 100) * 10);
      break;

    case 'done': {
      const stats = event.stats;
      archivesDone = stats.archivesDone;
      archivesTotal = stats.archivesTotal;
      uiErrors = stats.errors.length;
      uiExtracted = stats.pdfExtracted;
      uiNested = stats.nestedArchives;

      els.statArchives.textContent = `${formatNumber(archivesDone)} / ${formatNumber(
        archivesTotal,
      )}`;
      els.statFound.textContent = formatNumber(stats.pdfFound);
      els.statExtracted.textContent = formatNumber(stats.pdfExtracted);
      els.statNested.textContent = formatNumber(stats.nestedArchives);
      els.statNestedWrapper.hidden = stats.nestedArchives === 0;
      markErrorCount();

      els.progressStage.textContent = stats.cancelled
        ? 'Proceso cancelado'
        : 'Proceso completado';
      setProgress(100);
      setCurrentFile(
        stats.cancelled ? 'Extracción cancelada.' : 'Extracción finalizada.',
        true,
      );
      break;
    }

    default:
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Extracción                                                                  */
/* -------------------------------------------------------------------------- */

function setBusy(busy) {
  state.processing = busy;

  els.dropzone.classList.toggle('dropzone--disabled', busy);
  els.dropzone.setAttribute('aria-disabled', String(busy));
  els.selectButton.disabled = busy;
  els.fileInput.disabled = busy;
  els.clearButton.disabled = busy || state.files.length === 0;
  els.extractButton.disabled = busy || state.files.length === 0;
  els.cancelButton.disabled = !busy;
  els.progressPanel.setAttribute('aria-busy', String(busy));

  for (const button of els.fileList.querySelectorAll('[data-remove]')) {
    button.disabled = busy;
  }
}

function cancelExtraction() {
  if (!state.controller || !state.processing) return;

  state.controller.abort();
  els.cancelButton.disabled = true;
  els.progressStage.textContent = 'Cancelando…';
  setCurrentFile('Deteniendo el procesamiento y preparando los PDF ya extraídos…');
}

async function startExtraction() {
  if (state.processing || state.files.length === 0) return;

  syncOptionsFromUI();

  const controller = new AbortController();
  state.controller = controller;

  setBusy(true);
  clearResult();
  showNotice('');
  els.resultsPanel.hidden = true;
  els.progressPanel.hidden = false;
  resetProgressUI();

  els.progressPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const files = state.files.map((item) => item.file);

  try {
    const { blob, stats, storage } = await extractAllPdfs(files, {
      ...state.options,
      signal: controller.signal,
      onEvent: handleProgressEvent,
    });

    if (blob) {
      state.result = {
        blob,
        url: URL.createObjectURL(blob),
        stats,
        storage: storage ?? null,
      };
    }

    showResults(stats);
  } catch (error) {
    console.error('La extracción falló de forma inesperada:', error);
    const info = describeError(error);
    const cancelled = controller.signal.aborted || info.code === 'ERR_CANCELLED';

    els.progressStage.textContent = cancelled
      ? 'Extracción cancelada'
      : 'El proceso no pudo completarse';
    setProgress(100);
    setCurrentFile(
      cancelled ? 'Extracción cancelada.' : 'La extracción no pudo completarse.',
      true,
    );
    els.progressHint.textContent = info.message;
    els.progressHint.hidden = false;

    showResults({
      archivesTotal: files.length,
      archivesDone: 0,
      archivesWithoutPdf: 0,
      nestedArchives: 0,
      nestedSkipped: 0,
      pdfFound: 0,
      pdfExtracted: 0,
      pdfFailed: 0,
      cancelled,
      records: [],
      errors: cancelled ? [] : [{ archive: 'Proceso general', ...info }],
    });
  } finally {
    state.controller = null;
    setBusy(false);
  }
}

/* -------------------------------------------------------------------------- */
/* Instalación como aplicación (PWA)                                           */
/* -------------------------------------------------------------------------- */

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    els.installButton.hidden = false;
  });

  els.installButton.addEventListener('click', async () => {
    if (!state.installPrompt) return;

    const prompt = state.installPrompt;
    state.installPrompt = null;
    els.installButton.hidden = true;

    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch (error) {
      console.warn('No se pudo mostrar la instalación:', error);
    }
  });

  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    els.installButton.hidden = true;
    showNotice('PDF Extractor se ha instalado como aplicación.');
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('No se pudo activar el modo sin conexión:', error);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Eventos de interfaz                                                         */
/* -------------------------------------------------------------------------- */

els.selectButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!state.processing) els.fileInput.click();
});

els.dropzone.addEventListener('click', (event) => {
  if (state.processing) return;
  if (event.target.closest('button')) return;
  els.fileInput.click();
});

els.fileInput.addEventListener('change', () => {
  addFiles(els.fileInput.files);
  els.fileInput.value = '';
});

els.fileList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove]');
  if (!button || state.processing) return;
  removeFile(Number(button.dataset.remove));
});

els.clearButton.addEventListener('click', clearAllFiles);
els.extractButton.addEventListener('click', startExtraction);
els.cancelButton.addEventListener('click', cancelExtraction);
els.downloadButton.addEventListener('click', downloadResult);
els.csvButton.addEventListener('click', downloadCsv);
els.resetButton.addEventListener('click', () => {
  clearAllFiles();
  els.progressPanel.hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  els.selectButton.focus({ preventScroll: true });
});

for (const input of document.querySelectorAll(
  'input[name="namingMode"], #recursiveOption, #validateOption',
)) {
  input.addEventListener('change', syncOptionsFromUI);
}

let dragDepth = 0;

function setDragActive(active) {
  els.dropzone.classList.toggle('dropzone--active', active);
}

els.dropzone.addEventListener('dragenter', (event) => {
  if (state.processing) return;
  event.preventDefault();
  dragDepth += 1;
  setDragActive(true);
});

els.dropzone.addEventListener('dragover', (event) => {
  if (state.processing) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

els.dropzone.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragActive(false);
});

els.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDragActive(false);
  if (state.processing) return;

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    addFiles(files);
    return;
  }

  const hasDirectory = Array.from(event.dataTransfer?.items ?? []).some(
    (item) => item.webkitGetAsEntry?.()?.isDirectory,
  );
  showNotice(
    hasDirectory
      ? 'Arrastra los archivos ZIP y RAR directamente, no carpetas.'
      : 'No se detectaron archivos compatibles en lo que has soltado.',
  );
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  if (!els.dropzone.contains(event.target)) event.preventDefault();
  setDragActive(false);
  dragDepth = 0;
});

window.addEventListener('pagehide', () => {
  if (state.result?.url) {
    URL.revokeObjectURL(state.result.url);
    state.result.url = null;
  }
});

/* Estado inicial */
setupInstallPrompt();
void cleanupStaleOutputs();
renderFiles();
