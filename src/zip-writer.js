/**
 * Escritor ZIP incremental (método STORE) sin dependencias.
 *
 * Los PDF ya están comprimidos, así que recomprimirlos con DEFLATE solo gasta
 * CPU y memoria a cambio de un ahorro de tamaño insignificante. Este módulo
 * escribe las cabeceras y los datos en un sumidero (`sink`) a medida que llegan
 * los archivos, de modo que el ZIP final nunca tiene que existir completo en
 * memoria. Es independiente del DOM para poder probarse en Node.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_SIGNATURE = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_SIZE = 22;

const VERSION = 20; // 2.0: soporta STORE y UTF-8.
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;

  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }

  return crcTable;
}

/** CRC-32 (polinomio IEEE) de un Uint8Array. */
export function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/** Convierte una fecha al formato fecha/hora MS-DOS que usa el ZIP. */
export function toDosDateTime(value) {
  const date = value instanceof Date ? value : new Date(Number(value) || Date.now());
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;

  const year = Math.min(Math.max(safe.getFullYear(), 1980), 2107);
  const month = safe.getMonth() + 1;
  const day = safe.getDate();

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime =
    (safe.getHours() << 11) | (safe.getMinutes() << 5) | Math.floor(safe.getSeconds() / 2);

  return { dosDate, dosTime };
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new TypeError('El contenido del archivo debe ser binario.');
}

/**
 * Escribe un ZIP completo en un sumidero incremental.
 *
 * El sumidero debe exponer `write(chunk)` y `close()`, ambos pueden devolver
 * una promesa. El orden de las llamadas se respeta con `await`.
 */
export class ZipStreamWriter {
  constructor(sink) {
    if (!sink || typeof sink.write !== 'function' || typeof sink.close !== 'function') {
      throw new TypeError('El sumidero del ZIP debe exponer write() y close().');
    }

    this.sink = sink;
    this.offset = 0;
    this.entries = 0;
    this.centralDirectory = [];
    this.finished = false;
  }

  async write(chunk) {
    await this.sink.write(chunk);
    this.offset += chunk.byteLength;
  }

  /**
   * Añade un archivo al ZIP. Los datos se escriben inmediatamente y no se
   * retienen, por lo que el llamador puede liberar el búfer al terminar.
   */
  async addFile(name, data, lastModified = Date.now()) {
    if (this.finished) {
      throw new Error('El ZIP ya está cerrado.');
    }

    const fileName = String(name ?? '').trim();
    if (!fileName) throw new Error('El nombre del archivo no puede estar vacío.');
    if (this.entries >= MAX_UINT16) {
      throw new Error('El ZIP supera el máximo de 65.535 archivos.');
    }

    const nameBytes = new TextEncoder().encode(fileName);
    const bytes = toBytes(data);
    const size = bytes.byteLength;

    if (this.offset > MAX_UINT32 - LOCAL_HEADER_SIZE - nameBytes.length - size) {
      throw new Error('El ZIP supera el tamaño máximo de 4 GB.');
    }

    const crc = crc32(bytes);
    const { dosDate, dosTime } = toDosDateTime(lastModified);
    const localOffset = this.offset;

    const header = new Uint8Array(LOCAL_HEADER_SIZE + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, FLAG_UTF8, true);
    view.setUint16(8, METHOD_STORE, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, LOCAL_HEADER_SIZE);

    await this.write(header);
    await this.write(bytes);

    this.centralDirectory.push({
      nameBytes,
      crc,
      size,
      dosDate,
      dosTime,
      localOffset,
    });
    this.entries += 1;

    return { name: fileName, size };
  }

  /** Escribe el directorio central y cierra el sumidero. */
  async finalize() {
    if (this.finished) return { entries: this.entries, bytes: this.offset };
    this.finished = true;

    const centralStart = this.offset;

    for (const entry of this.centralDirectory) {
      const header = new Uint8Array(CENTRAL_HEADER_SIZE + entry.nameBytes.length);
      const view = new DataView(header.buffer);

      view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, VERSION, true);
      view.setUint16(8, FLAG_UTF8, true);
      view.setUint16(10, METHOD_STORE, true);
      view.setUint16(12, entry.dosTime, true);
      view.setUint16(14, entry.dosDate, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, entry.localOffset, true);
      header.set(entry.nameBytes, CENTRAL_HEADER_SIZE);

      await this.write(header);
    }

    const centralSize = this.offset - centralStart;

    const end = new Uint8Array(END_OF_CENTRAL_SIZE);
    const endView = new DataView(end.buffer);

    endView.setUint32(0, END_OF_CENTRAL_SIGNATURE, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, this.entries, true);
    endView.setUint16(10, this.entries, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralStart, true);
    endView.setUint16(20, 0, true);

    await this.write(end);
    await this.sink.close();

    const result = { entries: this.entries, bytes: this.offset };
    this.centralDirectory = [];
    return result;
  }
}
