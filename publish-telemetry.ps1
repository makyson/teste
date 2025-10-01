param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Username = "admin",
    [string]$Password = "admin",
    [string]$CompanyId = "company-1",
    [string]$BoardId = "board-1",
    [string]$DeviceId = "device-123",
    [datetime]$Start = (Get-Date).ToUniversalTime().AddMonths(-1).Date,
    [int]$Days = 30,
    [int]$IntervalMinutes = 60,
    [int]$SleepMs = 0,
    [switch]$UseRest = $true,
    [switch]$UseMqtt = $false,
    [string]$ComposeServiceMosquitto = "mosquitto"
)

if ($IntervalMinutes -le 0) { throw "IntervalMinutes deve ser maior que zero." }
if ($Days -le 0)           { throw "Days deve ser maior que zero." }

try {
    $baseUri = [Uri]::new($BaseUrl)
} catch {
    throw ("BaseUrl inválida: {0}" -f $_)
}

$apiBase = $baseUri.AbsoluteUri.TrimEnd('/')
$telemetryUrl = ("{0}/companies/{1}/boards/{2}/telemetry" -f $apiBase, $CompanyId, $BoardId)
$loginUrl     = ("{0}/auth/login" -f $apiBase)

$end = $Start.AddDays($Days)
Write-Host ("[info] Período: {0} -> {1}" -f $Start.ToString('u'), $end.ToString('u')) -ForegroundColor Cyan

$headers = @{ 'Content-Type' = 'application/json' }

if ($UseRest) {
    $loginBody = @{ username = $Username; password = $Password; companyId = $CompanyId } | ConvertTo-Json
    try {
        $loginResponse = Invoke-RestMethod -Method Post -Uri $loginUrl -Body $loginBody -Headers $headers -ErrorAction Stop
    } catch {
        throw ("Falha ao autenticar na API ({0}): {1}" -f $loginUrl, $_)
    }

    if (-not $loginResponse.token) {
        throw "Resposta de autenticação inválida: token ausente."
    }

    $headers = @{
        Authorization = ("Bearer {0}" -f $loginResponse.token)
        'Content-Type' = 'application/json'
    }
    Write-Host "[ok] Autenticado na API" -ForegroundColor Green
}

if ($UseMqtt) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "docker não encontrado no PATH. Instale o Docker Desktop e tente novamente."
    }
    $topic = "companies/$CompanyId/boards/$BoardId/telemetry"
    Write-Host ("[info] MQTT habilitado. Tópico: {0}" -f $topic) -ForegroundColor Cyan
}

Write-Host "[info] Iniciando publicação" -ForegroundColor Yellow

for ($ts = $Start; $ts -lt $end; $ts = $ts.AddMinutes($IntervalMinutes)) {

    $payloadObj = [ordered]@{
        logical_id   = $DeviceId
        ts           = $ts.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        voltage      = [Math]::Round(220 + (Get-Random -Minimum -5.0 -Maximum 5.0), 2)
        current      = [Math]::Round(5   + (Get-Random -Minimum -1.5 -Maximum 1.5), 2)
        frequency    = [Math]::Round(60  + (Get-Random -Minimum -0.4 -Maximum 0.4), 2)
        power_factor = [Math]::Round(0.92 + (Get-Random -Minimum -0.05 -Maximum 0.05), 2)
    }

    $payload = $payloadObj | ConvertTo-Json -Compress

    if ($UseRest) {
        Write-Host ("[REST] POST {0}" -f $payload) -ForegroundColor Green
        try {
            $response = Invoke-RestMethod -Method Post -Uri $telemetryUrl -Headers $headers -Body $payload -ContentType "application/json" -ErrorAction Stop
        } catch {
            throw ("Falha ao enviar amostra via REST para {0}: {1}" -f $telemetryUrl, $_)
        }

        if ($null -eq $response -or $response.accepted -lt 1) {
            throw "Nenhuma amostra aceita pela API (campo 'accepted' < 1)."
        }
    }

    if ($UseMqtt) {
        Write-Host ("[MQTT] publish {0}" -f $payload) -ForegroundColor Green
        $args = @(
            "compose","exec","-T",$ComposeServiceMosquitto,
            "mosquitto_pub","-t","companies/$CompanyId/boards/$BoardId/telemetry","-m",$payload
        )
        $process = Start-Process -FilePath "docker" -ArgumentList $args -NoNewWindow -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw ("Falha ao publicar MQTT (exit {0})." -f $process.ExitCode)
        }
    }

    if ($SleepMs -gt 0) { Start-Sleep -Milliseconds $SleepMs }
}

Write-Host "[ok] Publicação concluída" -ForegroundColor Yellow
