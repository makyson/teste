param(
       codex/criar-script-.ps-para-pre-exibir-dados-wbnnde
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Username = "admin",
    [string]$Password = "admin",

       main
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

     codex/criar-script-.ps-para-pre-exibir-dados-wbnnde
try {
    $baseUri = [Uri]::new($BaseUrl)
} catch {
    throw "BaseUrl inválida: $_"
}

$end = $Start.AddDays($Days)
$telemetryUrl = "{0}/companies/{1}/boards/{2}/telemetry" -f $baseUri.AbsoluteUri.TrimEnd('/'), $CompanyId, $BoardId
$loginUrl = "{0}/auth/login" -f $baseUri.AbsoluteUri.TrimEnd('/')

Write-Host "[info] Publicando medições de $($Start.ToString('u')) até $($end.ToString('u')) via $telemetryUrl" -ForegroundColor Cyan

$loginBody = @{
    username = $Username
    password = $Password
    companyId = $CompanyId
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Method Post -Uri $loginUrl -Body $loginBody -ContentType "application/json" -ErrorAction Stop
} catch {
    throw "Falha ao autenticar na API: $_"
}

if (-not $loginResponse.token) {
    throw "Resposta de autenticação inválida: token ausente."
}

$headers = @{
    Authorization = "Bearer $($loginResponse.token)"
    'Content-Type' = 'application/json'
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
     main

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

       codex/criar-script-.ps-para-pre-exibir-dados-wbnnde
    Write-Host ("[POST] {0}" -f $payload) -ForegroundColor Green

    try {
        $response = Invoke-RestMethod -Method Post -Uri $telemetryUrl -Headers $headers -Body $payload -ContentType "application/json" -ErrorAction Stop
    } catch {
        throw "Falha ao enviar amostra para $telemetryUrl: $_"
    }

    if ($response.accepted -lt 1) {
        throw "Nenhuma amostra aceita na resposta da API."

    Write-Host ("[publish] {0}" -f $payload) -ForegroundColor Green

    $args = @(
        "compose", "exec", "-T", "mosquitto",
        "mosquitto_pub", "-t", $topic, "-m", $payload
    )

    $process = Start-Process -FilePath "docker" -ArgumentList $args -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Falha ao publicar mensagem em $topic (exit $($process.ExitCode))."
       main
    }

    if ($SleepMs -gt 0) {
        Start-Sleep -Milliseconds $SleepMs
    }
}

Write-Host "[ok] Publicação concluída" -ForegroundColor Yellow
