# PDF Extractor

Aplicación web local que extrae **todos los PDF** contenidos en varios archivos **ZIP y RAR**, recorre sus carpetas y subcarpetas (y, si se activa, los comprimidos anidados), ignora el resto de archivos y reúne los PDF en un único `PDF_EXTRAIDOS.zip` descargable.

Todo el procesamiento ocurre en el navegador del usuario: **ningún documento se sube a Internet, no hay cuentas, analítica ni servicios externos de procesamiento**.

---

## 1. Características

- Selección múltiple de archivos ZIP y RAR (arrastrar y soltar o explorador de archivos).
- Detección automática del formato por extensión y tipo MIME.
- Recorrido completo de carpetas y subcarpetas internas.
- Búsqueda de `.pdf` **sin distinguir mayúsculas y minúsculas** (`.pdf`, `.PDF`, `.PdF`…).
- Solo se extraen PDF; imágenes, textos, enlaces, accesos directos y cualquier otro archivo se ignoran.
- **Comprimidos anidados opcionales:** abre ZIP/RAR que estén dentro de otro comprimido, hasta 2 niveles.
- **Dos modos de nombre:**
  - `Mantener el nombre original`: los duplicados se renombran como `documento_1.pdf`, `documento_2.pdf`…
  - `Prefijar con el comprimido`: por ejemplo `lote1_documento.pdf`, útil para saber de dónde viene cada PDF.
- **Validación opcional de la firma PDF** para descartar archivos `.pdf` que en realidad no son PDF.
- **Comprimidos cifrados:** los ZIP y RAR protegidos con contraseña se rechazan con un mensaje claro; no hay diálogo de contraseña.
- **Cancelación en cualquier momento:** se conservan y se pueden descargar los PDF ya extraídos, junto con el informe CSV parcial.
- **Informe CSV independiente** (`INFORME_PDF.csv`) con el comprimido de origen, la ruta original, el nombre final, el tamaño y la fecha. Incluye BOM UTF-8 y separador `;` para abrirlo directamente en Excel.
- **Límites de seguridad** para evitar que un archivo manipulado o un lote enorme bloquee la pestaña.
- Progreso en tiempo real: comprimidos revisados, PDF encontrados, PDF extraídos, anidados abiertos y errores.
- Manejo de errores por archivo: ZIP/RAR dañados o truncados, cifrados, RAR multiparte, sin PDF, errores de lectura, límites o memoria.
- **Lista de PDF extraídos** con su nombre final y su origen.
- Los archivos originales **nunca se modifican ni se eliminan**.
- Interfaz en español, adaptable a escritorio y móvil, con navegación por teclado y contraste cuidado.
- **PWA instalable:** se puede instalar como aplicación y funciona sin conexión después de la primera visita.
- Botones funcionales: seleccionar, quitar archivo, limpiar, extraer, cancelar, descargar, informe CSV y nueva extracción.

---

## 2. Requisitos

- Windows 10 u 11 (también funciona en macOS/Linux con Node.js).
- Node.js **20.19 o superior** (probado con Node.js 24).
- npm 10 o superior.
- Navegador moderno con WebAssembly y Web Workers: Edge, Chrome, Firefox o Safari recientes.

---

## 3. Instalación y ejecución

### Opción rápida en Windows

Haz doble clic en:

```text
INICIAR.bat
```

El script comprueba que Node.js esté instalado, instala las dependencias la primera vez, **compila la aplicación**, arranca el servidor local de producción y abre el navegador. Es la forma recomendada para usar la versión final, incluida la instalación como PWA.

### Opción manual: desarrollo

Desde la carpeta del proyecto:

```bat
npm install
npm run dev
```

Vite mostrará una dirección local, normalmente:

```text
http://127.0.0.1:5173/
```

Para cerrar el servidor pulsa `Ctrl+C` en la terminal.

### Opción manual: producción

```bat
npm run build
npm start
```

`npm start` compila y sirve `dist/` en `http://127.0.0.1:4173/`, abriendo el navegador automáticamente. Si ya has compilado y solo quieres servir los archivos:

