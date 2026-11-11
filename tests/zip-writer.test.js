import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { ZipStreamWriter, crc32, toDosDateTime } from '../src/zip-writer.js';

const encoder = new TextEncoder();

function createMemorySink() {
  const chunks = [];
  return {
    chunks,
    sink: {
      write(chunk) {
        chunks.push(chunk);
      },
      async close() {},
    },
    toBuffer() {
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    },
  };
}

test('calcula el CRC-32 estándar', () => {
  assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('convierte fechas al formato MS-DOS', () => {
  const { dosDate, dosTime } = toDosDateTime(new Date(2024, 0, 2, 3, 4, 6));
  assert.equal(dosDate, ((2024 - 1980) << 9) | (1 << 5) | 2);
  assert.equal(dosTime, (3 << 11) | (4 << 5) | 3);
});

test('genera un ZIP válido en streaming con método STORE', async () => {
  const { sink, toBuffer } = createMemorySink();
  const writer = new ZipStreamWriter(sink);

  await writer.addFile('raiz.pdf', encoder.encode('%PDF-1.4\nraiz\n%%EOF'));
  await writer.addFile(
    'carpeta/otro.PDF',
    encoder.encode('%PDF-1.7\notro\n%%EOF'),
    new Date(2023, 5, 10, 12, 30, 0).getTime(),
  );

  const result = await writer.finalize();
  assert.equal(result.entries, 2);

  const buffer = toBuffer();
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0, 'El método debe ser STORE (0)');

  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ['carpeta/otro.PDF', 'raiz.pdf']);
  assert.equal(await zip.file('raiz.pdf').async('string'), '%PDF-1.4\nraiz\n%%EOF');
  assert.equal(await zip.file('carpeta/otro.PDF').async('string'), '%PDF-1.7\notro\n%%EOF');
});

test('conserva nombres con acentos y caracteres no latinos', async () => {
  const { sink, toBuffer } = createMemorySink();
  const writer = new ZipStreamWriter(sink);

  await writer.addFile('informe-año.pdf', encoder.encode('%PDF-1.4\nuno'));
  await writer.addFile('日本語.pdf', encoder.encode('%PDF-1.4\ndos'));
  await writer.addFile('documento_1.pdf', encoder.encode('%PDF-1.4\ntres'));
  await writer.finalize();

  const zip = await JSZip.loadAsync(toBuffer());
  assert.deepEqual(Object.keys(zip.files).sort(), [
    'documento_1.pdf',
    'informe-año.pdf',
    '日本語.pdf',
  ]);
});

test('produce un ZIP vacío válido', async () => {
  const { sink, toBuffer } = createMemorySink();
  const writer = new ZipStreamWriter(sink);
  await writer.finalize();

  const zip = await JSZip.loadAsync(toBuffer());
  assert.equal(Object.keys(zip.files).length, 0);
});

test('rechaza añadir archivos después de finalizar', async () => {
  const { sink } = createMemorySink();
  const writer = new ZipStreamWriter(sink);
  await writer.finalize();

  await assert.rejects(writer.addFile('tarde.pdf', encoder.encode('x')), /cerrado/);
});

test('escribe el directorio central y permite releer el ZIP tras muchos archivos', async () => {
  const { sink, toBuffer } = createMemorySink();
  const writer = new ZipStreamWriter(sink);

  for (let index = 0; index < 50; index += 1) {
    await writer.addFile(`pdf-${index}.pdf`, encoder.encode(`%PDF-1.4\n${index}`));
  }

  await writer.finalize();

  const zip = await JSZip.loadAsync(toBuffer());
  assert.equal(Object.keys(zip.files).length, 50);
  assert.equal(await zip.file('pdf-49.pdf').async('string'), '%PDF-1.4\n49');
});
