$root = "C:\Users\akash\source\repos\Thaalam-Web-App"
$scratch = @(
  "shot.py", "run_shot.ps1", "shot_out.txt", "shot_before.txt",
  "before_desktop.png", "before_mobile.png", "files_now.txt",
  "server_out.log", "server_err.log", "server_run.log", "server_run_err.log"
)
foreach ($f in $scratch) {
  $p = Join-Path $root $f
  if (Test-Path $p) { Remove-Item $p -Force -ErrorAction SilentlyContinue }
}
"cleaned" | Out-File "$root\_cleanup_result.txt" -Encoding utf8
git -C $root status --short | Out-File "$root\_cleanup_result.txt" -Append -Encoding utf8