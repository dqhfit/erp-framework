<#
==========================================================
 backup-pull.ps1 — Keo backup TOAN BO du lieu ERP ve may OFFSITE (Windows).
 Chi can PowerShell 5.1+ (khong can Node/psql/quyen DB). Goi MCP backup
 tren server prod qua X-API-Key:
   - GET /mcp/backup/db      -> pg_dump custom-format (moi tenant)
   - GET /mcp/backup/uploads -> tar.gz file tai len
 Luu vao OutDir theo timestamp + xoay vong giu Keep ban moi nhat moi loai.
 Dung voi Task Scheduler (xem README.md). Exit != 0 neu loi.

 Cau hinh: dat bien moi truong, HOAC .env canh script (KEY=VALUE moi dong),
 HOAC tham so dong lenh:
   .\backup-pull.ps1 -ServerUrl https://erp.vfmgroup.vn -ApiKey sk_... -OutDir D:\erp-backups
==========================================================
#>
[CmdletBinding()]
param(
  [string]$ServerUrl = $env:SERVER_URL,
  [string]$ApiKey    = $env:API_KEY,
  [string]$OutDir    = $env:OUT_DIR,
  [int]   $Keep      = $(if ($env:KEEP) { [int]$env:KEEP } else { 14 }),
  [int]   $TimeoutSec= $(if ($env:TIMEOUT) { [int]$env:TIMEOUT } else { 1800 })
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Nap .env (KEY=VALUE) neu tham so/bien con thieu.
$EnvFile = if ($env:BACKUP_ENV) { $env:BACKUP_ENV } else { Join-Path $ScriptDir '.env' }
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $k = $Matches[1]; $v = $Matches[2].Trim('"').Trim("'")
      if ($k -eq 'SERVER_URL' -and -not $ServerUrl) { $ServerUrl = $v }
      elseif ($k -eq 'API_KEY' -and -not $ApiKey)   { $ApiKey = $v }
      elseif ($k -eq 'OUT_DIR' -and -not $OutDir)   { $OutDir = $v }
      elseif ($k -eq 'KEEP')    { $Keep = [int]$v }
      elseif ($k -eq 'TIMEOUT') { $TimeoutSec = [int]$v }
    }
  }
}

if (-not $ServerUrl) { throw 'Thieu SERVER_URL (vd https://erp.vfmgroup.vn)' }
if (-not $ApiKey)    { throw 'Thieu API_KEY (sk_... scope backup:full)' }
if (-not $OutDir)    { $OutDir = Join-Path $ScriptDir 'backups' }
$ServerUrl = $ServerUrl.TrimEnd('/')
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Ts = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
function Log($m) { Write-Host ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('s'), $m) }
$headers = @{ 'X-API-Key' = $ApiKey }
$fail = $false

# --- 0) Verify + log dung luong du kien (best-effort) ---
try {
  $body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"backup_info","arguments":{}}}'
  $info = Invoke-RestMethod -Uri "$ServerUrl/mcp/backup" -Method Post -Headers $headers `
    -ContentType 'application/json' -Body $body -TimeoutSec 60
  Log ("backup_info: " + ($info.result.content[0].text -replace '\s+', ' ').Substring(0, [Math]::Min(400, ($info.result.content[0].text).Length)))
} catch { Log "WARN: backup_info that bai (van tiep tuc tai)." }

function Download($path, $outFile, $minBytes) {
  # Khong dung -PassThru/StatusCode (kem on dinh tren PS 5.1): phan biet 204
  # (uploads rong) bang KICH THUOC file (body rong = 0 byte). Loi HTTP>=400 ->
  # Invoke-WebRequest nem exception.
  $tmp = "$outFile.part"
  try {
    Invoke-WebRequest -Uri "$ServerUrl$path" -Headers $headers -OutFile $tmp `
      -TimeoutSec $TimeoutSec -UseBasicParsing | Out-Null
  } catch {
    Log ("ERROR: tai $path that bai: " + $_.Exception.Message)
    Remove-Item $tmp -ErrorAction SilentlyContinue
    return $false
  }
  $sz = if (Test-Path $tmp) { (Get-Item $tmp).Length } else { 0 }
  if ($sz -gt $minBytes) {
    Move-Item -Force $tmp $outFile
    Log ("OK $([IO.Path]::GetFileName($outFile)): $sz byte")
    return $true
  }
  # File rong/qua nho: uploads (minBytes<=20) coi nhu 204 khong co file -> OK;
  # db (minBytes=100) rong = pg_dump loi -> that bai.
  Remove-Item $tmp -ErrorAction SilentlyContinue
  if ($minBytes -le 20) { Log "uploads: khong co file (rong) — bo qua."; return $true }
  Log "ERROR: $path tra ve $sz byte (<= $minBytes)."
  return $false
}

# --- 1) DB dump ---
Log "Tai DB dump..."
if (-not (Download '/mcp/backup/db' (Join-Path $OutDir "erp-db-$Ts.dump") 100)) { $fail = $true }

# --- 2) Uploads (204 = khong co file) ---
Log "Tai uploads..."
if (-not (Download '/mcp/backup/uploads' (Join-Path $OutDir "erp-uploads-$Ts.tar.gz") 20)) { $fail = $true }

# --- 3) Xoay vong: giu Keep ban moi nhat moi loai ---
function Rotate($pattern) {
  Get-ChildItem -Path $OutDir -Filter $pattern -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | ForEach-Object {
      Remove-Item $_.FullName -Force; Log "Xoay vong: xoa $($_.Name)"
    }
}
Rotate 'erp-db-*.dump'
Rotate 'erp-uploads-*.tar.gz'

if ($fail) { Log 'HOAN TAT VOI LOI.'; exit 1 }
Log 'HOAN TAT OK.'
