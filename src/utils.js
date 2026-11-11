/**
 * Utilidades compartidas por la interfaz, los manejadores de archivos y los tests.
 * Este módulo no toca el DOM para poder ejecutarse también en Node.
 */

export const ARCHIVE_TYPE = Object.freeze({
  ZIP: 'zip',
  RAR: 'rar',
  UNKNOWN: 'unknown',
});

export const OUTPUT_FILE_NAME = 'PDF_EXTRAIDOS.zip';
export const CSV_FILE_NAME = 'INFORME_PDF.csv';

const PDF_EXTENSION = '.pdf';

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex -- se eliminan caracteres de control a propósito.
const INVALID_FILENAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/g;
// Caracteres invisibles y de control bidireccional que pueden falsear el nombre
// mostrado (por ejemplo, ocultar la extensión real de un archivo).
const INVISIBLE_FILENAME_CHARS =
  /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;
// Fórmulas que Excel/LibreOffice pueden ejecutar al abrir un CSV.
const CSV_FORMULA_PREFIX = /^[\s]*[=+\-@\t\r]/;
// eslint-disable-next-line no-control-regex -- se eliminan controles no imprimibles.
const CSV_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Devuelve el nombre base de una ruta con separadores / o \. */
export function baseName(filePath) {
  const value = String(filePath ?? '');
  return value.split(/[\\/]/).pop() ?? '';
}

/** true si el nombre/ruta termina en .pdf sin importar mayúsculas. */
export function isPdfName(name) {
  return /\.pdf$/i.test(String(name ?? '').trim());
}

/** Detecta ZIP o RAR por extensión y, como respaldo, por tipo MIME. */
export function detectArchiveType(file) {
  const name = String(file?.name ?? '').toLowerCase();
  if (name.endsWith('.zip')) return ARCHIVE_TYPE.ZIP;
  if (name.endsWith('.rar')) return ARCHIVE_TYPE.RAR;

  const mime = String(file?.type ?? '').toLowerCase();
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') {
    return ARCHIVE_TYPE.ZIP;
  }
  if (mime === 'application/vnd.rar' || mime === 'application/x-rar-compressed') {
    return ARCHIVE_TYPE.RAR;
  }
  return ARCHIVE_TYPE.UNKNOWN;
}

/**
 * Los RAR divididos en volúmenes no pueden abrirse con libarchive.js porque la
 * biblioteca no permite proporcionar los volúmenes siguientes.
 */
export function isMultipartRar(name) {
  const value = String(name ?? '');
  return (
    /\.part\d+\.rar$/i.test(value) || /\.r\d{2}$/i.test(value) || /\.rar\.\d+$/i.test(value)
  );
}

/** true si la entrada es un ZIP o RAR que puede procesarse de forma anidada. */
export function isNestedArchiveName(name) {
  return /\.(zip|rar)$/i.test(String(name ?? '').trim());
}

/**
 * Comprueba la firma real de un PDF. La especificación permite que la cabecera
 * `%PDF-` aparezca dentro de los primeros 1024 bytes del archivo.
 */
