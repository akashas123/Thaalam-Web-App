# Starts the separate Thaalam 24x7 API backend on http://localhost:8000
# Uses the Python 3.12 installed under %LOCALAPPDATA% (it is NOT on PATH).
$root = "C:\Users\akash\source\repos\Thaalam-Web-App"
$backend = Join-Path $root "backend"
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"

if (-not (Test-Path $py)) {
    Write-Error "Python not found at $py. Install Python 3.12 or update the path in this script."
    exit 1
}

# Stop any backend/server.py that is already holding port 8000.
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'backend[\\/]server\.py' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Write-Host "Starting Thaalam API at http://localhost:8000 ..."
Start-Process -FilePath $py -ArgumentList "server.py" -WorkingDirectory $backend `
    -RedirectStandardOutput "$root\server_run.log" -RedirectStandardError "$root\server_run_err.log"
Start-Sleep -Seconds 3

try {
    $r = Invoke-WebRequest "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "API is UP at http://localhost:8000. Open the Vite site at http://localhost:5173."
} catch {
    Write-Host "Server did not respond yet: $($_.Exception.Message)"
}

