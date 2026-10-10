#Requires -RunAsAdministrator
<#
  GestLegno Web - pubblicazione su https://gestlegno.mapnet.it tramite IIS (reverse proxy verso Node.js)
  - installa IIS se manca, URL Rewrite e Application Request Routing (ARR)
  - attiva il proxy ARR e crea il sito IIS "GestLegno" con il web.config di inoltro
  - collega un certificato gia presente sul server (per il dominio o *.mapnet.it) oppure spiega come ottenerlo con win-acme
  Rilanciabile. Uso: powershell -ExecutionPolicy Bypass -File iis\configura-iis.ps1 [-Dominio gestlegno.mapnet.it] [-Thumbprint ABC...]
#>
param(
  [string]$Dominio = 'gestlegno.mapnet.it',
  [string]$CartellaSito = 'C:\inetpub\gestlegno',
  [string]$CartellaApp = 'C:\GestLegnoWeb',
  [string]$Thumbprint = ''
)
$ErrorActionPreference = 'Stop'
$Origine = Split-Path -Parent $MyInvocation.MyCommand.Path
$NomeSito = 'GestLegno'
$APPHOST = 'MACHINE/WEBROOT/APPHOST'
function Passo($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

$porta = 3010
if (Test-Path "$CartellaApp\config.json") { $porta = [int]((Get-Content "$CartellaApp\config.json" -Raw) | ConvertFrom-Json).port }
Write-Host "Pubblico https://$Dominio  ->  Node.js su 127.0.0.1:$porta" -ForegroundColor Green

# ---------------------------------------------------------------- IIS
Passo 'IIS'
if (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue) {
  $r = Install-WindowsFeature Web-Server, Web-Mgmt-Console
  if ($r.RestartNeeded -eq 'Yes') { Write-Warning 'IIS installato: serve un riavvio del server, poi rilancia questo script.'; exit 1 }
} else {
  Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, IIS-ManagementConsole -All -NoRestart | Out-Null
}
Import-Module WebAdministration
Write-Host 'IIS presente.'

# ---------------------------------------------------------------- URL Rewrite + ARR
Passo 'URL Rewrite e Application Request Routing'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function InstallaMsi($nome, $url, $pagina) {
  $f = Join-Path $env:TEMP "$nome.msi"
  try {
    Write-Host "Scarico e installo $nome..."
    Invoke-WebRequest $url -OutFile $f -UseBasicParsing
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$f`" /qn /norestart" -Wait -PassThru
    if ($p.ExitCode -notin 0, 3010) { throw "msiexec codice $($p.ExitCode)" }
  } catch {
    throw "Installazione di $nome non riuscita ($($_.Exception.Message)). Installalo a mano da $pagina e rilancia lo script."
  }
}
$haRewrite = { Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll" }
$haArr = { Test-Path "$env:ProgramFiles\IIS\Application Request Routing\requestRouter.dll" }
if (-not (& $haRewrite)) {
  InstallaMsi 'URL Rewrite 2.1' 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' 'https://www.iis.net/downloads/microsoft/url-rewrite'
}
if (-not (& $haArr)) {
  InstallaMsi 'Application Request Routing 3.0' 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi' 'https://www.iis.net/downloads/microsoft/application-request-routing'
}
if (-not (& $haRewrite) -or -not (& $haArr)) { throw 'URL Rewrite o ARR non risultano installati.' }
Write-Host 'URL Rewrite e ARR presenti.'

# ---------------------------------------------------------------- Proxy ARR
Passo 'Proxy ARR'
Set-WebConfigurationProperty -PSPath $APPHOST -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true
Set-WebConfigurationProperty -PSPath $APPHOST -Filter 'system.webServer/proxy' -Name 'preserveHostHeader' -Value $true
Set-WebConfigurationProperty -PSPath $APPHOST -Filter 'system.webServer/proxy' -Name 'reverseRewriteHostInResponseHeaders' -Value $false
Set-WebConfigurationProperty -PSPath $APPHOST -Filter 'system.webServer/proxy' -Name 'timeout' -Value '00:05:00'   # l'export puo durare minuti
$var = Get-WebConfiguration -PSPath $APPHOST -Filter "system.webServer/rewrite/allowedServerVariables/add[@name='HTTP_X_FORWARDED_PROTO']"
if (-not $var) {
  Add-WebConfigurationProperty -PSPath $APPHOST -Filter 'system.webServer/rewrite/allowedServerVariables' -Name '.' -Value @{ name = 'HTTP_X_FORWARDED_PROTO' }
}
Write-Host 'Proxy attivo (timeout 5 minuti).'

# ---------------------------------------------------------------- Sito
Passo "Sito IIS '$NomeSito'"
New-Item -ItemType Directory -Force -Path $CartellaSito | Out-Null
$wc = (Get-Content (Join-Path $Origine 'web.config') -Raw).Replace('__PORTA__', "$porta")
[IO.File]::WriteAllText((Join-Path $CartellaSito 'web.config'), $wc, (New-Object Text.UTF8Encoding $false))
if (-not (Test-Path "IIS:\AppPools\$NomeSito")) { New-WebAppPool -Name $NomeSito | Out-Null }
Set-ItemProperty "IIS:\AppPools\$NomeSito" -Name managedRuntimeVersion -Value ''
if (-not (Get-Website -Name $NomeSito)) {
  New-Website -Name $NomeSito -PhysicalPath $CartellaSito -ApplicationPool $NomeSito -HostHeader $Dominio -Port 80 | Out-Null
} else {
  Set-ItemProperty "IIS:\Sites\$NomeSito" -Name physicalPath -Value $CartellaSito
  Set-ItemProperty "IIS:\Sites\$NomeSito" -Name applicationPool -Value $NomeSito
  if (-not (Get-WebBinding -Name $NomeSito -Protocol http -Port 80 -HostHeader $Dominio)) {
    New-WebBinding -Name $NomeSito -Protocol http -Port 80 -HostHeader $Dominio
  }
}
Start-Website -Name $NomeSito -ErrorAction SilentlyContinue
$idSito = (Get-Website -Name $NomeSito).id
Write-Host "Sito '$NomeSito' (id $idSito) su http://$Dominio, cartella $CartellaSito"

# ---------------------------------------------------------------- Certificato
Passo 'Certificato HTTPS'
$cert = $null
if ($Thumbprint) {
  $cert = Get-Item "Cert:\LocalMachine\My\$($Thumbprint -replace '\s','')" -ErrorAction SilentlyContinue
  if (-not $cert) { throw "Certificato $Thumbprint non trovato in Computer locale\Personale." }
} else {
  $jolly = '*.' + $Dominio.Split('.', 2)[1]
  $cert = Get-ChildItem Cert:\LocalMachine\My |
    Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(7) -and
      (($_.DnsNameList.Unicode -contains $Dominio) -or ($_.DnsNameList.Unicode -contains $jolly)) } |
    Sort-Object NotAfter -Descending | Select-Object -First 1
}
if ($cert) {
  if (-not (Get-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio)) {
    New-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio -SslFlags 1
  }
  (Get-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio).AddSslCertificate($cert.Thumbprint, 'My')
  Write-Host "HTTPS attivo con il certificato '$($cert.Subject)', scadenza $($cert.NotAfter.ToString('dd/MM/yyyy'))." -ForegroundColor Green
} else {
  Write-Warning "Nessun certificato valido per $Dominio sul server. Il sito risponde in HTTP e reindirizza a HTTPS, che non funziona finche non c'e il certificato."
  Write-Host @"

Per un certificato gratuito Let's Encrypt con rinnovo automatico (win-acme):
  1. DNS: record A  $Dominio  ->  IP pubblico del server
  2. Router/firewall: porte 80 e 443 inoltrate a questo server (la 80 serve alla verifica di Let's Encrypt)
  3. Scarica win-acme da https://www.win-acme.com (versione x64 "pluggable") ed estrailo in C:\win-acme
  4. Da PowerShell come amministratore:
       C:\win-acme\wacs.exe --source iis --siteid $idSito --host $Dominio --accepttos --emailaddress TUA@EMAIL
     win-acme crea il certificato, aggiunge il binding https al sito e programma il rinnovo.
Se hai gia un certificato (es. *.mapnet.it) importalo in Computer locale\Personale e rilancia questo script,
oppure passa -Thumbprint <impronta>.
"@
}

# ---------------------------------------------------------------- Controllo
Passo 'Controllo'
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($curl) {
  $node = & curl.exe -s -o NUL -w '%{http_code}' "http://127.0.0.1:$porta/"
  $iis = & curl.exe -s -o NUL -w '%{http_code}' -H "Host: $Dominio" 'http://127.0.0.1/'
  Write-Host "Node.js su 127.0.0.1:$porta  -> $node  (401 o 200 = attivo)"
  Write-Host "IIS http://$Dominio      -> $iis  (301 = reindirizza a https, corretto)"
  if ($cert) {
    $https = & curl.exe -s -k -o NUL -w '%{http_code}' --resolve "$($Dominio):443:127.0.0.1" "https://$Dominio/"
    Write-Host "IIS https://$Dominio     -> $https  (401 = chiede utente e password, corretto)"
  }
} else { Write-Host "Apri https://$Dominio dal browser per verificare." }
Write-Host "`nFatto. Indirizzo per il cliente: https://$Dominio" -ForegroundColor Green