```bat
npm run serve
```

Opciones del lanzador:

```bat
npm run serve -- --port 4174
npm run serve -- --no-open
```

> **Importante:** no abras `index.html` ni `dist/index.html` con doble clic (`file://`). Los Web Workers, el WebAssembly de RAR, el service worker y la instalación de la PWA necesitan servirse por HTTP. Usa `npm run dev`, `npm start` o `npm run serve`.

Los scripts `predev` y `prebuild` copian automáticamente el worker y el binario WASM de libarchive.js a `public/libarchive/`.

---

## 4. Instalar como aplicación (PWA)

La aplicación incluye manifest, iconos y service worker:

1. Abre la aplicación desde `http://127.0.0.1:4173/` (por ejemplo con `INICIAR.bat`).
2. En Edge o Chrome, usa el botón **Instalar aplicación** de la cabecera o el icono de instalación de la barra de direcciones.
3. La aplicación quedará instalada como ventana independiente.

El service worker precarga el armazón de la aplicación y guarda en caché los recursos con hash. Después de la primera visita, la aplicación arranca sin conexión. El procesamiento de archivos siempre es local.

Si cambias recursos críticos de la PWA, actualiza `VERSION` en `public/sw.js` para invalidar las cachés antiguas.

---

## 5. Uso

1. Abre la aplicación.
2. Arrastra varios ZIP/RAR a la zona de carga o pulsa **Seleccionar archivos**.
3. Revisa la lista: nombre, formato, tamaño, cantidad y resumen de formatos.
4. Ajusta las **opciones de extracción** si lo necesitas:
   - nombre original o prefijo del comprimido;
   - buscar dentro de comprimidos anidados;
   - comprobar que los PDF son válidos.
5. Pulsa **EXTRAER PDF Y CREAR ZIP**.
6. Observa el progreso y los contadores. Puedes pulsar **Cancelar** en cualquier momento.
7. Si un comprimido está cifrado con contraseña, se registra como incidencia y el resto del lote continúa. Extráelo con 7-Zip o WinRAR y vuelve a comprimirlo sin contraseña.
8. Al terminar, revisa las incidencias y la lista de PDF extraídos.
9. Pulsa **DESCARGAR PDF_EXTRAIDOS.zip**. Si quieres trazabilidad, pulsa **DESCARGAR INFORME CSV**.

El ZIP descargado contiene únicamente archivos PDF, todos en una carpeta plana, con los nombres duplicados renombrados de forma segura. El CSV es una descarga independiente: **no se incluye dentro del ZIP**.

---

## 6. Límites de seguridad

Los límites están centralizados en `src/config.js`:

| Límite                                              | Valor por defecto |
| --------------------------------------------------- | ----------------- |
| Comprimidos por selección                           | 200               |
| Bytes de los comprimidos seleccionados              | 1,5 GB            |
| Entradas por comprimido (archivos + carpetas)       | 300.000           |
| Bytes descomprimidos por comprimido                 | 1,5 GB            |
| Tamaño máximo de un único PDF                       | 512 MB            |
| PDF acumulados por lote                             | 20.000            |
| Bytes de PDF acumulados por lote                    | 1 GB              |
| Profundidad máxima de comprimidos anidados          | 2 niveles         |
| Comprimidos anidados procesados en total            | 100               |
| Bytes descomprimidos dedicados a anidados           | 256 MB            |
| Aviso informativo de lote grande (solo advertencia) | 512 MB            |

Si se supera un límite, el archivo afectado se registra como incidencia y el resto del lote continúa. Los límites evitan agotar la memoria y bloqueos, pero **no sustituyen** un uso razonable: para lotes enormes conviene dividir la selección.

> Los límites están pensados para equipos de 8 GB de RAM. El ZIP de salida se escribe en streaming, así que el consumo ya no crece con todos los PDF a la vez; el principal riesgo que queda es un **ZIP/RAR individual muy grande**, porque se carga completo en el worker para poder leerlo.

---

