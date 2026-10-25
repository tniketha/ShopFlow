$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
function Invoke-Npm { param([string[]]$NpmArgs) & npm.cmd @NpmArgs; if ($LASTEXITCODE -ne 0) { throw "Setup step failed: npm $NpmArgs" } }
Invoke-Npm -NpmArgs @('ci', '--no-fund')
& node scripts/prepare-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'Environment setup failed' }
Write-Host 'Choose your owner login. On an existing database, existing accounts are kept.'
$env:OWNER_EMAIL = Read-Host 'Owner email'
$env:OWNER_NAME = Read-Host 'Your display name'
$securePassword = Read-Host 'Owner password (at least 12 characters)' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:BUSINESS_NAME = Read-Host 'Store name'
  Invoke-Npm -NpmArgs @('run', 'local:setup')
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  Remove-Item Env:OWNER_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:OWNER_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:OWNER_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:BUSINESS_NAME -ErrorAction SilentlyContinue
}
Write-Host 'Setup complete. Terminal 1: npm run local:db. Terminal 2: npm run dev. Open http://localhost:3000.'
