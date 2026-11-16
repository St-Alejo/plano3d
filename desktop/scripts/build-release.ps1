<#
.SYNOPSIS
  Arma el instalador de Plano 3D para Windows y, con -Publish, lo sube como release de GitHub.

.DESCRIPTION
  1. Comprueba que la versión pedida sea la de AppVersion.Current (UpdateChecker.cs).
  2. Corre las pruebas de Core e Infrastructure.
  3. Exporta la app con Godot (preset "Windows Desktop") a build\app\.
  4. Compila installer\plano3d.iss con Inno Setup → build\Plano3D-Setup.exe.
  5. Calcula el SHA-256 y, con -Publish, crea el release vX.Y.Z en St-Alejo/plano3d-frontend
     (la web lee de ahí la versión, el tamaño y el SHA-256; la descarga es releases/latest).

  Requisitos: SDK de .NET 8, Godot 4.7.2 .NET con sus plantillas de exportación, Inno Setup 6
  y, para publicar, gh con sesión iniciada.

.EXAMPLE
  powershell -File desktop\scripts\build-release.ps1 -Version 1.0.0
  powershell -File desktop\scripts\build-release.ps1 -Version 1.0.0 -Publish
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$Publish,
  [switch]$SkipTests,
  [string]$Repo = 'St-Alejo/plano3d-frontend'
)

$ErrorActionPreference = 'Stop'
$desktop = Split-Path -Parent $PSScriptRoot
$app = Join-Path $desktop 'app'
$build = Join-Path $desktop 'build'
$godotVersion = '4.7.2'

function Find-Tool([string]$name, [string[]]$candidates) {
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
  }
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "No encontré $name. Instálalo o pon su ruta en la variable de entorno correspondiente."
}

# ------------------------------------------------------------------ versión
$versionFile = Join-Path $desktop 'src\Plano3D.Infrastructure\Updates\UpdateChecker.cs'
$current = (Select-String -Path $versionFile -Pattern 'Current = "([^"]+)"').Matches[0].Groups[1].Value
if ($current -ne $Version) {
  throw "AppVersion.Current dice $current y pediste ${Version}: cambia la constante en $versionFile y haz commit antes de publicar."
}

# ------------------------------------------------------------------ herramientas
$dotnetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet'
if (Test-Path (Join-Path $dotnetRoot 'dotnet.exe')) { $env:DOTNET_ROOT = $dotnetRoot; $env:PATH = "$dotnetRoot;$env:PATH" }
$wingetGodot = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter "Godot_v$godotVersion-stable_mono_win64_console.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$godot = Find-Tool 'godot' @($env:PLANO3D_GODOT, $(if ($wingetGodot) { $wingetGodot.FullName }))
$iscc = Find-Tool 'ISCC.exe' @($env:PLANO3D_ISCC, (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'), "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe")
$templates = Join-Path $env:APPDATA "Godot\export_templates\$godotVersion.stable.mono\windows_release_x86_64.exe"
if (-not (Test-Path $templates)) {
  throw "Faltan las plantillas de exportación de Godot $godotVersion .NET ($templates). Instálalas desde el editor: Editor > Administrar plantillas de exportación."
}

# ------------------------------------------------------------------ pruebas
if (-not $SkipTests) {
  Write-Host '== Pruebas'
  & dotnet test (Join-Path $desktop 'tests\Plano3D.Core.Tests') --nologo -v q
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de Core' }
  & dotnet test (Join-Path $desktop 'tests\Plano3D.Infrastructure.Tests') --nologo -v q
  if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de Infrastructure' }
}

# ------------------------------------------------------------------ exportar
Write-Host '== Exportando con Godot'
$out = Join-Path $build 'app'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null
& $godot --headless --path $app --import | Out-Null
& $godot --headless --path $app --export-release 'Windows Desktop' (Join-Path $out 'Plano3D.exe')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $out 'Plano3D.exe'))) { throw 'Godot no exportó la app' }
# sin la carpeta data_* la app arranca sin sus scripts C#: Godot solo lo avisa, aquí es error
if (-not (Get-ChildItem -Path $out -Directory -Filter 'data_*' | Where-Object { Test-Path (Join-Path $_.FullName 'Plano3D.App.dll') })) {
  throw 'La exportación salió sin los ensamblados .NET (data_*\Plano3D.App.dll): revisa el SDK de .NET y app\Plano3D.App.sln'
}

# ------------------------------------------------------------------ instalador
Write-Host '== Compilando el instalador'
& $iscc "/DMyAppVersion=$Version" /Q (Join-Path $desktop 'installer\plano3d.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup falló' }
$setup = Join-Path $build 'Plano3D-Setup.exe'
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
$size = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "Listo: $setup ($size MB)"
Write-Host "SHA-256: $hash"

# ------------------------------------------------------------------ publicar
if ($Publish) {
  Write-Host "== Publicando v$Version en $Repo"
  $notes = @"
Plano 3D $Version para Windows 10/11 (64 bits).

Descarga **Plano3D-Setup.exe**, ábrelo y, si Windows muestra «Windows protegió su PC», pulsa «Más información» → «Ejecutar de todas formas» (el instalador no tiene firma de código).

SHA-256: $hash
"@
  & gh release create "v$Version" $setup --repo $Repo --title "Plano 3D $Version para Windows" --notes $notes --latest
  if ($LASTEXITCODE -ne 0) { throw 'gh release create falló' }
}