## 7. Estructura del proyecto

```text
pdf-xtractor/
├── index.html                 Interfaz completa en español
├── package.json               Dependencias y scripts
├── package-lock.json
├── vite.config.js             Configuración de Vite
├── eslint.config.js           Configuración de ESLint (flat config)
├── .prettierrc.json           Configuración de Prettier
├── README.md
├── INICIAR.bat                Lanzador para Windows (build + servidor)
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml             Lint, tests, build y E2E en Chromium
├── scripts/
│   ├── copy-libarchive.mjs    Copia worker + WASM a public/libarchive
│   ├── serve-dist.mjs         Servidor local de producción (MIME, rutas, SPA)
│   └── generate-icons.mjs     Genera los iconos PNG de la PWA
├── public/
│   ├── favicon.svg
│   ├── manifest.webmanifest   Manifest de la PWA
│   ├── sw.js                  Service worker (precache + runtime cache)
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   ├── apple-touch-icon.png
│   └── libarchive/            Generado por predev/prebuild
├── workers/
│   ├── zip-worker.js          Web Worker que lee ZIP con JSZip
│   └── zip-builder-worker.js  Web Worker que escribe el ZIP final en streaming
├── src/
│   ├── main.js                Estado de la interfaz y eventos
│   ├── style.css              Diseño grafito con acentos morados, ámbar y coral
│   ├── config.js              Límites, modos de nombre y opciones por defecto
│   ├── extractor.js           Orquestación, anidados, cancelación y ZIP final
│   ├── zip-core.js            Lógica ZIP compartida (worker y tests)
│   ├── zip-handler.js         Cliente del Web Worker de ZIP
│   ├── zip-writer.js          Escritor ZIP incremental (método STORE)
│   ├── zip-builder.js         Cliente del worker que genera el ZIP final
│   ├── output-store.js        Acceso a OPFS y limpieza de salidas
│   ├── rar-handler.js         Lectura RAR con libarchive.js/WASM
│   └── utils.js               Firma PDF, nombres, CSV, detección y errores
└── tests/
    ├── utils.test.js
    ├── zip-writer.test.js
    ├── zip-extraction.test.js
    ├── rar-extraction.test.js
    ├── e2e.mjs                Prueba completa en navegador con Playwright
    ├── helpers/
    │   ├── rar-writer.mjs     Generador de RAR 4 real para pruebas
    │   └── uudecode.mjs
    └── fixtures/              RAR v4/v5 reales y archivos cifrados
```

---

## 8. Cómo funciona

### ZIP

Cada ZIP se procesa en un **Web Worker dedicado** (`workers/zip-worker.js`) para no bloquear la interfaz:

1. `JSZip.loadAsync` abre el archivo.
2. Se recorren todas las entradas y se filtran las que terminan en `.pdf`.
3. Cada PDF se extrae como `ArrayBuffer` y se transfiere al hilo principal. El worker espera una confirmación (`ack`) antes de extraer el siguiente, así que solo hay un PDF en tránsito.
4. El worker termina y libera su memoria antes del siguiente ZIP.
5. El PDF se transfiere sin copia a otro worker (`zip-builder-worker.js`), que lo escribe en el ZIP final y lo libera. El ZIP se guarda en streaming en el almacenamiento privado del navegador (OPFS); si no está disponible, se usa un Blob en memoria como respaldo.

El ZIP final usa el método **STORE** (sin recomprimir): los PDF ya están comprimidos, así que DEFLATE solo gastaría CPU y memoria a cambio de un ahorro de tamaño insignificante. Al escribir en streaming, el lote completo nunca tiene que estar en RAM.

Si JSZip detecta un ZIP cifrado que no puede descifrar, se registra como incidencia `ERR_ENCRYPTED`. No se reintenta con otro motor ni se solicita contraseña.

### RAR

Se usa **libarchive.js** con WebAssembly:

