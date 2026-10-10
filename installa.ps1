#Requires -RunAsAdministrator
<#
  GestLegno Web - installazione su Windows Server
  - copia l'app in C:\GestLegnoWeb (o nella cartella indicata)
  - installa le dipendenze Node.js
  - crea config.json (se non esiste) chiedendo i dati
  - verifica il database
  - registra l'avvio automatico (Utilita di pianificazione, account SYSTEM)
  - apre la porta nel firewall
  Rilanciabile: aggiorna i file e mantiene config.json.
  Uso: installa.cmd   oppure   powershell -ExecutionPolicy Bypass -File installa.ps1 [-Cartella D:\GestLegnoWeb]
#>
param(
  [string]$Cartella = 'C:\GestLegnoWeb',
  [string]$Dominio = 'gestlegno.mapnet.it',
  [switch]$AccessoDiretto   # apre la porta di Node in rete invece di usare IIS (solo per prove in LAN)
)
$ErrorActionPreference = 'Stop'
$NomeAttivita = 'GestLegnoWeb'
$Origine = Split-Path -Parent $MyInvocation.MyCommand.Path

function Passo($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Chiedi($domanda, $predefinito) {
  $r = Read-Host "$domanda [$predefinito]"
  if ([string]::IsNullOrWhiteSpace($r)) { $predefinito } else { $r.Trim() }
}
function ChiediSegreto($domanda) {
  $s = Read-Host $domanda -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
function FermaApp {
  Stop-ScheduledTask -TaskName $NomeAttivita -ErrorAction SilentlyContinue
  # l'attivita avvia cmd.exe (ciclo di riavvio) che avvia node: chiudo il ciclo e il suo node
  $cmds = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
    Where-Object { $_.CommandLine -like "*$Cartella*avvia-servizio.cmd*" }
  foreach ($c in $cmds) {
    Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($c.ProcessId)" |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

Write-Host "GestLegno Web - installazione in $Cartella" -ForegroundColor Green

# ---------------------------------------------------------------- Node.js
Passo 'Node.js'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js non trovato: lo installo con winget...'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
}
if (-not $node) { throw 'Node.js non trovato. Installa la versione LTS (msi x64) da https://nodejs.org e rilancia installa.cmd.' }
$versione = (& $node -v).Trim()
if ([int]($versione.TrimStart('v').Split('.')[0]) -lt 18) { throw "Serve Node.js 18 o successivo (trovato $versione)." }
Write-Host "Node.js $versione in $node"
$npm = Join-Path (Split-Path $node) 'npm.cmd'

# ---------------------------------------------------------------- File
Passo 'Copia dei file'
FermaApp
New-Item -ItemType Directory -Force -Path $Cartella, "$Cartella\logs", "$Cartella\export" | Out-Null
if ((Resolve-Path $Origine).Path.TrimEnd('\') -ne (Resolve-Path $Cartella).Path.TrimEnd('\')) {
  Get-ChildItem $Origine -Force | Where-Object { $_.Name -notin @('node_modules', 'config.json', 'logs', 'export') } |
    Copy-Item -Destination $Cartella -Recurse -Force
  if ((Test-Path "$Origine\config.json") -and -not (Test-Path "$Cartella\config.json")) { Copy-Item "$Origine\config.json" $Cartella }
  Write-Host "File copiati in $Cartella"
} else { Write-Host 'Installo dalla cartella di destinazione: nessuna copia.' }
Set-Location $Cartella

# ---------------------------------------------------------------- Dipendenze
Passo 'Dipendenze (npm)'
& $npm install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install non riuscito: controlla la connessione a internet del server o il proxy (npm config set proxy ...).' }

# ---------------------------------------------------------------- Configurazione
Passo 'Configurazione'
$fileCfg = Join-Path $Cartella 'config.json'
if (Test-Path $fileCfg) {
  Write-Host 'config.json esistente: lo mantengo. Per cambiarlo modificalo con un editor e rilancia.'
} else {
  Write-Host 'Creo config.json. Premi Invio per accettare il valore tra parentesi.'
  $srv  = Chiedi 'Server SQL' 'localhost'
  $ist  = Chiedi 'Istanza SQL (vuoto = predefinita, es. SQLEXPRESS)' ''
  $db   = Chiedi 'Database' 'LEGNOEURO_TEST'
  $auth = Chiedi 'Autenticazione SQL Server: sql (utente e password) o windows' 'sql'
  $ute = ''; $pwdSql = ''
  if ($auth -eq 'sql') {
    $ute = Chiedi 'Utente SQL' 'gestlegno_web'
    $pwdSql = ChiediSegreto "Password dell'utente SQL $ute"
  } else {
    Write-Warning "Con 'windows' l'app si collega come account SYSTEM del server (login 'NT AUTHORITY\SYSTEM'): deve avere accesso al database."
  }
  $porta = [int](Chiedi 'Porta web' '3010')
  $scr  = Chiedi 'Attivare la scrittura sul database? s/n' 'n'
  $uApp = Chiedi "Utente per entrare nell'app" 'cliente'
  $pApp = ChiediSegreto "Password per l'utente $uApp"
  $cfg = [ordered]@{
    port = $porta; host = $(if ($AccessoDiretto) { '0.0.0.0' } else { '127.0.0.1' }); allowWrite = ($scr -eq 's')
    accesso = [ordered]@{ attivo = $true; utenti = [ordered]@{ $uApp = $pApp } }
    db = [ordered]@{ auth = $auth; server = $srv; instanceName = $ist; port = 1433; database = $db; odbcDriver = ''; user = $ute; password = $pwdSql }
  }
  [IO.File]::WriteAllText($fileCfg, ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  # solo amministratori e SYSTEM possono leggere config.json (contiene password)
  icacls $fileCfg /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
  Write-Host 'config.json creato (accessibile solo ad amministratori e SYSTEM).'
}
$cfgLetta = Get-Content $fileCfg -Raw | ConvertFrom-Json
$Porta = [int]$cfgLetta.port

# ---------------------------------------------------------------- Verifica database
Passo 'Verifica del database'
& $node (Join-Path $Cartella 'verifica-db.js')
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'La verifica del database non e riuscita. Controlla config.json (server, istanza, utente, password) e la cartella sql\.'
  if ((Chiedi 'Registrare comunque il servizio? s/n' 'n') -ne 's') { exit 1 }
}

# ---------------------------------------------------------------- Avvio automatico
Passo 'Avvio automatico (Utilita di pianificazione)'
Unregister-ScheduledTask -TaskName $NomeAttivita -Confirm:$false -ErrorAction SilentlyContinue
$azione = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/c `"$Cartella\avvia-servizio.cmd`"" -WorkingDirectory $Cartella
$avvio = New-ScheduledTaskTrigger -AtStartup
$utente = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$imp = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $NomeAttivita -Action $azione -Trigger $avvio -Principal $utente -Settings $imp `
  -Description "GestLegno Web (ordini profili) - $Cartella" | Out-Null
Start-ScheduledTask -TaskName $NomeAttivita
Write-Host "Attivita '$NomeAttivita' registrata e avviata."

# ---------------------------------------------------------------- Firewall
Passo 'Firewall'
Get-NetFirewallRule -DisplayName 'GestLegno Web' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($AccessoDiretto) {
  New-NetFirewallRule -DisplayName 'GestLegno Web' -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Domain, Private | Out-Null
  Write-Host "Porta $Porta aperta per le reti di dominio e private (accesso diretto, senza IIS)."
} else {
  Write-Host "Node.js ascolta solo su 127.0.0.1:${Porta}: dall'esterno si entra da IIS (https://$Dominio)."
}

# ---------------------------------------------------------------- Controllo finale
Passo 'Controllo'
Start-Sleep -Seconds 5
$ok = $false
try { Invoke-WebRequest "http://localhost:$Porta/" -UseBasicParsing -TimeoutSec 10 | Out-Null; $ok = $true }
catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $ok = $true } }
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
if (-not $ok) { Write-Warning "Il server non risponde sulla porta $Porta. Guarda $Cartella\logs\server.log" }
else { Write-Host "`nGestLegno Web e attivo su 127.0.0.1:$Porta. Registro: $Cartella\logs\server.log" -ForegroundColor Green }

# ---------------------------------------------------------------- IIS / HTTPS
if ($AccessoDiretto) {
  Write-Host "Accesso diretto: http://$($env:COMPUTERNAME):$Porta   oppure   http://$($ip):$Porta"
} elseif ((Chiedi "Configurare adesso IIS per https://$Dominio ? s/n" 's') -eq 's') {
  & (Join-Path $Cartella 'iis\configura-iis.ps1') -Dominio $Dominio -CartellaApp $Cartella
} else {
  Write-Host "Per pubblicare su https://$Dominio lancia piu tardi: $Cartella\iis\configura-iis.ps1"
}
