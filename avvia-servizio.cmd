@echo off
rem Avviato dall'Utilita di pianificazione all'avvio di Windows (attivita "GestLegnoWeb").
rem Se il server si ferma, riparte dopo 5 secondi. Il registro va in logs\server.log
cd /d "%~dp0"
if not exist logs mkdir logs
:ciclo
echo ---- avvio %date% %time% >> logs\server.log
node server.js >> logs\server.log 2>&1
echo ---- arresto %date% %time% codice %errorlevel% >> logs\server.log
timeout /t 5 /nobreak > nul
goto ciclo
