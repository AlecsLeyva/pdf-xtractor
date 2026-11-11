import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Archive } from 'libarchive.js/dist/libarchive-node.mjs';
import { extractArchiveWith, extractRarPdfs, extractRarPdfsWith } from '../src/rar-handler.js';
import { createRar } from './helpers/rar-writer.mjs';

const decoder = new TextDecoder();
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

before(() => {
  // libarchive-node.mjs construye mal la ruta del worker en Windows; se
  // reemplaza únicamente getWorker conservando su cliente Comlink interno.
  const defaults = Archive._options;
  Archive.init({
    getWorker: () =>
      new Worker(
        pathToFileURL(
          resolve(projectRoot, 'node_modules/libarchive.js/dist/worker-bundle-node.mjs'),
        ),
        { type: 'module' },
      ),
    createClient: defaults.createClient,
  });
});

function createFakeArchive(entries, { encrypted = true } = {}) {
  return {
    async hasEncryptedData() {
      return encrypted;
    },
    async getFilesArray() {
      return entries.map((entry) => ({
        path: entry.path ?? '',
        file: {
          name: entry.name,
          size: entry.data.byteLength,
          lastModified: 0,
          dir: false,
          async extract() {
            return new File([entry.data], entry.name, { lastModified: 0 });
          },
        },
      }));
    },
    async close() {},
  };
}

function fakeArchiveClass(archive) {
  return {
    async open() {
      return archive;
    },
  };
}

const realPdf = (text) => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF`);

test('extrae los PDF de un RAR recorriendo todas las carpetas', async () => {
  const rar = createRar([
    { name: 'raiz.pdf', data: '%PDF-1.4\ncontenido raiz\n%%EOF' },
    { name: 'carpeta/nota.txt', data: 'esto no es un PDF' },
    { name: 'carpeta/sub/OTRO.PDF', data: '%PDF-1.7\ncontenido otro\n%%EOF' },
    {
      name: 'carpeta/sub/mas/documento.pdf',
      data: '%PDF-1.4\ncontenido profundo\n%%EOF',
    },
    { name: 'carpeta/imagen.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ]);

  const file = new File([rar], 'prueba.rar', { type: 'application/vnd.rar' });
  const extracted = [];
  const progress = [];
  const errors = [];
  let startInfo = null;

  const result = await extractRarPdfsWith(Archive, file, {
    onStart: (info) => {
      startInfo = info;
    },
    onPdf: (pdf) => extracted.push(pdf),
    onPdfError: (error) => errors.push(error),
    onProgress: (info) => progress.push(info),
  });

  assert.deepEqual(startInfo, { totalEntries: 5, pdfCount: 3, nestedCount: 0 });
  assert.deepEqual(result, {
    totalEntries: 5,
    pdfCount: 3,
    nestedCount: 0,
    processed: 3,
  });
  assert.equal(errors.length, 0);
  assert.equal(extracted.length, 3);
  assert.deepEqual(
    progress.map((item) => item.processed),
    [1, 2, 3],
  );

  const names = extracted.map((pdf) => pdf.name);
  assert.deepEqual(names.slice().sort(), ['OTRO.PDF', 'documento.pdf', 'raiz.pdf'].sort());

  const byName = new Map(extracted.map((pdf) => [pdf.name, decoder.decode(pdf.data)]));
  assert.match(byName.get('raiz.pdf'), /contenido raiz/);
  assert.match(byName.get('OTRO.PDF'), /contenido otro/);
  assert.match(byName.get('documento.pdf'), /contenido profundo/);
});

test('abre RAR v4 y v5 reales y devuelve sus entradas sin PDF', async () => {
  for (const name of ['test-v4.rar', 'test-v5.rar']) {
    const buffer = await readFile(`tests/fixtures/${name}`);
    const file = new File([buffer], name);

    const result = await extractRarPdfsWith(Archive, file);
    assert.equal(result.pdfCount, 0, `${name} no debería contener PDF`);
    assert.equal(result.totalEntries, 4, `${name} debería contener 4 archivos`);
  }
});

test('detecta un RAR protegido con contraseña', async () => {
  const buffer = await readFile('tests/fixtures/test_read_format_rar4_encrypted_filenames.rar');
  const file = new File([buffer], 'protegido.rar');

  await assert.rejects(
    extractRarPdfsWith(Archive, file),
    (error) => error.code === 'ERR_ENCRYPTED',
  );
});

test('rechaza RAR multiparte antes de cargar el motor', async () => {
  const file = new File([Buffer.from('')], 'archivo.part1.rar');

  await assert.rejects(extractRarPdfs(file), (error) => error.code === 'ERR_MULTIPART');
});

test('rechaza un archivo cifrado sin extraer ni solicitar contraseña', async () => {
  const archive = createFakeArchive([{ name: 'secreto.pdf', data: realPdf('secreto') }]);
  let extracted = 0;

  await assert.rejects(
    extractArchiveWith(fakeArchiveClass(archive), new File([], 'cifrado.zip'), {
      onPdf: () => {
        extracted += 1;
      },
    }),
    (error) => error.code === 'ERR_ENCRYPTED',
  );

  assert.equal(extracted, 0);
});

test('respeta la cancelación antes de abrir el archivo', async () => {
  const controller = new AbortController();
  controller.abort();
  let opened = false;

  await assert.rejects(
    extractArchiveWith(
      {
        async open() {
          opened = true;
          return createFakeArchive([]);
        },
      },
      new File([], 'archivo.rar'),
      { signal: controller.signal },
    ),
    (error) => error.code === 'ERR_CANCELLED',
  );

  assert.equal(opened, false);
});

test('detecta y entrega comprimidos anidados cuando se activa la recursión', async () => {
  const nestedZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const archive = createFakeArchive(
    [
      { name: 'raiz.pdf', data: realPdf('raiz') },
      { name: 'carpeta/interno.zip', data: nestedZip },
    ],
    { encrypted: false },
  );
  const nested = [];

  const result = await extractArchiveWith(fakeArchiveClass(archive), new File([], 'lote.rar'), {
    recursive: true,
    onNestedArchive: (item) => nested.push(item),
  });

  assert.equal(result.pdfCount, 1);
  assert.equal(result.nestedCount, 1);
  assert.equal(nested.length, 1);
  assert.equal(nested[0].name, 'interno.zip');
});

test('valida la firma de los PDF en RAR cuando se solicita', async () => {
  const archive = createFakeArchive(
    [
      { name: 'valido.pdf', data: realPdf('valido') },
      { name: 'falso.pdf', data: new TextEncoder().encode('no soy un pdf') },
    ],
    { encrypted: false },
  );
  const pdfs = [];
  const errors = [];

  await extractArchiveWith(fakeArchiveClass(archive), new File([], 'lote.rar'), {
    validatePdf: true,
    onPdf: (pdf) => pdfs.push(pdf),
    onPdfError: (error, entry) => errors.push({ error, entry }),
  });

  assert.equal(pdfs.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error.code, 'ERR_INVALID_PDF');
});

test('rechaza un ZIP cifrado real sin extraer ningún PDF', async () => {
  const buffer = await readFile('tests/fixtures/password-zip.zip');
  const file = new File([buffer], 'password-zip.zip');
  const pdfs = [];

  await assert.rejects(
    extractArchiveWith(Archive, file, {
      onPdf: (pdf) => pdfs.push(pdf),
    }),
    (error) => error.code === 'ERR_ENCRYPTED',
  );

  assert.equal(pdfs.length, 0);
});
