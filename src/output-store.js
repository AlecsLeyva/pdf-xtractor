/**
 * Acceso al almacenamiento privado del navegador (OPFS) para el ZIP de salida.
 *
 * Escribir el ZIP en disco evita mantener todos los PDF en memoria. Si OPFS no
 * está disponible (navegador antiguo o contexto no seguro), el constructor del
 * ZIP usa un Blob en memoria como respaldo.
 */

export const OUTPUT_STORAGE_PREFIX = 'PDF_EXTRAIDOS-';
export const OUTPUT_STORAGE_SUFFIX = '.zip';

/** true si el navegador expone OPFS en este contexto. */
export function isOpfsAvailable() {
  return typeof globalThis.navigator?.storage?.getDirectory === 'function';
}

/** Obtiene el File del ZIP guardado en OPFS para poder descargarlo. */
export async function resolveOutputFile(storage) {
  if (storage?.kind !== 'opfs') return null;
  if (!isOpfsAvailable()) return null;

  const root = await globalThis.navigator.storage.getDirectory();
  const handle = await root.getFileHandle(storage.name);
  return handle.getFile();
}

/** Elimina el ZIP guardado en OPFS. No lanza si ya no existe. */
export async function discardOutput(storage) {
  if (storage?.kind !== 'opfs' || !isOpfsAvailable()) return;

  try {
    const root = await globalThis.navigator.storage.getDirectory();
    await root.removeEntry(storage.name);
  } catch {
    // El archivo pudo eliminarse ya o el almacenamiento no está disponible.
  }
}

/** Borra los ZIP de sesiones anteriores que quedaron en OPFS. */
export async function cleanupStaleOutputs() {
  if (!isOpfsAvailable()) return;

  try {
    const root = await globalThis.navigator.storage.getDirectory();
    for await (const [name, handle] of root.entries()) {
      if (
        handle?.kind === 'file' &&
        name.startsWith(OUTPUT_STORAGE_PREFIX) &&
        name.endsWith(OUTPUT_STORAGE_SUFFIX)
      ) {
        await root.removeEntry(name).catch(() => {});
      }
    }
  } catch {
    // La limpieza es best-effort.
  }
}