1. El motor se carga dinámicamente solo cuando hay algún RAR.
2. libarchive.js ejecuta la descompresión en su propio worker.
3. Se listan las entradas y se extraen **solo los PDF**, uno a uno, para no descomprimir todo el RAR de golpe.
4. Se detectan RAR multiparte y archivos cifrados antes de extraer.
5. El archivo se cierra y el worker se termina al finalizar.

### Comprimidos anidados

Cuando la opción está activa, los ZIP/RAR encontrados dentro de otro comprimido se procesan con la misma cola recursiva:

- profundidad máxima de 2 niveles;
- límite global de 100 comprimidos anidados y 256 MB descomprimidos;
- los PDF heredan el prefijo del comprimido raíz (por ejemplo `anidado_interno_documento.pdf`);
- los anidados que fallen se registran como incidencia sin detener el lote.

### Cancelación

El botón **Cancelar** aborta mediante un `AbortSignal`:

- se termina el worker activo;
- se conservan los PDF ya extraídos y sus registros CSV;
- se genera un `PDF_EXTRAIDOS.zip` parcial descargable;
- el resultado explica cuántos PDF se conservaron.

### Nombres duplicados y seguridad

`src/utils.js` sanea los nombres para Windows:

- Elimina rutas y caracteres prohibidos (`< > : " | ? *`, controles).
- Evita nombres reservados (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…).
- Limita la longitud sin perder la extensión.
- Compara sin distinguir mayúsculas para evitar colisiones en Windows/macOS.
- Añade `_1`, `_2`, `_3`… antes de `.pdf` cuando es necesario.

### Informe CSV

`buildExtractionCsv` genera un CSV con estas columnas:

```text
Archivo comprimido;Ruta original;Nombre original;Nombre final;Tamaño (bytes);Fecha
```

Se escapan comillas, separadores y saltos de línea, se usa `;` y se añade BOM UTF-8 para que Excel reconozca los acentos.

---

## 9. Manejo de errores

La aplicación continúa con el resto de comprimidos cuando uno falla. Las incidencias se muestran en la sección de resultados indicando el archivo afectado, con un mensaje claro y el detalle técnico cuando aporta información.

| Situación                                          | Comportamiento                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| ZIP dañado, truncado o inválido                    | Se registra como incidencia y se continúa.                          |
| ZIP o RAR protegido con contraseña                 | Se rechaza con un mensaje que sugiere extraerlo con 7-Zip o WinRAR. |
| RAR multiparte (`.part1.rar`, `.r00`, `.rar.001`…) | Se detecta y se informa de que debe unirse en un único RAR.         |
| Comprimido sin PDF                                 | Se cuenta como revisado sin PDF y se avisa en el resultado.         |
| PDF individual ilegible                            | Se registra esa entrada y se siguen extrayendo las demás.           |
| PDF con extensión pero sin firma válida            | Solo se descarta si está activa la opción de comprobar PDF válidos. |
| Límite de entradas, tamaño, anidados o profundidad | Se registra la incidencia y se continúa con el resto del lote.      |
| Falta de memoria                                   | Se muestra un mensaje sugiriendo lotes más pequeños.                |
| Formato no soportado                               | Se rechaza en la selección; solo se admiten ZIP y RAR.              |
| Fallo del worker                                   | Se informa y se permite reintentar o usar otro lote.                |
| Cancelación del usuario                            | Se detiene el proceso y se conservan los PDF ya extraídos.          |

Los originales nunca se escriben, renombran ni eliminan.

---

## 10. Pruebas y calidad

### Pruebas unitarias y de integración (Node.js)

```bat
npm test
```

Cubren **40 pruebas**:

