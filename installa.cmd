@echo off
rem Avvia l'installazione come amministratore.
net session >nul 2>&1
if errorlevel 1 (
  echo Richiesti i permessi di amministratore...
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installa.ps1"
pause
