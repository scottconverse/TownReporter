param([string]$DataRoot)
. "$PSScriptRoot\Common.ps1"
$config = Read-InstallConfig
Write-Host '1: Anthropic API key (paid API account required)'
Write-Host '2: OpenAI-compatible service or local model (base URL and model name required)'
Write-Host '3: Existing Claude Code or Codex sign-in (configure on the Server page)'
$choice = Read-Host 'Choose 1, 2 or 3'
if ($choice -eq '3') {
  '{}' | Set-Content -LiteralPath (Join-Path $DataRoot 'providers.json') -Encoding UTF8
  Write-Host "Open http://127.0.0.1:$($config.Port)/desk/ops and use Sign in. The corresponding CLI must already be installed."
  Write-Host 'Previous API overrides were cleared. Stop and Start TownReporter before signing in.'
  exit 0
}
$settings = [ordered]@{}
if ($choice -eq '1') {
  $settings.ANTHROPIC_API_KEY = ''
  $keyName = 'ANTHROPIC_API_KEY'
} elseif ($choice -eq '2') {
  $base = Read-Host 'Base URL, for example http://127.0.0.1:1234/v1'
  $parsed = $null
  if (![uri]::TryCreate($base, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -notin @('http','https') -or ($parsed.Scheme -eq 'http' -and !$parsed.IsLoopback)) { throw 'Use HTTPS for remote services, or HTTP only for a loopback local model.' }
  $settings.LLM_BASE_URL = $base
  $settings.LLM_MODEL = Read-Host 'Exact model name shown by your provider'
  if (!$settings.LLM_MODEL) { throw 'A model name is required.' }
  $keyName = 'LLM_API_KEY'
} else { throw 'No settings changed. Choose 1, 2 or 3.' }
$secret = Read-Host 'API key (hidden; leave blank only for a local service without a key)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $settings[$keyName] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ($choice -eq '1' -and !$settings[$keyName]) { throw 'An Anthropic API key is required. No settings changed.' }
$settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataRoot 'providers.json') -Encoding UTF8
Write-Host 'AI settings saved privately. Stop and Start TownReporter, then use Test on the Server page. A saved key is not proof the provider works.'