- Detección de `.pdf` sin distinguir mayúsculas y firmas PDF.
- Detección ZIP/RAR por extensión y MIME.
- Detección de RAR multiparte.
- Saneado de nombres, límite de longitud y prefijos de comprimido.
- Resolución de duplicados (`documento_1.pdf`, `documento_2.pdf`…).
- Formato de tamaños en español.
- Construcción y escapado del informe CSV.
- Traducción de errores técnicos y conservación de mensajes propios.
- ZIP con PDF en raíz y subcarpetas, archivos no PDF y carpetas vacías.
- ZIP con nombres repetidos, límites y comprimidos anidados.
- ZIP dañado y ZIP cifrado real.
- RAR real v4 y v5, RAR generado con PDF en subcarpetas y archivos ignorados.
- RAR cifrado real y rechazo de archivos cifrados sin solicitar contraseña.
- RAR multiparte rechazado antes de cargar el motor.
- Rechazo de un ZIP cifrado real sin extraer ningún PDF.
- Escritor ZIP incremental: CRC-32, fechas MS-DOS, método STORE, nombres UTF-8 y relectura con JSZip.

**Resultado verificado:** 40/40 pruebas superadas con `npm test`.

### Prueba de extremo a extremo (navegador real)

```bat
npm run test:e2e
```

Compila el proyecto y ejecuta `tests/e2e.mjs` con **Microsoft Edge** en Windows y **Chromium** en otros sistemas (configurable con `E2E_BROWSER=msedge|chromium|firefox|webkit`). La suite tiene **9 fases y 82 comprobaciones**:

1. PWA: manifest, iconos, modo `standalone` y registro del service worker.
2. Accesibilidad con axe (WCAG 2.1 A/AA) en la pantalla inicial.
3. Extracción normal de 8 comprimidos: 8 PDF, 3 incidencias, lista de PDF y accesibilidad de resultados.
4. Descarga y verificación de `PDF_EXTRAIDOS.zip`: contenido, nombres, duplicados y ausencia de no-PDF.
5. Informe CSV: BOM, cabecera, filas, rutas originales y comprimido de origen.
6. ZIP protegido: se rechaza sin mostrar diálogo de contraseña y sin extraer nada.
7. Lote con ZIP cifrado y ZIP válido: el cifrado se registra como incidencia y se extraen los 3 PDF del válido.
8. Comprimidos anidados: ZIP y RAR internos, prefijos, contadores y notas de resultado.
9. Cancelación de un lote de 2.500 PDF: se conserva una parte, se descarga el ZIP parcial y se comprueban los originales.

También genera capturas de escritorio y móvil y falla si aparece cualquier error de JavaScript en la consola.

**Resultado verificado:** 82/82 comprobaciones superadas con Edge.

Artefactos de la prueba:

```text
tests/output/PDF_EXTRAIDOS.zip
tests/output/INFORME_PDF.csv
tests/output/resultado-escritorio.png
tests/output/resultado-movil.png
tests/output/fixtures/
```

> La prueba E2E usa Edge ya instalado en Windows. Si tu equipo no tiene Edge, ejecuta `npx playwright install chromium` y usa `E2E_BROWSER=chromium`. En Linux/CI se instala Chromium con `npx playwright install --with-deps chromium`.

### Lint, formato y verificación

```bat
npm run lint          # ESLint
npm run format:check  # Prettier
npm run verify        # lint + tests + build
```

`npm run format` reescribe el proyecto con Prettier. `npm run icons` regenera los iconos PNG de la PWA con Playwright.

### Integración continua

`.github/workflows/ci.yml` ejecuta en cada push y pull request:

- lint y comprobación de formato;
- pruebas unitarias y de integración;
- build de producción;
- E2E con Chromium y axe, subiendo las capturas y descargas como artefactos.

---

## 11. Privacidad

- No hay subida de archivos, backend, base de datos ni API externa.
- No hay cookies, analítica, telemetría ni cuentas.
- Las dependencias se descargan una sola vez durante `npm install`; después la aplicación funciona con recursos locales.
- Los PDF se escriben en el almacenamiento privado del navegador (OPFS) a medida que se extraen y se descargan mediante un `Blob` local. Si OPFS no está disponible, se mantienen en memoria como respaldo.
- La URL temporal de descarga se revoca al limpiar, reiniciar o cerrar la página.
- El service worker solo almacena en caché recursos de la propia aplicación.

---

## 12. Limitaciones conocidas

