Import-Module WebAdministration

$NomeSito = 'gestlegno.mapnet.it'
$Dominio = 'gestlegno.mapnet.it'
$CartellaSito = 'C:\WEB\gestlegno.mapnet.it'
$Thumbprint = '7CAFA0FEB76BF2C71A5F4B7E45ECC3E5608209D7'

# Crea AppPool se non esiste
if (-not (Test-Path "IIS:\AppPools\$NomeSito")) {
    New-WebAppPool -Name $NomeSito | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$NomeSito" -Name managedRuntimeVersion -Value ''

# Crea sito se non esiste
if (-not (Get-Website -Name $NomeSito)) {
    New-Website -Name $NomeSito -PhysicalPath $CartellaSito -ApplicationPool $NomeSito -HostHeader $Dominio -Port 80 | Out-Null
    Write-Host "Sito '$NomeSito' creato"
} else {
    Set-ItemProperty "IIS:\Sites\$NomeSito" -Name physicalPath -Value $CartellaSito
    Set-ItemProperty "IIS:\Sites\$NomeSito" -Name applicationPool -Value $NomeSito
    Write-Host "Sito '$NomeSito' aggiornato"
}

# Binding HTTP
if (-not (Get-WebBinding -Name $NomeSito -Protocol http -Port 80 -HostHeader $Dominio -ErrorAction SilentlyContinue)) {
    New-WebBinding -Name $NomeSito -Protocol http -Port 80 -HostHeader $Dominio
}

# Binding HTTPS con SNI
$httpsBinding = Get-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio -ErrorAction SilentlyContinue
if (-not $httpsBinding) {
    New-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio -SslFlags 1
}

# Collega certificato
$binding = Get-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio
$binding.AddSslCertificate($Thumbprint, 'WebHosting')

# Avvia il sito
Start-Website -Name $NomeSito -ErrorAction SilentlyContinue

Write-Host "Sito '$NomeSito' configurato su $CartellaSito con HTTPS"
