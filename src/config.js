/**
 * Configuración y límites de seguridad de PDF Extractor.
 * Los límites evitan que un archivo manipulado o un lote enorme agote la
 * memoria del navegador o bloquee la pestaña.
 *
 * Los valores están pensados para equipos de 8 GB de RAM. Con el ZIP de salida
 * en streaming (OPFS) el consumo se mantiene bajo, pero el archivo de entrada
 * todavía se carga completo en el worker, así que un ZIP individual enorme
 * sigue siendo el principal riesgo.
 */

export const LIMITS = Object.freeze({
  /** Máximo de comprimidos que se pueden añadir a la selección. */
  maxSelectedArchives: 200,
  /** Máximo de bytes de los comprimidos seleccionados (antes de descomprimir). */
  maxInputBytes: 1536 * 1024 ** 2,
  /** Máximo de entradas (archivos + carpetas) dentro de un comprimido. */
  maxEntriesPerArchive: 300_000,
  /** Máximo de bytes descomprimidos por comprimido (PDF + anidados). */
  maxTotalUncompressedBytes: 1536 * 1024 ** 2,
  /** Máximo de bytes para un único PDF. */
  maxSinglePdfBytes: 512 * 1024 ** 2,
  /** Máximo de PDF que se pueden acumular en un único lote. */
  maxPdfsPerBatch: 20_000,
  /** Máximo de bytes de PDF acumulados en un único lote. */
  maxTotalExtractedBytes: 1024 ** 3,
  /** Profundidad máxima al buscar comprimidos anidados. */
  maxNestedDepth: 2,
  /** Máximo de comprimidos anidados procesados en total. */
  maxNestedArchives: 100,
  /** Máximo de bytes descomprimidos dedicados a comprimidos anidados. */
  maxNestedBytes: 256 * 1024 ** 2,
  /** Aviso de lote grande (solo informativo). */
  warnInputBytes: 512 * 1024 ** 2,
});

export const NAMING_MODE = Object.freeze({
  FLAT: 'flat',
  ARCHIVE_PREFIX: 'archive-prefix',
});

export const DEFAULT_OPTIONS = Object.freeze({
  namingMode: NAMING_MODE.FLAT,
  recursive: false,
  validatePdf: false,
});
