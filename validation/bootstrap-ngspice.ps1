$ErrorActionPreference = "Stop"

$ngspiceVersion = "46"
$archiveSha256 = "7ED713CD8D401DB724FFE99087C3122BF05A9CFA99DE02C6EEED44EE44785A33"
$validationRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsRoot = Join-Path $validationRoot ".tools"
$archivePath = Join-Path $toolsRoot "ngspice-$($ngspiceVersion)_64.7z"
$executablePath = Join-Path $toolsRoot "Spice64\bin\ngspice_con.exe"
$downloadUrl = "https://downloads.sourceforge.net/project/ngspice/ng-spice-rework/$ngspiceVersion/ngspice-$($ngspiceVersion)_64.7z"

if ($env:OS -ne "Windows_NT") {
    throw "Este bootstrap es sólo para Windows. En Linux instala ngspice con el gestor de paquetes."
}

New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

if (-not (Test-Path -LiteralPath $archivePath)) {
    Write-Host "Descargando ngspice $ngspiceVersion desde SourceForge..."
    & curl.exe -L --fail --retry 3 --output $archivePath $downloadUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Falló la descarga de ngspice."
    }
}

$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actualHash -ne $archiveSha256) {
    throw "SHA-256 incorrecto para $archivePath. Esperado: $archiveSha256; obtenido: $actualHash."
}

if (-not (Test-Path -LiteralPath $executablePath)) {
    & tar.exe -xf $archivePath -C $toolsRoot
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo extraer el archivo portátil de ngspice."
    }
}

if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "La extracción terminó sin crear $executablePath."
}

& $executablePath --version
if ($LASTEXITCODE -ne 0) {
    throw "El binario extraído de ngspice no pudo ejecutarse."
}
