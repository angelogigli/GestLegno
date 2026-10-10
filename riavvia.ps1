#Requires -RunAsAdministrator
# GestLegno Web - riavvio (dopo una modifica a config.json o ai file dell'app).
# Uso: powershell -ExecutionPolicy Bypass -File riavvia.ps1
param([string]$Cartella = 'C:\GestLegnoWeb')
$NomeAttivita = 'GestLegnoWeb'
Stop-ScheduledTask -TaskName $NomeAttivita -ErrorAction SilentlyContinue
$cmds = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
  Where-Object { $_.CommandLine -like "*$Cartella*avvia-servizio.cmd*" }
foreach ($c in $cmds) {
  Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($c.ProcessId)" |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $NomeAttivita
Start-Sleep -Seconds 4
Get-Content "$Cartella\logs\server.log" -Tail 6
