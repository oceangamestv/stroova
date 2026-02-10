# CORS check: request with Origin as from Capacitor app
# Run: .\scripts\test-cors.ps1   or   .\scripts\test-cors.ps1 -BaseUrl "https://stroova.ru/api"

param(
    [string]$BaseUrl = "https://stroova.ru/api"
)

$uri = "$($BaseUrl.TrimEnd('/'))/me"
$origin = "capacitor://localhost"

Write-Host "URL: $uri" -ForegroundColor Cyan
Write-Host "Origin: $origin" -ForegroundColor Cyan
Write-Host ""

$response = $null
try {
    $response = Invoke-WebRequest -Uri $uri -Method GET `
        -Headers @{ "Origin" = $origin; "Content-Type" = "application/json" } `
        -UseBasicParsing -ErrorAction Stop
} catch {
    if ($_.Exception.Response) {
        $response = $_.Exception.Response
    }
}

if ($response) {
    $statusCode = [int]$response.StatusCode
    $allowOrigin = $response.Headers['Access-Control-Allow-Origin']
    Write-Host "Status: $statusCode" -ForegroundColor $(if ($statusCode -eq 200) { "Green" } elseif ($statusCode -eq 401) { "Yellow" } else { "Red" })
    Write-Host "Access-Control-Allow-Origin: $allowOrigin" -ForegroundColor Yellow
    if ($statusCode -eq 401) {
        Write-Host "401 = server got the request (no auth token). CORS is in the response headers above." -ForegroundColor Gray
    }
    if (-not $allowOrigin) {
        Write-Host "CORS header missing - server may block the app" -ForegroundColor Red
    } elseif ($allowOrigin -eq $origin) {
        Write-Host "OK: server allows app origin" -ForegroundColor Green
    } else {
        Write-Host "Server returned different origin - app may block response" -ForegroundColor Red
    }
} else {
    Write-Host "No response (connection failed)" -ForegroundColor Red
}
