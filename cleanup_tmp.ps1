$root = "C:\Users\akash\source\repos\Thaalam-Web-App"
$files = @(
  "tmp_check.txt", "env2.txt", "env3.txt", "env4.txt", "ls2.txt", "gitlog.txt",
  "pip_pw.txt", "check_env.py", "check_browser.ps1", "test_embed.py",
  "browser_test.py", "browser_test2.py", "browser_test3.py", "browser_test4.py",
  "run_test.ps1", "run_browser_test.ps1", "run_browser_test2.ps1",
  "run_browser_test3.ps1", "run_browser_test4.ps1", "verify_server.ps1",
  "verify.txt", "server_out.log", "server_err.log", "server_run.log",
  "server_run_err.log", "test_out.txt", "embed_out.txt", "browser_out.txt",
  "browser_test2_out.txt", "browser_test3_out.txt", "browser_test4_out.txt",
  "mask_check.png"
)
foreach ($f in $files) {
  $p = Join-Path $root $f
  if (Test-Path $p) { Remove-Item $p -Force }
}
"cleaned" | Out-File "$root\cleanup_done.txt" -Encoding utf8
