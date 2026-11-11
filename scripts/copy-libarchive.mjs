/**
 * Copia el worker y el binario WASM de libarchive.js a public/libarchive.
 * Vite no empaqueta los archivos internos del worker, así que deben servirse
 * como recursos estáticos con la misma ruta relativa entre ellos.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = resolve(root, 'node_modules', 'libarchive.js', 'dist');
const targetDir = resolve(root, 'public', 'libarchive');
const files = ['worker-bundle.js', 'libarchive.wasm'];

await mkdir(targetDir, { recursive: true });

for (const fileName of files) {
  const source = resolve(sourceDir, fileName);
  const target = resolve(targetDir, fileName);

  try {
    await stat(source);
  } catch {
    console.error(
      `\n[libarchive] No se encontró "${fileName}". Ejecuta "npm install" antes de arrancar.\n`,
    );
    process.exit(1);
  }

  await copyFile(source, target);
}

console.log('[libarchive] worker-bundle.js y libarchive.wasm copiados a public/libarchive.');
