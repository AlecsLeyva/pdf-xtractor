import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import {
  analyzeZip,
  collectPdfEntries,
  countFiles,
  extractZipEntries,
  extractZipPdfEntries,
  loadZip,
} from '../src/zip-core.js';
import { createNameRegistry } from '../src/utils.js';

const decoder = new TextDecoder();

async function createFixtureZip() {
  const zip = new JSZip();

  zip.file('raiz.pdf', '%PDF-1.4\ncontenido raiz\n%%EOF');
  zip.file('carpeta/nota.txt', 'esto no es un PDF');
  zip.file('carpeta/imagen.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  zip.file('carpeta/sub/OTRO.PDF', '%PDF-1.7\ncontenido otro\n%%EOF');
  zip.file('carpeta/sub/mas/documento.pdf', '%PDF-1.4\ncontenido profundo\n%%EOF');
  zip.folder('carpeta/vacia');

  return zip.generateAsync({ type: 'nodebuffer' });
}

test('cuenta archivos sin incluir carpetas', async () => {
  const zip = await loadZip(await createFixtureZip());
  assert.equal(countFiles(zip), 5);
});

test('encuentra todos los PDF en subcarpetas e ignora el resto', async () => {
  const zip = await loadZip(await createFixtureZip());
  const pdfs = collectPdfEntries(zip);

  assert.deepEqual(
    pdfs.map((pdf) => pdf.path),
    ['carpeta/sub/mas/documento.pdf', 'carpeta/sub/OTRO.PDF', 'raiz.pdf'],
  );
});

test('extrae los PDF con su contenido y notifica el progreso', async () => {
  const zip = await loadZip(await createFixtureZip());
  const extracted = [];
  const progress = [];

  const result = await extractZipPdfEntries(zip, {
    onPdf: (pdf) => extracted.push(pdf),
    onProgress: (info) => progress.push(info),
  });

  assert.equal(result.pdfCount, 3);
  assert.equal(result.processed, 3);
  assert.equal(extracted.length, 3);
  assert.equal(progress.length, 3);
  assert.deepEqual(
    progress.map((item) => item.processed),
    [1, 2, 3],
  );

  const byPath = new Map(extracted.map((pdf) => [pdf.path, pdf]));
  assert.match(decoder.decode(byPath.get('raiz.pdf').data), /contenido raiz/);
  assert.match(decoder.decode(byPath.get('carpeta/sub/OTRO.PDF').data), /contenido otro/);
  assert.match(
    decoder.decode(byPath.get('carpeta/sub/mas/documento.pdf').data),
    /contenido profundo/,
  );
});

test('mantiene todos los PDF cuando hay nombres repetidos', async () => {
  const zip = new JSZip();
  zip.file('carpeta-a/documento.pdf', '%PDF-1.4\nA');
  zip.file('carpeta-b/documento.pdf', '%PDF-1.4\nB');
  zip.file('carpeta-c/documento.pdf', '%PDF-1.4\nC');

  const loaded = await loadZip(await zip.generateAsync({ type: 'nodebuffer' }));
  const registry = createNameRegistry();
  const names = [];

  await extractZipPdfEntries(loaded, {
    onPdf: (pdf) => names.push(registry.getUniqueName(pdf.name)),
  });

  assert.deepEqual(names, ['documento.pdf', 'documento_1.pdf', 'documento_2.pdf']);
});

test('rechaza un ZIP dañado', async () => {
  await assert.rejects(
    loadZip(Buffer.from('esto no es un archivo zip')),
    /zip|central directory|corrupt/i,
  );
});

test('rechaza un ZIP protegido con contraseña', async () => {
  const encrypted = await readFile('tests/fixtures/test_read_format_zip_encryption_data.zip');
  await assert.rejects(loadZip(encrypted), /encrypted/i);
});

test('separa PDF y comprimidos anidados sin descomprimir', async () => {
  const inner = new JSZip();
  inner.file('dentro.pdf', '%PDF-1.4\ndentro\n%%EOF');

  const zip = new JSZip();
  zip.file('raiz.pdf', '%PDF-1.4\nraiz\n%%EOF');
  zip.file('interno.zip', await inner.generateAsync({ type: 'nodebuffer' }));
  zip.file('carpeta/interno.rar', Buffer.from('datos simulados'));
  zip.file('carpeta/nota.txt', 'texto');

  const loaded = await loadZip(await zip.generateAsync({ type: 'nodebuffer' }));
  const analysis = analyzeZip(loaded, { recursive: true });

  assert.equal(analysis.pdfs.length, 1);
  assert.equal(analysis.nested.length, 2);
  assert.deepEqual(
    analysis.nested.map((item) => item.path),
    ['carpeta/interno.rar', 'interno.zip'],
  );

  const withoutRecursion = analyzeZip(loaded, { recursive: false });
  assert.equal(withoutRecursion.nested.length, 0);
});

test('entrega los comprimidos anidados al orquestador', async () => {
  const inner = new JSZip();
  inner.file('dentro.pdf', '%PDF-1.4\ndentro\n%%EOF');

  const zip = new JSZip();
  zip.file('raiz.pdf', '%PDF-1.4\nraiz\n%%EOF');
  zip.file('interno.zip', await inner.generateAsync({ type: 'nodebuffer' }));

  const loaded = await loadZip(await zip.generateAsync({ type: 'nodebuffer' }));
  const pdfs = [];
  const nested = [];

  const result = await extractZipEntries(loaded, {
    recursive: true,
    onPdf: (pdf) => pdfs.push(pdf),
    onNestedArchive: (item) => nested.push(item),
  });

  assert.equal(result.pdfCount, 1);
  assert.equal(result.nestedCount, 1);
  assert.equal(pdfs.length, 1);
  assert.equal(nested.length, 1);
  assert.equal(nested[0].name, 'interno.zip');
  assert.ok(nested[0].data.byteLength > 0);
});

test('valida la firma de los PDF cuando se solicita', async () => {
  const zip = new JSZip();
  zip.file('valido.pdf', '%PDF-1.4\nvalido\n%%EOF');
  zip.file('falso.pdf', 'esto no es un PDF de verdad');
  zip.file('otro.PDF', '%PDF-1.7\notro\n%%EOF');

  const loaded = await loadZip(await zip.generateAsync({ type: 'nodebuffer' }));
  const pdfs = [];
  const errors = [];

  await extractZipEntries(loaded, {
    validatePdf: true,
    onPdf: (pdf) => pdfs.push(pdf),
    onPdfError: (error, entry) => errors.push({ error, entry }),
  });

  assert.deepEqual(pdfs.map((pdf) => pdf.path).sort(), ['otro.PDF', 'valido.pdf']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].entry.path, 'falso.pdf');
  assert.equal(errors[0].error.code, 'ERR_INVALID_PDF');
});

test('aborta si se supera el límite de entradas', async () => {
  const loaded = await loadZip(await createFixtureZip());

  await assert.rejects(
    extractZipEntries(loaded, {
      limits: { maxEntriesPerArchive: 2 },
    }),
    (error) => error.code === 'ERR_LIMIT',
  );
});

test('aborta si un PDF supera el tamaño máximo', async () => {
  const loaded = await loadZip(await createFixtureZip());

  await assert.rejects(
    extractZipEntries(loaded, {
      limits: { maxSinglePdfBytes: 4 },
    }),
    (error) => error.code === 'ERR_LIMIT',
  );
});
