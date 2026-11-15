@echo off
title Mensajeria Empresa - Inicio Automático
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

echo Iniciando servidor en http://localhost:3001
echo (Puerto 3001 para no chocar con otras apps)
echo (Deja esta ventana abierta mientras usas la app)
echo.

:: Iniciar servidor en segundo plano
start "" node server.js

:: Esperar a que levante
timeout /t 3 >nul

:: Abrir la app en el navegador
start "" "%~dp0\frontend\index.html"

echo.
echo ¡Listo! La app se abrio en tu navegador en http://localhost:3001
echo Si cierras esta ventana, el servidor se detiene.
pause
