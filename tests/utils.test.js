import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_TYPE,
  ExtractionError,
  buildExtractionCsv,
  createNameRegistry,
  csvEscape,
  describeError,
  detectArchiveType,
  formatBytes,
  isEncryptedError,
  isNestedArchiveName,
  isMultipartRar,
  isPdfName,
  isPdfSignature,
  sanitizeArchivePrefix,
  sanitizePdfName,
} from '../src/utils.js';

test('detecta PDF sin distinguir mayúsculas y minúsculas', () => {
  assert.equal(isPdfName('documento.pdf'), true);
  assert.equal(isPdfName('DOCUMENTO.PDF'), true);
  assert.equal(isPdfName('carpeta/sub/Informe.PdF'), true);
  assert.equal(isPdfName('documento.pdf.txt'), false);
  assert.equal(isPdfName('documento.pdf '), true);
  assert.equal(isPdfName('foto.png'), false);
});

test('detecta el formato ZIP o RAR por extensión o MIME', () => {
  assert.equal(detectArchiveType({ name: 'a.zip', type: '' }), ARCHIVE_TYPE.ZIP);
  assert.equal(detectArchiveType({ name: 'A.ZIP', type: '' }), ARCHIVE_TYPE.ZIP);
  assert.equal(detectArchiveType({ name: 'b.rar', type: '' }), ARCHIVE_TYPE.RAR);
  assert.equal(detectArchiveType({ name: 'B.RAR', type: '' }), ARCHIVE_TYPE.RAR);
  assert.equal(
    detectArchiveType({ name: 'sin-extension', type: 'application/zip' }),
    ARCHIVE_TYPE.ZIP,
  );
  assert.equal(
    detectArchiveType({ name: 'sin-extension', type: 'application/vnd.rar' }),
    ARCHIVE_TYPE.RAR,
  );
  assert.equal(
    detectArchiveType({ name: 'foto.jpg', type: 'image/jpeg' }),
    ARCHIVE_TYPE.UNKNOWN,
  );
});

test('reconoce RAR multiparte', () => {
  assert.equal(isMultipartRar('archivo.part1.rar'), true);
  assert.equal(isMultipartRar('ARCHIVO.PART02.RAR'), true);
  assert.equal(isMultipartRar('archivo.r00'), true);
  assert.equal(isMultipartRar('archivo.rar'), false);
  assert.equal(isMultipartRar('archivo-normal.rar'), false);
});

test('sanea nombres de PDF para el ZIP final', () => {
  assert.equal(sanitizePdfName('carpeta/sub/Documento.PDF'), 'Documento.pdf');
  assert.equal(sanitizePdfName('C:\\temp\\Informe.PdF'), 'Informe.pdf');
  assert.equal(sanitizePdfName('mi:archivo?.pdf'), 'mi_archivo_.pdf');
  assert.equal(sanitizePdfName('  .pdf'), 'documento.pdf');
  assert.equal(sanitizePdfName('CON.pdf'), '_CON.pdf');
  assert.equal(sanitizePdfName('informe.txt'), 'informe.txt.pdf');
  assert.equal(sanitizePdfName('archivo.pdf   '), 'archivo.pdf');
  assert.equal(sanitizePdfName('reporte\u0000final.pdf'), 'reporte_final.pdf');
});

test('limita nombres extremadamente largos conservando la extensión', () => {
  const name = `${'a'.repeat(400)}.pdf`;
  const result = sanitizePdfName(name);
  assert.ok(result.length <= 154);
  assert.match(result, /\.pdf$/);
});

test('resuelve nombres duplicados sin sobrescribir', () => {
  const registry = createNameRegistry();

  assert.equal(registry.getUniqueName('documento.pdf'), 'documento.pdf');
  assert.equal(registry.getUniqueName('documento.pdf'), 'documento_1.pdf');
  assert.equal(registry.getUniqueName('documento.pdf'), 'documento_2.pdf');
  assert.equal(registry.getUniqueName('DOCUMENTO.PDF'), 'DOCUMENTO_3.pdf');
  assert.equal(registry.getUniqueName('otro.pdf'), 'otro.pdf');
  assert.equal(registry.size, 5);
});

