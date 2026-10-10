$NomeAttivita = 'GestLegnoWeb'
$Cartella = 'C:\GestLegnoWeb'

Unregister-ScheduledTask -TaskName $NomeAttivita -Confirm:$false -ErrorAction SilentlyContinue

$azione = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/c `"$Cartella\avvia-servizio.cmd`"" -WorkingDirectory $Cartella
$avvio = New-ScheduledTaskTrigger -AtStartup
$utente = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$imp = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $NomeAttivita -Action $azione -Trigger $avvio -Principal $utente -Settings $imp -Description "GestLegno Web - $Cartella" | Out-Null
Start-ScheduledTask -TaskName $NomeAttivita

Write-Host "Attivita '$NomeAttivita' registrata e avviata."
