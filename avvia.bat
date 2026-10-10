@echo off
rem Avvio manuale in una finestra (per prove). In produzione l'app gira come attivita pianificata.
title GestLegno Web
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js non trovato. Installa la versione LTS da https://nodejs.org & pause & exit /b 1)
if not exist node_modules\mssql call npm install --omit=dev --no-audit --no-fund
node server.js
pause