1. **Comprimidos cifrados no compatibles.** No se solicita ni se procesa ninguna contraseña, ni en ZIP ni en RAR. Extrae el contenido con WinRAR/7-Zip y vuelve a comprimirlo sin contraseña.
2. **RAR multiparte no compatible.** libarchive.js no permite proporcionar los volúmenes siguientes. Une las partes con WinRAR/7-Zip en un único RAR antes de usarlo.
3. **Anidados limitados a 2 niveles.** Los comprimidos dentro de comprimidos dentro de comprimidos no se abren más allá de esa profundidad.
4. **Detección por extensión.** Por defecto se copia cualquier entrada cuyo nombre termine en `.pdf`. La validación de firma PDF es opcional y solo comprueba la cabecera `%PDF-`; no repara ni valida el documento completo.
5. **Consumo de memoria.** El ZIP final se escribe en streaming en OPFS, así que el lote ya no se acumula en RAM. El riesgo restante es un comprimido de entrada muy grande, porque se carga completo en el worker para poder leerlo. Los límites reducen el riesgo; usa lotes más pequeños si el equipo tiene poca memoria.
6. **Solo ZIP y RAR.** No se admiten 7z, TAR, GZ, ISO u otros formatos.
7. **Solo navegadores modernos.** Requiere WebAssembly, módulos ES, Web Workers y, para la PWA, service workers. Navegadores antiguos no son compatibles.
8. **El build debe servirse por HTTP.** Abrir `dist/index.html` con `file://` impide la carga de workers/WASM, el service worker y la instalación de la PWA.
9. **No hay instalador `.exe` nativo.** El empaquetado con Tauri quedó descartado en este entorno porque no hay toolchain de Rust (`cargo`/`rustc`). La aplicación se distribuye como PWA instalable y lanzador local con Node.js.

---

## 13. Solución de problemas

**`npm` no funciona en PowerShell por la política de ejecución**

Usa `npm.cmd` o el lanzador `INICIAR.bat`:

```bat
npm.cmd install
npm.cmd run dev
```

**El puerto 4173 o 5173 está ocupado**

```bat
npm run dev -- --port 5174
npm run serve -- --port 4174
```

**La página carga pero los RAR fallan**

Comprueba que existe `public/libarchive/worker-bundle.js` y `public/libarchive/libarchive.wasm`. Si faltan:

```bat
npm run setup:libarchive
```

**La PWA no ofrece instalación**

Comprueba que abres `http://127.0.0.1:4173/` (no `file://`), que el service worker está registrado en DevTools → Application → Service Workers y que el manifest se carga sin errores. Si acabas de cambiar recursos, recarga con `Ctrl+F5`.

**La prueba E2E no encuentra Edge**

Instala Chromium para Playwright o usa la variable de entorno:

```bat
npx playwright install chromium
set E2E_BROWSER=chromium
npm run test:e2e
```

**Un lote grande falla por memoria o por límites**

Divide la selección en varios lotes y descarga cada `PDF_EXTRAIDOS.zip` por separado. Los límites se pueden ajustar en `src/config.js` si tu equipo tiene recursos suficientes.

---

## 14. Dependencias principales

| Dependencia            | Versión    | Uso                                                                   |
| ---------------------- | ---------- | --------------------------------------------------------------------- |
| `jszip`                | 3.10.1     | Leer ZIP (el ZIP final se genera con el escritor propio en streaming) |
| `libarchive.js`        | 2.0.2      | Leer RAR vía WebAssembly                                              |
| `vite`                 | 7.x        | Desarrollo, build y preview                                           |
| `playwright`           | 1.x (dev)  | Prueba E2E en navegador real                                          |
| `@axe-core/playwright` | 4.x (dev)  | Comprobaciones de accesibilidad                                       |
| `eslint`               | 10.x (dev) | Análisis estático                                                     |
| `prettier`             | 3.x (dev)  | Formato uniforme del código                                           |

---

## 15. Licencia y uso

Proyecto de uso local. Las bibliotecas conservan sus licencias originales (JSZip: MIT; libarchive.js: Apache-2.0; libarchive: BSD).
