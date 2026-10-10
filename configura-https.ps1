Import-Module WebAdministration

$NomeSito = 'GestLegno'
$Dominio = 'gestlegno.mapnet.it'
$Thumbprint = '7CAFA0FEB76BF2C71A5F4B7E45ECC3E5608209D7'

# Rimuovi binding HTTPS esistente se presente
$existingBinding = Get-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio -ErrorAction SilentlyContinue
if ($existingBinding) {
    Remove-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio
}

# Aggiungi binding HTTPS con SNI
New-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio -SslFlags 1

# Collega il certificato
$binding = Get-WebBinding -Name $NomeSito -Protocol https -Port 443 -HostHeader $Dominio
$binding.AddSslCertificate($Thumbprint, 'WebHosting')

Write-Host "HTTPS configurato per $Dominio con certificato $Thumbprint"
