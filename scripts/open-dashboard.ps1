$ErrorActionPreference = 'Stop'
$apiUrl = 'http://127.0.0.1:3210/api/health'
$dashboardUrl = 'http://127.0.0.1:5173'
$deadline = [DateTime]::UtcNow.AddSeconds(120)
$apiReady = $false

while (-not $apiReady -and [DateTime]::UtcNow -lt $deadline) {
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 2
        $apiReady = $response.ok -and $response.data.api -eq 'ready' -and $response.data.agent -eq 'ready'
    }
    catch {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $apiReady) { exit 1 }

$deadline = [DateTime]::UtcNow.AddSeconds(60)
$dashboardReady = $false
while (-not $dashboardReady -and [DateTime]::UtcNow -lt $deadline) {
    try {
        $null = Invoke-WebRequest -Uri $dashboardUrl -TimeoutSec 2 -UseBasicParsing
        $dashboardReady = $true
    }
    catch {
        Start-Sleep -Milliseconds 500
    }
}

if ($dashboardReady) { Start-Process $dashboardUrl }
