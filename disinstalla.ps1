#Requires -RunAsAdministrator
# GestLegno Web - ferma e rimuove avvio automatico e regola firewall. I file restano nella cartella.
# Uso: powershell -ExecutionPolicy Bypass -File disinstalla.ps1
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
Unregister-ScheduledTask -TaskName $NomeAttivita -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName 'GestLegno Web' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host "GestLegno Web fermato e rimosso dall'avvio automatico. I file in $Cartella non sono stati toccati."
