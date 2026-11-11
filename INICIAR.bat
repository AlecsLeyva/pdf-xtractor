@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ============================================
echo   PDF Extractor - Iniciando la aplicacion
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] No se encontro Node.js.
  echo  Instala Node.js 20.19 o superior desde https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo  Instalando dependencias por primera vez...
  echo.
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo  [ERROR] No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
  echo.
)

echo  Compilando la aplicacion y abriendo el navegador...
echo  Para cerrar la aplicacion pulsa Ctrl+C en esta ventana.
echo.

call npm.cmd run start
set EXIT_CODE=%ERRORLEVEL%

echo.
if not "%EXIT_CODE%"=="0" (
  echo  La aplicacion se cerro con un error ^(codigo %EXIT_CODE%^).
  echo  Revisa el mensaje anterior. Tambien puedes ejecutar: npm run build
)
pause
exit /b %EXIT_CODE%
