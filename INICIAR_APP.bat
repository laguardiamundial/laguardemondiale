@echo off
title Codmors - Inicio Automático
cd /d "%~dp0\backend"

echo ============================================
echo   INICIANDO APP DE MENSAJERIA EMPRESA
echo ============================================
echo.

:: Verificar si node_modules existe, si no instalar
if not exist "node_modules" (
    echo Instalando dependencias (primera vez, puede tardar)...
    npm install
    if errorlevel 1 (
        echo ERROR al instalar dependencias. Revisa que tengas Node.js instalado.
        pause
        exit /b
    )
    echo.
)

:: Crear .env si no existe
if not exist ".env" (
    echo Creando archivo .env...
    copy .env.example .env >nul
)

echo Comprobando servidor en http://localhost:3001
echo.

:: No iniciar una segunda copia si el puerto ya esta ocupado
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
    echo El servidor ya esta funcionando en el puerto 3001.
) else (
    echo Iniciando servidor...
    start "" node server.js
    timeout /t 3 >nul
)

:: Abrir la app en el navegador
start "" "%~dp0\frontend\index.html"

echo.
echo ¡Listo! La app se abrio en tu navegador en http://localhost:3001
echo Si cierras esta ventana, el servidor se detiene.
pause
