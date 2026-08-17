# JewelryFlow — migrate local PostgreSQL → Supabase
#
# Prerequisites:
#   - PostgreSQL client tools (pg_dump, psql) on PATH
#   - Local DB still has your data (e.g. jewelryflow_dev with 300 stock items)
#   - Supabase DIRECT (session) connection string — port 5432, NOT the pooler 6543
#
# WARNING: This REPLACES all data in the Supabase public schema with the local dump.
#          Current Render seed data (11 demo items, seed sales, etc.) will be wiped.
#
# Usage (from repo root, PowerShell):
#   .\server\scripts\migrate-local-to-supabase.ps1

$ErrorActionPreference = 'Stop'

$pgBinCandidates = @(
  'C:\Program Files\PostgreSQL\17\bin',
  'C:\Program Files\PostgreSQL\16\bin',
  'C:\Program Files\PostgreSQL\15\bin'
)
foreach ($dir in $pgBinCandidates) {
  if (Test-Path (Join-Path $dir 'pg_dump.exe')) {
    $env:PATH = "$dir;$env:PATH"
    break
  }
}

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Host 'pg_dump not found. Install PostgreSQL client tools.' -ForegroundColor Red
  exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Split-Path -Parent $ScriptDir
$DumpDir = Join-Path $ServerDir 'backups'
New-Item -ItemType Directory -Force -Path $DumpDir | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$DumpFile = Join-Path $DumpDir "local-to-supabase-$Stamp.dump"

Write-Host ''
Write-Host '=== SOURCE (local PostgreSQL) ===' -ForegroundColor Cyan
$LocalHost = Read-Host 'Host [localhost]'
if ([string]::IsNullOrWhiteSpace($LocalHost)) { $LocalHost = 'localhost' }
$LocalPort = Read-Host 'Port [5432]'
if ([string]::IsNullOrWhiteSpace($LocalPort)) { $LocalPort = '5432' }
$LocalDb = Read-Host 'Database name [jewelryflow_dev]'
if ([string]::IsNullOrWhiteSpace($LocalDb)) { $LocalDb = 'jewelryflow_dev' }
$LocalUser = Read-Host 'User [postgres]'
if ([string]::IsNullOrWhiteSpace($LocalUser)) { $LocalUser = 'postgres' }
$LocalPassSecure = Read-Host 'Password' -AsSecureString
$LocalPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($LocalPassSecure)
)

Write-Host ''
Write-Host '=== TARGET (Supabase DIRECT / session URL, port 5432) ===' -ForegroundColor Cyan
Write-Host 'Example host: db.XXXX.supabase.co  OR  aws-0-REGION.pooler.supabase.com'
Write-Host 'Use the SAME password as in server/.env DIRECT_URL'
Write-Host 'User is often: postgres.PROJECT_REF  (pooler) or postgres (direct db.* host)'
$RemoteHost = Read-Host 'Supabase host'
$RemotePort = Read-Host 'Port [5432]'
if ([string]::IsNullOrWhiteSpace($RemotePort)) { $RemotePort = '5432' }
$RemoteDb = Read-Host 'Database [postgres]'
if ([string]::IsNullOrWhiteSpace($RemoteDb)) { $RemoteDb = 'postgres' }
$RemoteUser = Read-Host 'User (e.g. postgres.ocihacxxubfjkoufeqsc)'
$RemotePassSecure = Read-Host 'Password' -AsSecureString
$RemotePass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($RemotePassSecure)
)

Write-Host ''
Write-Host "1) Counting local stock_items in $LocalDb ..." -ForegroundColor Cyan
$env:PGPASSWORD = $LocalPass
$localCount = & psql -h $LocalHost -p $LocalPort -U $LocalUser -d $LocalDb -tAc "SELECT count(*) FROM stock_items"
if ($LASTEXITCODE -ne 0) { throw "Cannot query local DB $LocalDb" }
Write-Host "   Local stock_items = $($localCount.Trim())"

Write-Host ''
Write-Host "2) Dumping local DB → $DumpFile" -ForegroundColor Cyan
& pg_dump -h $LocalHost -p $LocalPort -U $LocalUser -d $LocalDb -Fc --no-owner --no-acl -f $DumpFile
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
Write-Host '   Dump OK'

Write-Host ''
Write-Host '3) Confirm REPLACE all data on Supabase?' -ForegroundColor Yellow
$confirm = Read-Host 'Type YES to continue'
if ($confirm -ne 'YES') {
  Write-Host 'Aborted. Dump kept at:' $DumpFile
  exit 0
}

Write-Host ''
Write-Host '4) Resetting public schema on Supabase (keeps auth/storage schemas) ...' -ForegroundColor Cyan
$env:PGPASSWORD = $RemotePass
$resetSql = @'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
'@
$resetSql | & psql -h $RemoteHost -p $RemotePort -U $RemoteUser -d $RemoteDb -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Failed to reset public schema on Supabase' }

Write-Host ''
Write-Host '5) Restoring dump to Supabase ...' -ForegroundColor Cyan
& pg_restore -h $RemoteHost -p $RemotePort -U $RemoteUser -d $RemoteDb --no-owner --no-acl --verbose $DumpFile
# pg_restore often exits 1 with harmless warnings; verify counts instead
Write-Host '   pg_restore finished (check counts next)'

Write-Host ''
Write-Host '6) Verifying remote stock_items ...' -ForegroundColor Cyan
$remoteCount = & psql -h $RemoteHost -p $RemotePort -U $RemoteUser -d $RemoteDb -tAc "SELECT count(*) FROM stock_items"
if ($LASTEXITCODE -ne 0) { throw 'Restore may have failed — cannot query stock_items on Supabase' }
Write-Host "   Supabase stock_items = $($remoteCount.Trim())"

Write-Host ''
Write-Host '7) Sync Prisma migrations on Supabase (server/.env must point at Supabase) ...' -ForegroundColor Cyan
Set-Location $ServerDir
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
  Write-Host 'migrate deploy reported an error — check if schema already matches the dump.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '============================================' -ForegroundColor Green
Write-Host ' Migration complete' -ForegroundColor Green
Write-Host " Local count:  $($localCount.Trim())" -ForegroundColor Green
Write-Host " Remote count: $($remoteCount.Trim())" -ForegroundColor Green
Write-Host " Dump file:    $DumpFile" -ForegroundColor Green
Write-Host '============================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Next:'
Write-Host ' 1. Restart / redeploy Render (it already uses Supabase).'
Write-Host ' 2. Hard-refresh the web app and mobile — you should see ~300 stock items.'
Write-Host ' 3. Log in with a user that exists in the migrated DB (local users were copied).'
Write-Host ''
