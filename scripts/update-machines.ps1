# ARX Send - Atualizacao silenciosa para v2.1.0
# Execute em cada maquina: powershell -ExecutionPolicy Bypass -File update-machines.ps1

$version  = "2.1.0"
$url      = "https://github.com/alclord/arx-send/releases/download/v$version/ARX-Send-Setup-$version.exe"
$dest     = "$env:TEMP\ARX-Send-Setup-$version.exe"
$expected = "7d92659de32712cb23bc53b4178906d3fbaf8217e543b53cd9c35005137928ea"

Write-Host "ARX Send - Atualizando para v$version..." -ForegroundColor Cyan

# Baixa o instalador
try {
    Write-Host "Baixando instalador..."
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($url, $dest)
    Write-Host "Download concluido." -ForegroundColor Green
} catch {
    Write-Host "Erro ao baixar: $_" -ForegroundColor Red
    exit 1
}

# Verifica integridade (SHA-256)
$hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $expected) {
    Write-Host "ERRO: hash SHA-256 invalido. Arquivo corrompido?" -ForegroundColor Red
    Remove-Item $dest -Force
    exit 1
}
Write-Host "Integridade verificada." -ForegroundColor Green

# Encerra o app se estiver aberto
$proc = Get-Process "ARX Send" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "Encerrando ARX Send..."
    $proc | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Instala silenciosamente
Write-Host "Instalando..."
Start-Process $dest -ArgumentList "/S" -Wait
Remove-Item $dest -Force

Write-Host "ARX Send v$version instalado com sucesso!" -ForegroundColor Green
