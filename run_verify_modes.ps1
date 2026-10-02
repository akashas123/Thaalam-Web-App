$ErrorActionPreference = 'Continue'
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$root = "C:\Users\akash\source\repos\Thaalam-Web-App"
& $py "$root\verify_modes.py" *> "$root\verify_modes.txt"
'=== done ===' | Out-File "$root\verify_modes.txt" -Append -Encoding utf8