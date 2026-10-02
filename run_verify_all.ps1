$ErrorActionPreference = 'Continue'
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$root = "C:\Users\akash\source\repos\Thaalam-Web-App"
$out = "$root\verify_all.txt"

$up = $false
try {
    $r = Invoke-WebRequest "http://localhost:8000/" -UseBasicParsing -TimeoutSec 8
    $up = ($r.StatusCode -eq 200)
} catch { $up = $false }

"server up: $up" | Out-File $out -Encoding utf8
if (-not $up) {
    $proc = Start-Process -FilePath $py -ArgumentList "server.py" -WorkingDirectory $root `
      -RedirectStandardOutput "$root\server_out.log" -RedirectStandardError "$root\server_err.log" -PassThru
    Start-Sleep -Seconds 5
    "started server pid: $($proc.Id)" | Out-File $out -Append -Encoding utf8
}

& $py "$root\verify_all.py" *>> $out
'=== done ===' | Out-File $out -Append -Encoding utf8