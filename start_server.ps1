# Starts the Thaalam 24x7 Flask backend on http://localhost:8000
# Uses the Python 3.12 installed under %LOCALAPPDATA% (it is NOT on PATH).
$root = "C:\Users\akash\source\repos\Thaalam-Web-App"
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"

if (-not (Test-Path $py)) {
    Write-Error "Python not found at $py. Install Python 3.12 or update the path in this script."
    exit 1
}

# Stop any server.py that is already holding port 8000.
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'server\.py' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Write-Host "Starting Thaalam server at http://localhost:8000 ..."
Start-Process -FilePath $py -ArgumentList "server.py" -WorkingDirectory $root `
    -RedirectStandardOutput "$root\server_run.log" -RedirectStandardError "$root\server_run_err.log"
Start-Sleep -Seconds 3

try {
    $r = Invoke-WebRequest "http://localhost:8000/" -UseBasicParsing -TimeoutSec 10
    Write-Host "Server is UP. Open http://localhost:8000 in your browser (HTTP $($r.StatusCode))."
} catch {
    Write-Host "Server did not respond yet: $($_.Exception.Message)"
}

