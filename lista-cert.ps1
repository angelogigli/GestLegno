Get-ChildItem Cert:\LocalMachine\My |
  Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(7) } |
  Select-Object Subject, Thumbprint, NotAfter |
  Format-Table -AutoSize
