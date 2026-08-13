# JewelryFlow — one-time local Windows setup
# Run from project root: Right-click → "Run with PowerShell"

$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Ensure-NodeJs {
  Write-Step 'Checking Node.js (>= 18)...'
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    Write-Host 'Please install Node.js from https://nodejs.org (LTS version) and run this script again.' -ForegroundColor Red
    exit 1
  }
  $version = node -v
  if ($version -match '^v(\d+)') {
    $major = [int]$Matches[1]
    if ($major -lt 18) {
      Write-Host "Node.js $version found, but version 18 or higher is required." -ForegroundColor Red
      Write-Host 'Please install Node.js LTS from https://nodejs.org and run this script again.' -ForegroundColor Red
      exit 1
    }
  }
  Write-Host "Node.js $version OK"
}

function Ensure-PostgresBin {
  Write-Step 'Checking PostgreSQL...'

  $pgCommands = @('pg_isready', 'createdb', 'pg_dump')
  $allOnPath = $true
  foreach ($cmd in $pgCommands) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
      $allOnPath = $false
      break
    }
  }

  if (-not $allOnPath) {
    $candidates = @(
      'C:\Program Files\PostgreSQL\16\bin',
      'C:\Program Files\PostgreSQL\15\bin',
      'C:\Program Files\PostgreSQL\14\bin'
    )
    $found = $null
    foreach ($dir in $candidates) {
      if (Test-Path (Join-Path $dir 'pg_isready.exe')) {
        $found = $dir
        break
      }
    }
    if (-not $found) {
      Write-Host 'Please install PostgreSQL from https://www.postgresql.org/download/windows/' -ForegroundColor Red
      Write-Host 'and run this script again.' -ForegroundColor Red
      exit 1
    }
    $env:PATH = "$found;$env:PATH"
    Write-Host "Added PostgreSQL to PATH for this session: $found"
  }

  & pg_isready -h localhost -p 5432 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'PostgreSQL is installed but not responding on localhost:5432.' -ForegroundColor Red
    Write-Host 'Start the PostgreSQL service (Windows Services → postgresql) and run this script again.' -ForegroundColor Red
    exit 1
  }
  Write-Host 'PostgreSQL is running'
}

function New-JwtSecret {
  $bytes = New-Object byte[] 64
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

# Resolve paths — script lives in server/scripts/
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent $ServerDir
$ClientDir = Join-Path $RootDir 'client'
$EnvFile = Join-Path $ServerDir '.env'

Set-Location $RootDir

Ensure-NodeJs
Ensure-PostgresBin

Write-Step 'Database password'
Write-Host 'Enter the password for the PostgreSQL ''postgres'' user (used during PostgreSQL installation).'
$securePg = Read-Host 'PostgreSQL password' -AsSecureString
$pgPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePg)
)
if ([string]::IsNullOrWhiteSpace($pgPassword)) {
  Write-Host 'A PostgreSQL password is required.' -ForegroundColor Red
  exit 1
}

$jwtSecret = New-JwtSecret
$dbPasswordEscaped = $pgPassword -replace '"', '""'

Write-Step 'Writing server/.env'
$envContent = @"
DATABASE_URL="postgresql://postgres:$dbPasswordEscaped@localhost:5432/jewelryflow"
JWT_SECRET=$jwtSecret
NODE_ENV=production
PORT=4000
ALLOWED_ORIGINS=http://localhost:4000
"@
Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8
Write-Host "Created $EnvFile"

Write-Step 'Installing server dependencies'
Set-Location $ServerDir
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Building server'
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Creating database jewelryflow'
$env:PGPASSWORD = $pgPassword
$createOut = & createdb -U postgres -h localhost jewelryflow 2>&1
$createExit = $LASTEXITCODE
if ($createExit -ne 0) {
  if ($createOut -match 'already exists') {
    Write-Host 'Database already exists — skipping creation'
  } else {
    Write-Host $createOut -ForegroundColor Red
    exit $createExit
  }
} else {
  Write-Host 'Database jewelryflow created'
}

Write-Step 'Running database migrations'
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Seeding database (default owner account)'
npx ts-node -r tsconfig-paths/register prisma/seed.ts
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Seed failed — trying without tsconfig-paths...' -ForegroundColor Yellow
  npx ts-node prisma/seed.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Step 'Installing client dependencies'
Set-Location $ClientDir
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Step 'Building client'
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Set-Location $RootDir

Write-Host ''
Write-Host '============================================' -ForegroundColor Green
Write-Host ' Setup complete!' -ForegroundColor Green
Write-Host '============================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Run start-jewelryflow.bat to start the app.'
Write-Host ''
Write-Host 'Default login (change immediately after first login):'
Write-Host '  Email:    owner@jewelryflow.test'
Write-Host '  Password: password123'
Write-Host ''
