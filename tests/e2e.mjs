/**
 * Prueba de extremo a extremo con un navegador real.
 *
 * Cubre el flujo completo:
 *  1. Genera fixtures ZIP/RAR reales (dañado, protegido, anidado y masivo).
 *  2. Sirve el build de producción con Vite Preview.
 *  3. Extracción normal + informe CSV + lista de PDF + PWA.
 *  4. Rechazo de ZIP cifrados sin diálogo de contraseña.
 *  5. Continuación del lote tras un comprimido cifrado.
 *  6. Búsqueda recursiva en comprimidos anidados y prefijos de nombre.
 *  7. Cancelación conservando los PDF ya extraídos.
 *  8. Accesibilidad con axe y comprobaciones en móvil.
 *
 * Navegador: Microsoft Edge en Windows y Chromium en el resto. Se puede
 * cambiar con la variable de entorno E2E_BROWSER=msedge|chromium|firefox|webkit.
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createRar } from './helpers/rar-writer.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputDir = resolve(root, 'tests', 'output');
const fixturesDir = resolve(outputDir, 'fixtures');
const downloadPath = resolve(outputDir, 'PDF_EXTRAIDOS.zip');
const csvPath = resolve(outputDir, 'INFORME_PDF.csv');
const partialPath = resolve(outputDir, 'PDF_EXTRAIDOS_cancelado.zip');
const PORT = 4173;
const URL_BASE = `http://127.0.0.1:${PORT}/`;
const BROWSER_NAME =
  process.env.E2E_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium');

function pdf(text) {
  return Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`, 'utf8');
}

let passed = 0;

function check(condition, label, detail = '') {
  if (!condition) {
    throw new Error(`FALLO: ${label}${detail ? ` — ${detail}` : ''}`);
  }
  passed += 1;
  console.log(`  ✔ ${label}`);
}

async function generateFixtures() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(fixturesDir, { recursive: true });

  const lote1 = new JSZip();
  lote1.file('raiz.pdf', pdf('raiz lote1'));
  lote1.file('carpeta/documento.pdf', pdf('documento lote1'));
  lote1.file('carpeta/sub/Informe.PDF', pdf('informe lote1'));
  lote1.file('carpeta/nota.txt', 'Esto no debe extraerse.');
  lote1.file('carpeta/imagen.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  const lote1Buffer = await lote1.generateAsync({ type: 'nodebuffer' });
  await writeFile(resolve(fixturesDir, 'lote1.zip'), lote1Buffer);

  // ZIP truncado: el directorio central desaparece y JSZip debe rechazarlo.
  await writeFile(
    resolve(fixturesDir, 'truncado.zip'),
    lote1Buffer.subarray(0, lote1Buffer.length - 120),
  );

  const lote2 = new JSZip();
  lote2.file('carpeta-a/compartido.pdf', pdf('compartido a lote2'));
  lote2.file('carpeta-b/compartido.pdf', pdf('compartido b lote2'));
  lote2.file('docs/documento.pdf', pdf('documento lote2'));
  lote2.file('docs/leeme.md', '# No soy un PDF');
  lote2.file('docs/hoja.xlsx', Buffer.from('datos binarios simulados'));
  await writeFile(
    resolve(fixturesDir, 'lote2.zip'),
    await lote2.generateAsync({ type: 'nodebuffer' }),
  );

  const soloTextos = new JSZip();
  soloTextos.file('notas.txt', 'Sin PDF aquí.');
  soloTextos.file('datos.csv', 'a,b\n1,2');
  await writeFile(
    resolve(fixturesDir, 'solo-textos.zip'),
    await soloTextos.generateAsync({ type: 'nodebuffer' }),
  );

  await writeFile(
    resolve(fixturesDir, 'generado.rar'),
    createRar([
      { name: 'documento.pdf', data: pdf('documento rar') },
      { name: 'carpeta/otro.PDF', data: pdf('otro rar') },
      { name: 'carpeta/nota.txt', data: 'RAR sin PDF relevante' },
    ]),
  );

  await writeFile(
    resolve(fixturesDir, 'sin-pdf.rar'),
    createRar([
      { name: 'leeme.txt', data: 'Solo texto' },
      { name: 'carpeta/hoja.md', data: '# Sin PDF' },
    ]),
  );

  await writeFile(resolve(fixturesDir, 'danado.zip'), Buffer.from('esto no es un zip'));

  await copyFile(
    resolve(root, 'tests/fixtures/test_read_format_zip_encryption_data.zip'),
    resolve(fixturesDir, 'protegido.zip'),
  );

  await copyFile(
    resolve(root, 'tests/fixtures/password-zip.zip'),
    resolve(fixturesDir, 'cifrado.zip'),
  );

  await writeFile(
    resolve(fixturesDir, 'multipart.part1.rar'),
    Buffer.concat([Buffer.from('Rar!'), Buffer.alloc(64)]),
  );

  const innerZip = new JSZip();
  innerZip.file('dentro.pdf', pdf('dentro del zip anidado'));
  innerZip.file('nota.txt', 'texto interno');

  const innerRar = createRar([
    { name: 'profundo.PDF', data: pdf('profundo del rar anidado') },
    { name: 'otra-nota.txt', data: 'texto interno' },
  ]);

  const anidado = new JSZip();
  anidado.file('raiz.pdf', pdf('raiz anidada'));
  anidado.file('interno.zip', await innerZip.generateAsync({ type: 'nodebuffer' }));
  anidado.file('interno.rar', innerRar);
  anidado.file('leeme.txt', 'no soy un PDF');
  await writeFile(
    resolve(fixturesDir, 'anidado.zip'),
    await anidado.generateAsync({ type: 'nodebuffer' }),
  );

  const lento = new JSZip();
  for (let index = 0; index < 2500; index += 1) {
    const number = String(index).padStart(4, '0');
    lento.file(`masivo/archivo-${number}.pdf`, pdf(`masivo ${number}`));
  }
  await writeFile(
    resolve(fixturesDir, 'lento.zip'),
    await lento.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE',
    }),
  );

  await writeFile(resolve(outputDir, 'notas.txt'), 'archivo no compatible');

  const standard = [
    'lote1.zip',
    'lote2.zip',
    'generado.rar',
    'sin-pdf.rar',
    'solo-textos.zip',
    'danado.zip',
    'truncado.zip',
    'multipart.part1.rar',
  ].map((name) => resolve(fixturesDir, name));

  return {
    standard,
    protegido: resolve(fixturesDir, 'protegido.zip'),
    cifrado: resolve(fixturesDir, 'cifrado.zip'),
    anidado: resolve(fixturesDir, 'anidado.zip'),
    lento: resolve(fixturesDir, 'lento.zip'),
    all: [
      ...standard,
      resolve(fixturesDir, 'protegido.zip'),
      resolve(fixturesDir, 'cifrado.zip'),
      resolve(fixturesDir, 'anidado.zip'),
      resolve(fixturesDir, 'lento.zip'),
    ],
  };
}

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite Preview terminó con código ${server.exitCode}.`);
    }

    try {
      const response = await fetch(URL_BASE);
      if (response.ok) return;
    } catch {
      // El servidor aún no escucha; se reintenta.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error('Vite Preview no respondió en 30 segundos.');
}

function startPreview() {
  const viteBin = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  server.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));

  return server;
}

async function launchBrowser() {
  if (BROWSER_NAME === 'msedge') {
    return chromium.launch({ channel: 'msedge', headless: true });
  }
  if (BROWSER_NAME === 'firefox') return firefox.launch({ headless: true });
  if (BROWSER_NAME === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({ headless: true });
}

async function waitForResults(page, timeout = 120_000) {
  await page.waitForSelector('#resultsPanel:not([hidden])', { timeout });
  await page.waitForFunction(
    () => document.getElementById('progressPercent')?.textContent === '100 %',
    undefined,
    { timeout },
  );
}

async function freshPage(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#dropzone');
}

async function selectFiles(page, files, expectedCount) {
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(
    (count) =>
      Number(
        String(document.getElementById('fileCount')?.textContent ?? '0').replace(/\./g, ''),
      ) === count,
    expectedCount,
    { timeout: 30_000 },
  );
}

async function runExtraction(page) {
  await page.click('#extractButton');
  await waitForResults(page);
}

async function downloadTo(page, selector, targetPath) {
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.click(selector);
  const download = await downloadPromise;
  await download.saveAs(targetPath);
  return download;
}

async function checkAccessibility(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact),
  );

  check(
    serious.length === 0,
    `${label}: sin violaciones graves de accesibilidad`,
    serious.map((violation) => `${violation.id} (${violation.nodes.length})`).join(', '),
  );

  const moderate = results.violations.filter((violation) => violation.impact === 'moderate');
  if (moderate.length > 0) {
    console.log(
      `  ℹ ${label}: avisos moderados de accesibilidad: ${moderate
        .map((violation) => violation.id)
        .join(', ')}`,
    );
  }
}

async function verifyDownloadedZip() {
  const buffer = await readFile(downloadPath);
  const zip = await JSZip.loadAsync(buffer);

  const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);
  const names = entries.map(([name]) => name).sort((a, b) => a.localeCompare(b, 'es'));

  check(
    entries.length === 8,
    'El ZIP descargado contiene exactamente 8 archivos',
    `encontrados: ${entries.length}`,
  );
  check(
    names.every((name) => name.toLowerCase().endsWith('.pdf')),
    'El ZIP descargado no contiene archivos que no sean PDF',
    names.join(', '),
  );
  check(
    names.every((name) => !name.includes('/') && !name.includes('\\')),
    'Todos los PDF están en una carpeta plana (sin rutas internas)',
  );

  const expected = [
    'compartido.pdf',
    'compartido_1.pdf',
    'documento.pdf',
    'documento_1.pdf',
    'documento_2.pdf',
    'Informe.pdf',
    'otro.pdf',
    'raiz.pdf',
  ];
  check(
    JSON.stringify(names) ===
      JSON.stringify(expected.slice().sort((a, b) => a.localeCompare(b, 'es'))),
    'Los nombres y sufijos de duplicados son los esperados',
    names.join(', '),
  );

  const decoder = new TextDecoder();
  const contents = new Map();
  for (const [name, entry] of entries) {
    contents.set(name, decoder.decode(await entry.async('uint8array')));
  }

  const expectedContents = new Map([
    ['documento.pdf', 'documento lote1'],
    ['documento_1.pdf', 'documento lote2'],
    ['documento_2.pdf', 'documento rar'],
    ['compartido.pdf', 'compartido a lote2'],
    ['compartido_1.pdf', 'compartido b lote2'],
    ['Informe.pdf', 'informe lote1'],
    ['raiz.pdf', 'raiz lote1'],
    ['otro.pdf', 'otro rar'],
  ]);

  for (const [name, text] of expectedContents) {
    check(contents.get(name)?.includes(text), `El contenido de ${name} es el correcto`);
  }

  check(
    ![...contents.values()].some((text) => text.includes('Esto no debe extraerse')),
    'El contenido no-PDF no se ha colado en el ZIP',
  );

  return buffer.length;
}

async function verifyCsv(expectedRows) {
  const text = await readFile(csvPath, 'utf8');
  check(text.charCodeAt(0) === 0xfeff, 'El informe CSV incluye BOM para Excel');

  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r\n/);
  check(
    lines[0] ===
      'Archivo comprimido;Ruta original;Nombre original;Nombre final;Tamaño (bytes);Fecha',
    'La cabecera del CSV es la esperada',
    lines[0],
  );
  check(
    lines.length === expectedRows + 1,
    `El CSV contiene ${expectedRows} filas de datos`,
    `encontradas: ${lines.length - 1}`,
  );
  check(
    lines.some((line) => line.startsWith('lote1.zip;carpeta/documento.pdf;')),
    'El CSV conserva la ruta original dentro del comprimido',
  );
  check(
    lines.some((line) => line.includes('lote2.zip;carpeta-a/compartido.pdf;')),
    'El CSV identifica el comprimido de origen',
  );
}

async function main() {
  console.log('\n[1/9] Generando fixtures reales…');
  const fixtures = await generateFixtures();
  const originalStats = new Map();
  for (const fixturePath of fixtures.all) {
    const info = await stat(fixturePath);
    originalStats.set(fixturePath, `${info.size}:${info.mtimeMs}`);
  }

  console.log('[2/9] Iniciando Vite Preview…');
  const server = startPreview();

  let browser;
  try {
    await waitForServer(server);

    console.log(`[3/9] Abriendo la aplicación en ${BROWSER_NAME}…`);
    browser = await launchBrowser();
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(URL_BASE, { waitUntil: 'networkidle' });

    check((await page.title()) !== '', 'La página carga con título');
    check(
      (await page.locator('h1').innerText()).includes('Extrae todos tus PDF'),
      'El encabezado principal está en español',
    );

    console.log('[4/9] Comprobando PWA y accesibilidad inicial…');
    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    const manifestResponse = await page.request.get(new URL(manifestHref, URL_BASE).href);
    check(manifestResponse.ok(), 'El manifest de la PWA se sirve correctamente');
    const manifest = await manifestResponse.json();
    check(manifest.icons?.length >= 2, 'El manifest declara los iconos de instalación');
    check(manifest.display === 'standalone', 'La PWA se abre en modo independiente');

    await page.waitForFunction(
      async () => Boolean(await navigator.serviceWorker.getRegistration()),
      undefined,
      { timeout: 15_000 },
    );
    check(true, 'El service worker se registra para el modo sin conexión');

    await checkAccessibility(page, 'Pantalla inicial');

    console.log('[5/9] Extracción normal, CSV e interfaz…');
    await selectFiles(page, fixtures.standard, 8);
    check(
      (await page.locator('#fileCount').innerText()) === '8',
      'La interfaz lista los 8 archivos seleccionados',
    );
    check(
      (await page.locator('#formatSummary').innerText()).includes('RAR'),
      'La interfaz resume los formatos ZIP y RAR',
    );
    check(
      await page.locator('#optionsPanel').isVisible(),
      'El panel de opciones está disponible',
    );

    await runExtraction(page);

    const result = await page.evaluate(() => ({
      archives: document.getElementById('resultArchives').textContent,
      found: document.getElementById('resultFound').textContent,
      extracted: document.getElementById('resultExtracted').textContent,
      errors: document.getElementById('resultErrors').textContent,
      nested: document.getElementById('resultNested').textContent,
      title: document.getElementById('results-title').textContent,
      notes: document.getElementById('resultNotes').textContent,
      errorsText: document.getElementById('errorList').textContent,
      extractedNames: [...document.querySelectorAll('.extracted-item__name')].map(
        (node) => node.textContent,
      ),
    }));

    check(result.archives === '8 / 8', 'Los 8 comprimidos fueron revisados', result.archives);
    check(result.found === '8', 'Se encontraron 8 PDF', result.found);
    check(result.extracted === '8', 'Se extrajeron 8 PDF', result.extracted);
    check(result.errors === '3', 'Se registraron 3 incidencias', result.errors);
    check(result.nested === '0', 'No se abrieron comprimidos anidados sin activar la opción');
    check(
      result.title.includes('incidencias'),
      'El resultado avisa de que hubo incidencias',
      result.title,
    );
    check(
      result.notes.includes('2 comprimidos no contenían ningún PDF'),
      'Se informa de los 2 comprimidos sin PDF',
      result.notes,
    );
    check(
      result.extractedNames.includes('documento.pdf') && result.extractedNames.length === 8,
      'La lista de PDF extraídos muestra los 8 nombres finales',
      result.extractedNames.join(', '),
    );

    for (const archive of ['danado.zip', 'truncado.zip', 'multipart.part1.rar']) {
      check(result.errorsText.includes(archive), `La lista de errores incluye ${archive}`);
    }
    check(result.errorsText.includes('dañado'), 'Se explica que el ZIP truncado está dañado');
    check(
      result.errorsText.includes('multiparte'),
      'Se explica que el RAR multiparte no es compatible',
    );

    await checkAccessibility(page, 'Resultados con incidencias');

    await page.screenshot({
      path: resolve(outputDir, 'resultado-escritorio.png'),
      fullPage: true,
    });

    const zipDownload = await downloadTo(page, '#downloadButton', downloadPath);
    check(
      zipDownload.suggestedFilename() === 'PDF_EXTRAIDOS.zip',
      'El archivo descargado se llama PDF_EXTRAIDOS.zip',
      zipDownload.suggestedFilename(),
    );

    const zipSize = await verifyDownloadedZip();
    check(zipSize > 0, 'El ZIP descargado tiene contenido', `${zipSize} bytes`);

    const csvDownload = await downloadTo(page, '#csvButton', csvPath);
    check(
      csvDownload.suggestedFilename() === 'INFORME_PDF.csv',
      'El informe descargado se llama INFORME_PDF.csv',
      csvDownload.suggestedFilename(),
    );
    await verifyCsv(8);

    console.log('[6/9] Rechazando un ZIP protegido sin diálogo de contraseña…');
    await freshPage(page);
    await selectFiles(page, [fixtures.protegido], 1);
    await runExtraction(page);

    const protectedResult = await page.evaluate(() => ({
      hasPasswordDialog: Boolean(document.getElementById('passwordDialog')),
      extracted: document.getElementById('resultExtracted').textContent,
      errors: document.getElementById('resultErrors').textContent,
      errorsText: document.getElementById('errorList').textContent,
    }));

    check(
      protectedResult.hasPasswordDialog === false,
      'El ZIP protegido se rechaza sin mostrar un diálogo de contraseña',
    );
    check(protectedResult.extracted === '0', 'El ZIP protegido no extrae ningún PDF');
    check(protectedResult.errors === '1', 'El ZIP protegido registra una incidencia');
    check(
      protectedResult.errorsText.includes('protegido con contraseña'),
      'El error explica que el archivo está protegido',
      protectedResult.errorsText,
    );

    console.log('[7/9] Continuando el lote tras un ZIP cifrado…');
    await freshPage(page);
    await selectFiles(page, [fixtures.cifrado, resolve(fixturesDir, 'lote1.zip')], 2);
    await runExtraction(page);

    const batchResult = await page.evaluate(() => ({
      extracted: document.getElementById('resultExtracted').textContent,
      errors: document.getElementById('resultErrors').textContent,
      title: document.getElementById('results-title').textContent,
      names: [...document.querySelectorAll('.extracted-item__name')].map(
        (node) => node.textContent,
      ),
      errorsText: document.getElementById('errorList').textContent,
    }));

    check(
      batchResult.extracted === '3',
      'El lote sigue tras el ZIP cifrado y extrae los 3 PDF del ZIP válido',
      batchResult.extracted,
    );
    check(batchResult.errors === '1', 'El ZIP cifrado registra una única incidencia');
    check(
      batchResult.title.includes('incidencias'),
      'El resultado informa de que hubo incidencias',
      batchResult.title,
    );
    check(
      batchResult.names.sort().join(',') === 'Informe.pdf,documento.pdf,raiz.pdf',
      'Los nombres del ZIP válido son los esperados',
      batchResult.names.join(', '),
    );
    check(
      batchResult.errorsText.includes('cifrado.zip'),
      'La incidencia identifica el ZIP cifrado',
      batchResult.errorsText,
    );

    console.log('[8/9] Probando comprimidos anidados y prefijos…');
    await freshPage(page);
    await selectFiles(page, [fixtures.anidado], 1);
    await page.check('input[name="namingMode"][value="archive-prefix"]');
    await page.check('#recursiveOption');
    await runExtraction(page);

    const nestedResult = await page.evaluate(() => ({
      archives: document.getElementById('resultArchives').textContent,
      extracted: document.getElementById('resultExtracted').textContent,
      errors: document.getElementById('resultErrors').textContent,
      nested: document.getElementById('resultNested').textContent,
      notes: document.getElementById('resultNotes').textContent,
      names: [...document.querySelectorAll('.extracted-item__name')]
        .map((node) => node.textContent)
        .sort(),
      titles: [...document.querySelectorAll('.extracted-item__meta')].map(
        (node) => node.textContent,
      ),
    }));

    check(
      nestedResult.extracted === '3',
      'Se extraen los 3 PDF del archivo anidado',
      nestedResult.extracted,
    );
    check(nestedResult.errors === '0', 'Los comprimidos anidados no generan incidencias');
    check(
      nestedResult.nested === '2',
      'Se abren los 2 comprimidos anidados',
      nestedResult.nested,
    );
    check(
      nestedResult.archives === '3 / 3',
      'Se contabilizan el comprimido raíz y los 2 anidados',
    );
    check(
      nestedResult.names.join(',') ===
        'anidado_interno_dentro.pdf,anidado_interno_profundo.pdf,anidado_raiz.pdf',
      'Los prefijos del comprimido se aplican a los PDF anidados',
      nestedResult.names.join(', '),
    );
    check(
      nestedResult.notes.includes('2 comprimidos anidados abiertos'),
      'El resultado informa de los comprimidos anidados abiertos',
      nestedResult.notes,
    );
    check(
      nestedResult.titles.some(
        (title) => title.includes('anidado') && title.includes('interno'),
      ),
      'La lista de PDF indica de qué comprimido anidado procede cada uno',
    );

    await downloadTo(page, '#downloadButton', resolve(outputDir, 'PDF_ANIDADOS.zip'));

    console.log('[9/9] Probando la cancelación…');
    await freshPage(page);
    await selectFiles(page, [fixtures.lento], 1);
    await page.click('#extractButton');

    await page.waitForFunction(
      () =>
        Number(
          String(document.getElementById('statExtracted')?.textContent ?? '0').replace(
            /\./g,
            '',
          ),
        ) > 0,
      undefined,
      { timeout: 120_000 },
    );
    // Se pulsa desde el DOM para que la animación de scroll no retrase el clic
    // hasta que la extracción haya terminado.
    await page.evaluate(() => document.getElementById('cancelButton').click());
    await waitForResults(page);

    const cancelResult = await page.evaluate(() => ({
      title: document.getElementById('results-title').textContent,
      message: document.getElementById('resultMessage').textContent,
      extracted: Number(
        String(document.getElementById('resultExtracted')?.textContent ?? '0').replace(
          /\./g,
          '',
        ),
      ),
      downloadDisabled: document.getElementById('downloadButton').disabled,
      csvDisabled: document.getElementById('csvButton').disabled,
    }));

    check(
      cancelResult.title.toLowerCase().includes('cancelada'),
      'La interfaz informa de que la extracción se canceló',
      cancelResult.title,
    );
    check(
      cancelResult.extracted > 0 && cancelResult.extracted < 2500,
      'La cancelación conserva solo una parte de los PDF',
      `${cancelResult.extracted} PDF`,
    );
    check(
      cancelResult.message.includes('se conservan'),
      'El mensaje explica que se conservan los PDF ya extraídos',
      cancelResult.message,
    );
    check(!cancelResult.downloadDisabled, 'El ZIP parcial se puede descargar tras cancelar');
    check(!cancelResult.csvDisabled, 'El informe CSV parcial se puede descargar tras cancelar');

    const partialDownload = await downloadTo(page, '#downloadButton', partialPath);
    check(
      partialDownload.suggestedFilename() === 'PDF_EXTRAIDOS.zip',
      'El ZIP parcial conserva el nombre PDF_EXTRAIDOS.zip',
    );
    const partialZip = await JSZip.loadAsync(await readFile(partialPath));
    const partialCount = Object.values(partialZip.files).filter((entry) => !entry.dir).length;
    check(
      partialCount === cancelResult.extracted,
      'El ZIP parcial contiene exactamente los PDF extraídos antes de cancelar',
      `${partialCount} de ${cancelResult.extracted}`,
    );

    for (const fixturePath of fixtures.all) {
      const info = await stat(fixturePath);
      check(
        originalStats.get(fixturePath) === `${info.size}:${info.mtimeMs}`,
        `El original ${fixturePath.split(/[\\/]/).pop()} no se modificó`,
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(outputDir, 'resultado-movil.png'),
      fullPage: true,
    });
    check(true, 'Captura móvil generada en tests/output/resultado-movil.png');

    check(
      consoleErrors.length === 0,
      'No hubo errores de JavaScript en la consola',
      consoleErrors.join(' | '),
    );

    await context.close();
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    if (server.exitCode === null) server.kill('SIGKILL');
  }

  console.log(`\nE2E COMPLETADO: ${passed} comprobaciones superadas en ${BROWSER_NAME}.`);
  console.log(`ZIP verificado: ${downloadPath}`);
  console.log(
    'Capturas: tests/output/resultado-escritorio.png y tests/output/resultado-movil.png\n',
  );
}

main().catch((error) => {
  console.error('\nE2E FALLIDO:', error);
  process.exitCode = 1;
});