test('formatea tamaños en español', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(1024 * 1024), '1 MB');
  assert.equal(formatBytes(Number.NaN), '—');
});

test('traduce errores técnicos a mensajes claros', () => {
  const encrypted = describeError(new Error('Encrypted zip are not supported'));
  assert.equal(encrypted.code, 'ERR_ENCRYPTED');

  const corrupt = describeError(
    new Error("Can't find end of central directory : is this a zip file ?"),
  );
  assert.equal(corrupt.code, 'ERR_CORRUPT');

  const memory = describeError(new Error('Array buffer allocation failed'));
  assert.equal(memory.code, 'ERR_MEMORY');

  const known = describeError(
    new ExtractionError('ERR_MULTIPART', 'Este RAR está dividido en varios volúmenes.'),
  );
  assert.equal(known.code, 'ERR_MULTIPART');
  assert.match(known.message, /volúmenes/);

  const unknown = describeError(new Error('algo raro'));
  assert.equal(unknown.code, 'ERR_UNKNOWN');
});

test('detecta comprimidos anidados por extensión', () => {
  assert.equal(isNestedArchiveName('interior.zip'), true);
  assert.equal(isNestedArchiveName('carpeta/INTERIOR.RAR'), true);
  assert.equal(isNestedArchiveName('documento.pdf'), false);
  assert.equal(isNestedArchiveName('notas.txt'), false);
});

test('valida la firma real de un PDF', () => {
  const encoder = new TextEncoder();
  assert.equal(isPdfSignature(encoder.encode('%PDF-1.7\ncontenido')), true);
  assert.equal(isPdfSignature(encoder.encode('basura\n%PDF-1.4')), true);
  assert.equal(isPdfSignature(encoder.encode('esto no es un pdf')), false);
  assert.equal(isPdfSignature(new Uint8Array(0)), false);
  assert.equal(isPdfSignature(null), false);
});

test('crea prefijos seguros a partir del nombre del comprimido', () => {
  assert.equal(sanitizeArchivePrefix('lote 1.zip'), 'lote 1');
  assert.equal(sanitizeArchivePrefix('C:\\descargas\\Lote_2.RAR'), 'Lote_2');
  assert.equal(sanitizeArchivePrefix('mi:archivo?.zip'), 'mi_archivo_');
  assert.equal(sanitizeArchivePrefix('.zip'), 'archivo');
});

test('detecta los archivos cifrados a partir del mensaje', () => {
  assert.equal(isEncryptedError(new Error('Passphrase required for this entry')), true);
  assert.equal(isEncryptedError(new Error('Encrypted zip are not supported')), true);
  assert.equal(isEncryptedError(new Error('archivo dañado')), false);
});

test('escapa valores y genera el informe CSV', () => {
  assert.equal(csvEscape('normal'), 'normal');
  assert.equal(csvEscape('con;separador'), '"con;separador"');
  assert.equal(csvEscape('con "comillas"'), '"con ""comillas"""');
  assert.equal(csvEscape('con\nsalto'), '"con\nsalto"');

  const csv = buildExtractionCsv([
    {
      archive: 'lote1.zip',
      originalPath: 'carpeta/documento.pdf',
      originalName: 'documento.pdf',
      outputName: 'documento.pdf',
      size: 1234,
      lastModified: Date.UTC(2024, 0, 2, 3, 4, 5),
    },
  ]);

  assert.ok(csv.startsWith('\uFEFFArchivo comprimido;Ruta original'));
  assert.match(csv, /lote1\.zip;carpeta\/documento\.pdf;documento\.pdf;documento\.pdf;1234;/);
  assert.match(csv, /2024-01-02T03:04:05\.000Z/);
});
