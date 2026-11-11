/**
 * Servidor local de producción para PDF Extractor.
 *
 * Sirve la carpeta dist/ por HTTP en 127.0.0.1, con los tipos MIME correctos
 * (incluidos .wasm y .webmanifest) y protección contra rutas fuera de dist/.
 * Al ser localhost, la aplicación es un contexto seguro y la PWA se puede
 * instalar y usar sin conexión.
 *
 * Uso:
 *   npm run build
 *   node scripts/serve-dist.mjs [--port 4173] [--no-open]
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(root, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const options = { port: Number(process.env.PORT) || 4173, open: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-open') options.open = false;
    else if (arg === '--port' || arg === '-p') {
      const value = Number(argv[index + 1]);
      if (Number.isInteger(value) && value > 0 && value < 65536) {
        options.port = value;
        index += 1;
      }
    }
  }

  return options;
}

function sendText(response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

function openBrowser(url) {
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(command, (error) => {
    if (error) console.warn(`  Abre manualmente: ${url}`);
  });
}

async function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  let pathname;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const candidate = normalize(join(distDir, pathname));
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) return null;

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const indexFile = join(candidate, 'index.html');
      const indexInfo = await stat(indexFile);
      return indexInfo.isFile() ? indexFile : null;
    }
  } catch {
    return null;
  }

  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const info = await stat(join(distDir, 'index.html'));
    if (!info.isFile()) throw new Error('index.html no es un archivo');
  } catch {
    console.error('No existe dist/index.html. Ejecuta primero: npm run build');
    process.exitCode = 1;
    return;
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Método no permitido');
      return;
    }

    const filePath = await resolveRequestPath(request.url ?? '/');

    if (!filePath) {
      // Las rutas de la aplicación usan un único index.html (también con
      // subcarpetas), salvo que el recurso tenga una extensión concreta.
      const extension = extname(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      if (!extension) {
        const fallback = join(distDir, 'index.html');
        response.writeHead(200, {
          'Content-Type': MIME_TYPES['.html'],
          'Cache-Control': 'no-cache',
        });
        createReadStream(fallback).pipe(response);
        return;
      }

      sendText(response, 404, 'Recurso no encontrado');
      return;
    }

    const extension = extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };

    if (extension === '.html' || extension === '.webmanifest' || filePath.endsWith('sw.js')) {
      headers['Cache-Control'] = 'no-cache';
    } else {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }

    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `El puerto ${options.port} ya está en uso. Prueba con: npm run serve -- --port 4174`,
      );
    } else {
      console.error('El servidor no pudo arrancar:', error);
    }
    process.exitCode = 1;
  });

  server.listen(options.port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${options.port}/`;
    console.log('');
    console.log('  PDF Extractor en marcha');
    console.log(`  ${url}`);
    console.log('');
    console.log('  Pulsa Ctrl+C para detener el servidor.');
    console.log('');

    if (options.open) openBrowser(url);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
