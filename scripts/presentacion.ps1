<#
.SYNOPSIS
  Enciende o apaga la demo de Plano 3D en Azure para presentar.

.DESCRIPTION
  La API vive en Azure Container Apps (ca-plano3d-api, plan de consumo). Con mínimo 0 réplicas se
  apaga sola tras unos minutos sin uso y la primera visita espera ~20 s a que arranque; con mínimo 1
  queda siempre lista (≈ US$0,8 al día en reposo con 1 vCPU / 2 GiB). Las cuentas, proyectos y
  renders sobreviven a los apagados porque se copian en Azure Blob (ADR-022).

  on      mínimo 1 réplica, espera a que /api/health responda y muestra las direcciones
  off     mínimo 0 réplicas (se apaga sola cuando nadie la usa)
  estado  réplicas, imagen y salud, sin cambiar nada

  -ReiniciarDemo  con «on»: deja la casa de 3 pisos de la cuenta demo como nueva.

.EXAMPLE
  powershell -File scripts\presentacion.ps1 on -ReiniciarDemo
  powershell -File scripts\presentacion.ps1 off
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('on', 'off', 'estado')][string]$Accion,
  [switch]$ReiniciarDemo,
  [string]$Grupo = 'rg-plano3d-demo',
  [string]$App = 'ca-plano3d-api'
)

$ErrorActionPreference = 'Stop'
$web = 'https://lively-island-09e124b1e.5.azurestaticapps.net'

# az escribe avisos en stderr; en PowerShell 5.1 eso cuenta como error con -ErrorAction Stop
function Invoke-Az {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { az @args --only-show-errors 2>$null } finally { $ErrorActionPreference = $prev }
}

function Get-Estado {
  $json = Invoke-Az containerapp show -n $App -g $Grupo --query '{min:properties.template.scale.minReplicas,max:properties.template.scale.maxReplicas,imagen:properties.template.containers[0].image,fqdn:properties.configuration.ingress.fqdn}' -o json
  if ($LASTEXITCODE -ne 0 -or -not $json) { throw "No pude leer $App. ¿Iniciaste sesión con «az login»?" }
  return ($json | Out-String | ConvertFrom-Json)
}

function Wait-Api([string]$api, [int]$segundos = 180) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "$api/health" -TimeoutSec 15
      if ($r.StatusCode -eq 200) { return $true }
    } catch { Start-Sleep -Seconds 5 }
  }
  return $false
}

function Set-Minimo([int]$minimo) {
  Invoke-Az containerapp update -n $App -g $Grupo --min-replicas $minimo --max-replicas 1 -o none | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "az containerapp update falló" }
}

$estado = Get-Estado
$api = "https://$($estado.fqdn)/api"

switch ($Accion) {
  'estado' {
    $vivo = Wait-Api $api 40
    Write-Host "Réplicas mínimas: $($estado.min) (máx. $($estado.max))"
    Write-Host "Imagen: $($estado.imagen)"
    Write-Host ("API: {0} → {1}" -f $api, $(if ($vivo) { 'responde' } else { 'no responde' }))
    Write-Host "Web: $web"
  }
  'off' {
    if ($estado.min -ne 0) { Set-Minimo 0 }
    Write-Host 'Listo: la API se apagará sola cuando nadie la use (la primera visita tardará ~20 s).'
  }
  'on' {
    if ($estado.min -ne 1) { Set-Minimo 1 }
    Write-Host 'Esperando a que la API responda…'
    if (-not (Wait-Api $api)) { throw "La API no respondió en 3 minutos: revisa «az containerapp logs show -n $App -g $Grupo»" }
    if ($ReiniciarDemo) {
      $sesion = Invoke-RestMethod -Method Post -Uri "$api/auth/demo"
      Invoke-RestMethod -Method Post -Uri "$api/auth/demo/reset" -Headers @{ Authorization = "Bearer $($sesion.access_token)" } | Out-Null
      Write-Host 'Casa demo reiniciada.'
    }
    Write-Host "Lista para presentar: $web  (botón «Entrar con la cuenta demo»)"
    Write-Host 'Al terminar: powershell -File scripts\presentacion.ps1 off'
  }
}
