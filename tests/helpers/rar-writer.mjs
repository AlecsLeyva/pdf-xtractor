import { crc32 } from 'node:zlib';

/**
 * Minimal RAR 4.x (store method) writer used only to build test fixtures.
 * Produces standard RAR archives that libarchive can read.
 */

const MARKER = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return (
    ((year - 1980) << 25) |
    ((date.getMonth() + 1) << 21) |
    (date.getDate() << 16) |
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  );
}

function finalizeHeader(header) {
  header.writeUInt16LE(crc32(header.subarray(2)) & 0xffff, 0);
  return header;
}

function buildMainHeader() {
  const header = Buffer.alloc(13);
  header.writeUInt8(0x73, 2); // HEAD_TYPE: main
  header.writeUInt16LE(0, 3); // flags
  header.writeUInt16LE(13, 5); // size
  return finalizeHeader(header);
}

function buildFileHeader(name, data, date) {
  const encodedName = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(32 + encodedName.length);

  header.writeUInt8(0x74, 2); // HEAD_TYPE: file
  header.writeUInt16LE(0, 3); // flags
  header.writeUInt16LE(header.length, 5); // size
  header.writeUInt32LE(data.length, 7); // packed size
  header.writeUInt32LE(data.length, 11); // unpacked size
  header.writeUInt8(0, 15); // host OS: MS-DOS
  header.writeUInt32LE(crc32(data) >>> 0, 16); // file CRC32
  header.writeUInt32LE(dosDateTime(date) >>> 0, 20);
  header.writeUInt8(20, 24); // minimum RAR version 2.0
  header.writeUInt8(0x30, 25); // compression method: store
  header.writeUInt16LE(encodedName.length, 26);
  header.writeUInt32LE(0x20, 28); // MS-DOS archive attribute
  encodedName.copy(header, 32);

  return finalizeHeader(header);
}

function buildEndHeader() {
  const header = Buffer.alloc(7);
  header.writeUInt8(0x7b, 2); // HEAD_TYPE: end of archive
  header.writeUInt16LE(0x4000, 3);
  header.writeUInt16LE(7, 5);
  return finalizeHeader(header);
}

/**
 * @param {Array<{ name: string, data: string | Buffer, date?: Date }>} entries
 * @returns {Buffer}
 */
export function createRar(entries) {
  const date = new Date('2024-01-15T12:00:00Z');
  const parts = [MARKER, buildMainHeader()];

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    parts.push(buildFileHeader(entry.name, data, entry.date ?? date), data);
  }

  parts.push(buildEndHeader());
  return Buffer.concat(parts);
}
