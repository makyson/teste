param(
    [string]$CompanyId = "company-1",
    [string]$BoardId = "board-1",
    [string]$DeviceId = "device-123",
    [datetime]$Start = (Get-Date).ToUniversalTime().AddMonths(-1).Date,
    [int]$Days = 30,
    [int]$IntervalMinutes = 60,
    [int]$SleepMs = 0
)

if ($IntervalMinutes -le 0) {
    throw "IntervalMinutes deve ser maior que zero."
}
if ($Days -le 0) {
    throw "Days deve ser maior que zero."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "docker não encontrado no PATH. Instale o Docker Desktop e tente novamente."
}

$topic = "companies/$CompanyId/boards/$BoardId/telemetry"
$end = $Start.AddDays($Days)

Write-Host "[info] Publicando medições de $($Start.ToString('u')) até $($end.ToString('u')) em $topic" -ForegroundColor Cyan

for ($ts = $Start; $ts -lt $end; $ts = $ts.AddMinutes($IntervalMinutes)) {
    $payloadObj = [ordered]@{
        logical_id  = $DeviceId
        ts          = $ts.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        voltage     = [Math]::Round(220 + (Get-Random -Minimum -5.0 -Maximum 5.0), 2)
        current     = [Math]::Round(5 + (Get-Random -Minimum -1.5 -Maximum 1.5), 2)
        frequency   = [Math]::Round(60 + (Get-Random -Minimum -0.4 -Maximum 0.4), 2)
        power_factor = [Math]::Round(0.92 + (Get-Random -Minimum -0.05 -Maximum 0.05), 2)
    }

    $payload = $payloadObj | ConvertTo-Json -Compress

    Write-Host ("[publish] {0}" -f $payload) -ForegroundColor Green

    $args = @(
        "compose", "exec", "-T", "mosquitto",
        "mosquitto_pub", "-t", $topic, "-m", $payload
    )

    $process = Start-Process -FilePath "docker" -ArgumentList $args -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Falha ao publicar mensagem em $topic (exit $($process.ExitCode))."
    }

    if ($SleepMs -gt 0) {
        Start-Sleep -Milliseconds $SleepMs
    }
}

Write-Host "[ok] Publicação concluída" -ForegroundColor Yellow