export function isPdfSignature(data) {
  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : null;

  if (!bytes) return false;

  const limit = Math.min(bytes.length - 4, 1024);
  for (let index = 0; index <= limit; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Convierte el nombre de un comprimido en un prefijo seguro para los PDF.
 * Ejemplo: `lote 1.zip` → `lote 1`.
 */
export function sanitizeArchivePrefix(name) {
  const base = baseName(name)
    .replace(/\.(zip|rar)$/i, '')
    .trim();
  const safe = sanitizePdfName(`${base || 'archivo'}.pdf`);
  return safe.slice(0, -PDF_EXTENSION.length).slice(0, 60) || 'archivo';
}

/** Formatea un tamaño en bytes usando convenciones españolas. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;

  return `${value.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })} ${units[exponent]}`;
}

/** Formatea una cantidad con separadores de miles españoles. */
export function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-ES');
}

/**
 * Convierte cualquier nombre de PDF en un nombre seguro para el ZIP final:
 * elimina rutas, caracteres inválidos de Windows, espacios finales y limita
 * la longitud. Conserva el nombre original todo lo posible.
 */
export function sanitizePdfName(rawName) {
  let base = baseName(rawName)
    .replace(INVISIBLE_FILENAME_CHARS, '')
    .replace(INVALID_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  const match = base.match(/^(.*?)(\.pdf)$/i);
  let stem = match ? match[1] : base;

  stem = stem.replace(/[. ]+$/g, '').trim();
  if (!stem) stem = 'documento';
  if (WINDOWS_RESERVED_NAMES.test(stem)) stem = `_${stem}`;

  const maxStemLength = 150;
  if (stem.length > maxStemLength) {
    stem =
      stem
        .slice(0, maxStemLength)
        .replace(/[. ]+$/g, '')
        .trim() || 'documento';
  }

  return `${stem}${PDF_EXTENSION}`;
}

/**
 * Registro de nombres únicos para el ZIP final. Compara sin distinguir
 * mayúsculas para evitar colisiones en Windows y macOS.
 */
export function createNameRegistry() {
  const used = new Set();

  return {
    getUniqueName(rawName) {
      const safeName = sanitizePdfName(rawName);
      const stem = safeName.slice(0, -PDF_EXTENSION.length);
      let candidate = safeName;
      let counter = 1;

      while (used.has(candidate.toLowerCase())) {
        candidate = `${stem}_${counter}${PDF_EXTENSION}`;
        counter += 1;
      }

      used.add(candidate.toLowerCase());
      return candidate;
    },
    get size() {
      return used.size;
    },
  };
}

export class ExtractionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

const ERROR_MESSAGES = {
  ERR_ENCRYPTED:
    'El archivo está protegido con contraseña y no se puede extraer. Extráelo con 7-Zip o WinRAR y vuelve a comprimirlo sin contraseña.',
  ERR_MULTIPART:
    'Los RAR multiparte no son compatibles. Une todas las partes en un único RAR antes de extraer.',
  ERR_CORRUPT: 'El archivo está dañado o no es un ZIP/RAR válido.',
  ERR_UNSUPPORTED: 'Formato no compatible. Solo se admiten archivos ZIP y RAR.',
  ERR_MEMORY:
    'No hay memoria suficiente para procesar este archivo. Prueba con lotes más pequeños.',
  ERR_READ: 'No se pudo leer el archivo.',
  ERR_WORKER: 'No se pudo iniciar el procesador en segundo plano del navegador.',
  ERR_LIMIT:
    'Se ha superado un límite de seguridad del procesamiento. Prueba con un lote más pequeño.',
  ERR_CANCELLED: 'La extracción se canceló a petición del usuario.',
  ERR_INVALID_PDF: 'El archivo tiene extensión .pdf pero no contiene una firma PDF válida.',
  ERR_WRITE:
    'No se pudo guardar el ZIP de salida. Comprueba el espacio libre del dispositivo o prueba con un lote más pequeño.',
  ERR_UNKNOWN: 'Error inesperado al procesar el archivo.',
};

/** Normaliza cualquier error en un mensaje claro para la interfaz. */
export function describeError(error) {
  const rawMessage = typeof error === 'string' ? error : String(error?.message ?? error ?? '');
  const detail = rawMessage.slice(0, 300);

  if (error?.code && ERROR_MESSAGES[error.code]) {
    // Los errores propios ya traen un mensaje redactado para la interfaz; los
    // errores técnicos de librerías externas se traducen al mensaje estándar.
    const ownMessage = error instanceof ExtractionError && rawMessage;
    return {
      code: error.code,
      message: ownMessage || ERROR_MESSAGES[error.code],
      detail: rawMessage,
    };
  }

  const text = rawMessage.toLowerCase();

  if (/passphrase|password|encrypted|encryption/.test(text)) {
    return { code: 'ERR_ENCRYPTED', message: ERROR_MESSAGES.ERR_ENCRYPTED, detail };
  }
  if (
    /out of memory|allocation failed|array buffer allocation|memory limit|cannot allocate/.test(
      text,
    )
  ) {
    return { code: 'ERR_MEMORY', message: ERROR_MESSAGES.ERR_MEMORY, detail };
  }
  if (
    /limit exceeded|too many (entries|files)|file too large|security limit|límite/.test(text)
  ) {
    return { code: 'ERR_LIMIT', message: rawMessage || ERROR_MESSAGES.ERR_LIMIT, detail };
  }
  if (/abort|cancel/.test(text)) {
    return { code: 'ERR_CANCELLED', message: ERROR_MESSAGES.ERR_CANCELLED, detail };
  }
  if (/worker|script error/.test(text)) {
    return { code: 'ERR_WORKER', message: ERROR_MESSAGES.ERR_WORKER, detail };
  }
  if (
    /corrupt|invalid|truncated|malformed|unexpected end|end of central directory|signature|not a zip|failed to open|checksum|crc/.test(
      text,
    )
  ) {
    return { code: 'ERR_CORRUPT', message: ERROR_MESSAGES.ERR_CORRUPT, detail };
  }
  if (/failed to fetch|network|load.*wasm|wasm.*load/.test(text)) {
    return {
      code: 'ERR_READ',
      message: 'No se pudo cargar el motor de RAR. Recarga la página e inténtalo de nuevo.',
      detail,
    };
  }

  return { code: 'ERR_UNKNOWN', message: ERROR_MESSAGES.ERR_UNKNOWN, detail };
}

/** true si el error indica que el archivo está cifrado y requiere contraseña. */
export function isEncryptedError(error) {
  if (error?.code === 'ERR_ENCRYPTED') return true;
  const text = String(error?.message ?? error ?? '').toLowerCase();
  return /passphrase|password|encrypted|encryption/.test(text);
}

/** Escapa un valor para CSV con separador `;` y comillas dobles. */
export function csvEscape(value) {
  let text = String(value ?? '').replace(CSV_CONTROL_CHARS, '');

  // Neutraliza fórmulas de hoja de cálculo (=, +, -, @, tabulador...) para que
  // un nombre de archivo manipulado no se ejecute al abrir el informe.
  if (CSV_FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }

  if (/[;"\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Genera el informe CSV de los PDF extraídos. Se añade BOM para que Excel
 * reconozca UTF-8 y se usa `;` como separador habitual en español.
 */
export function buildExtractionCsv(records) {
  const header = [
    'Archivo comprimido',
    'Ruta original',
    'Nombre original',
    'Nombre final',
    'Tamaño (bytes)',
    'Fecha',
  ];

  const rows = [header];

  for (const record of records ?? []) {
    rows.push([
      record.archive,
      record.originalPath,
      record.originalName,
      record.outputName,
      record.size,
      record.lastModified ? new Date(record.lastModified).toISOString() : '',
    ]);
  }

  return `\uFEFF${rows.map((row) => row.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}

/**
 * Controla los límites acumulados de un lote completo. Se mantiene separado del
 * orquestador para poder probarlo sin navegador ni Web Workers.
 */
export function createOutputBudget(limits = {}) {
  const toLimit = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : Infinity;
  };
  const maxPdfs = toLimit(limits.maxPdfsPerBatch);
  const maxBytes = toLimit(limits.maxTotalExtractedBytes);

  let pdfs = 0;
  let bytes = 0;

  const normalizeSize = (size) => {
    const number = Number(size);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  return {
    /** Devuelve un mensaje si el siguiente PDF superaría el presupuesto. */
    describeExceeded(size) {
      if (pdfs >= maxPdfs) {
        return `Se alcanzó el límite de ${formatNumber(maxPdfs)} PDF por lote. El proceso se detuvo para proteger la memoria del navegador.`;
      }
      if (bytes + normalizeSize(size) > maxBytes) {
        return `El lote superó el límite de ${formatBytes(maxBytes)} de PDF extraídos. El proceso se detuvo para proteger la memoria del navegador.`;
      }
      return null;
    },
    add(size) {
      pdfs += 1;
      bytes += normalizeSize(size);
    },
    get pdfs() {
      return pdfs;
    },
    get bytes() {
      return bytes;
    },
  };
}

/** Genera un identificador interno para los archivos seleccionados. */
export function fileFingerprint(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}
