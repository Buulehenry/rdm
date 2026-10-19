$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'local.pid'
if (!(Test-Path -LiteralPath $pidFile)) { Write-Output 'No recorded local RDM process.'; exit }
$rdmProcessId = [int](Get-Content -LiteralPath $pidFile)
$rdmProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$rdmProcessId"
if (!$rdmProcess) { Write-Output 'RDM is already stopped.'; exit }
if ($rdmProcess.CommandLine -notlike '*serve_local.py*' -or $rdmProcess.CommandLine -notlike '*\rdm\*') {
    throw 'Recorded PID no longer belongs to this RDM server. Refusing to stop it.'
}
Stop-Process -Id $rdmProcessId
Write-Output 'Local RDM server stopped.'
