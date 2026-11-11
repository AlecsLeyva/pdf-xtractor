/**
 * Genera los iconos PNG de la PWA a partir de un SVG, usando el mismo
 * navegador que las pruebas E2E (Microsoft Edge o Chromium).
 *
 * Uso: npm run icons
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = resolve(root, 'public');

function buildSvg({ safe = 1 } = {}) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#08100e" />
      <stop offset="1" stop-color="#0f2a24" />
    </linearGradient>
    <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" />
      <stop offset="1" stop-color="#d1faf0" />
    </linearGradient>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fb7185" />
      <stop offset="1" stop-color="#dc2626" />
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.1" r="0.75">
      <stop offset="0" stop-color="#2dd4bf" stop-opacity="0.55" />
      <stop offset="1" stop-color="#2dd4bf" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="512" height="512" fill="url(#bg)" />
  <rect width="512" height="512" fill="url(#glow)" />

  <g transform="translate(256 256) scale(${safe}) translate(-256 -256)">
    <rect x="150" y="90" width="212" height="330" rx="24" fill="#07231c" opacity="0.6" />
    <path
      d="M170 112a22 22 0 0 1 22-22h106l66 66v242a22 22 0 0 1-22 22H192a22 22 0 0 1-22-22Z"
      fill="url(#page)"
    />
    <path d="M298 90l66 66h-44a22 22 0 0 1-22-22Z" fill="#6ee7b7" />

    <rect x="198" y="196" width="112" height="14" rx="7" fill="#2dd4bf" />
    <rect x="198" y="230" width="148" height="14" rx="7" fill="#5eead4" />
    <rect x="198" y="264" width="88" height="14" rx="7" fill="#a7f3d0" />

    <rect x="170" y="312" width="196" height="88" rx="16" fill="url(#badge)" />
    <text
      x="268"
      y="372"
      text-anchor="middle"
      font-family="Segoe UI, Arial, sans-serif"
      font-size="48"
      font-weight="800"
      letter-spacing="2"
      fill="#ffffff"
    >PDF</text>
  </g>
</svg>`.trim();
}

async function render(browser, size, options, fileName) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><html><head><style>
      html, body { margin: 0; padding: 0; background: #08100e; }
      svg { display: block; width: ${size}px; height: ${size}px; }
    </style></head><body>${buildSvg(options)}</body></html>`,
    { waitUntil: 'load' },
  );
  await page.screenshot({
    path: resolve(outDir, fileName),
    omitBackground: false,
    type: 'png',
  });
  await page.close();
  console.log(`  ✔ public/${fileName}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const channel = process.platform === 'win32' ? 'msedge' : undefined;
  const browser = await chromium.launch({ channel, headless: true });

  try {
    await render(browser, 192, { safe: 1 }, 'icon-192.png');
    await render(browser, 512, { safe: 1 }, 'icon-512.png');
    await render(browser, 512, { safe: 0.78 }, 'icon-maskable-512.png');
    await render(browser, 180, { safe: 1 }, 'apple-touch-icon.png');
  } finally {
    await browser.close();
  }

  console.log('Iconos de la PWA generados en public/.');
}

main().catch((error) => {
  console.error('No se pudieron generar los iconos:', error);
  process.exitCode = 1;
});
