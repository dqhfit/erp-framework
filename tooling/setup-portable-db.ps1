$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RootDir = Split-Path -Parent $PSScriptRoot
$PgDir = "C:\pg18"
$PgsqlDir = Join-Path $PgDir "pgsql"
$DataDir = Join-Path $PgDir "data"
$OriginalBackupFile = Join-Path $RootDir "tooling\backup-pull\backups\erp-db-20260618T023544Z.dump"
$BackupFile = Join-Path $PgDir "backup.dump"

New-Item -ItemType Directory -Force -Path $PgDir | Out-Null

# Copy backup file to ASCII path to prevent pg_restore unicode argument mangling
if (Test-Path $OriginalBackupFile) {
    Write-Host "Copying backup file to $BackupFile..."
    Copy-Item -Path $OriginalBackupFile -Destination $BackupFile -Force
}

# --- 1) Download PostgreSQL 18 ---
$PgZip = Join-Path $PgDir "postgresql.zip"
if (-not (Test-Path $PgZip)) {
    Write-Host "Downloading PostgreSQL 18 binaries..."
    curl.exe -fSL -o $PgZip "https://get.enterprisedb.com/postgresql/postgresql-18.0-1-windows-x64-binaries.zip"
}

# --- 2) Download pgvector ---
$VecZip = Join-Path $PgDir "pgvector.zip"
if (-not (Test-Path $VecZip)) {
    Write-Host "Downloading pgvector precompiled binaries..."
    curl.exe -fSL -o $VecZip "https://github.com/andreiramani/pgvector_pgsql_windows/releases/download/0.8.2_18.0.2/vector.v0.8.2-pg18.zip"
}

# --- 3) Unzip PostgreSQL ---
if (-not (Test-Path $PgsqlDir)) {
    Write-Host "Extracting PostgreSQL..."
    Expand-Archive -Path $PgZip -DestinationPath $PgDir -Force
}

# --- 4) Unzip pgvector and copy files ---
$VecExtractDir = Join-Path $PgDir "pgvector_temp"
if (-not (Test-Path (Join-Path $PgsqlDir "lib\vector.dll"))) {
    Write-Host "Extracting and installing pgvector..."
    New-Item -ItemType Directory -Force -Path $VecExtractDir | Out-Null
    Expand-Archive -Path $VecZip -DestinationPath $VecExtractDir -Force
    
    # Copy files from pgvector_temp\lib and pgvector_temp\share to pgsql\lib and pgsql\share
    Copy-Item -Path (Join-Path $VecExtractDir "lib\*") -Destination (Join-Path $PgsqlDir "lib") -Recurse -Force
    Copy-Item -Path (Join-Path $VecExtractDir "share\*") -Destination (Join-Path $PgsqlDir "share") -Recurse -Force
    
    Remove-Item -Path $VecExtractDir -Recurse -Force
}

# --- 5) Initialize Database Cluster ---
if (-not (Test-Path $DataDir)) {
    Write-Host "Initializing database cluster..."
    $InitdbPath = Join-Path $PgsqlDir "bin\initdb.exe"
    & $InitdbPath -D $DataDir -U postgres -A trust --locale=C --encoding=UTF8 --nosync
}

# --- 6) Start PostgreSQL ---
$PgCtlPath = Join-Path $PgsqlDir "bin\pg_ctl.exe"
$LogFile = Join-Path $PgDir "pg.log"

# Check if already running
$Running = $false
try {
    $Tcp = New-Object System.Net.Sockets.TcpClient
    $Tcp.Connect("127.0.0.1", 5432)
    $Running = $true
    $Tcp.Close()
    Write-Host "PostgreSQL is already running on port 5432."
} catch {
    # Port is free
}

if (-not $Running) {
    Write-Host "Starting PostgreSQL..."
    & $PgCtlPath -D $DataDir -l $LogFile start
    Start-Sleep -Seconds 5
}

# --- 7) Create Database erp_local ---
$CreatedbPath = Join-Path $PgsqlDir "bin\createdb.exe"
$DbExists = $false
try {
    & $PgsqlDir\bin\psql.exe -U postgres -h localhost -p 5432 -d erp_local -c "SELECT 1" 2>$null | Out-Null
    $DbExists = $true
    Write-Host "Database 'erp_local' already exists."
} catch {
    # Doesn't exist
}

if (-not $DbExists) {
    Write-Host "Creating database 'erp_local'..."
    & $CreatedbPath -U postgres -h localhost -p 5432 erp_local
}

# --- 8) Restore Backup ---
Write-Host "Restoring database backup..."
$PgRestorePath = Join-Path $PgsqlDir "bin\pg_restore.exe"
& $PgRestorePath --no-owner --no-acl -U postgres -h localhost -p 5432 -d erp_local $BackupFile

Write-Host "PORTABLE POSTGRES SETUP COMPLETED SUCCESSFULLY!"
