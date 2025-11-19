# dev.ps1 — pipeline 1-clic
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Tasks = @('dev'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$env:DJANGO_DEBUG = '1'
$env:PYTHONUTF8   = '1'

function Get-HostPython {
  $candidates = @(@('py','-3.11'),@('py','-3'),@('py'),@('python'),@('python3'))
  foreach ($c in $candidates) { try { if (Get-Command $c[0] -ErrorAction SilentlyContinue) { return $c } } catch {} }
  throw "Python 3.11+ no encontrado."
}

$VenvDir    = Join-Path $PSScriptRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip    = Join-Path $VenvDir "Scripts\pip.exe"

function Ensure-Venv {
  if (-not (Test-Path $VenvPython)) {
    $hostPy = Get-HostPython; $exe = $hostPy[0]; $args = @(); if ($hostPy.Length -gt 1) { $args += $hostPy[1..($hostPy.Length-1)] }
    Write-Host "Creando venv (.venv) con: $($hostPy -join ' ')"
    & $exe @args -m venv $VenvDir
  }
  Write-Host "Actualizando pip..."
  & $VenvPython -m pip install --upgrade pip
}

function Ensure-Dirs {
  $dirs = @(
    "uploaded_media",
    "uploaded_media\uploaded_songs",
    "uploaded_media\uploaded_covers",
    "uploaded_media\uploaded_avatars",
    "static"
  )
  foreach ($d in $dirs) { $full = Join-Path $PSScriptRoot $d; if (-not (Test-Path $full)) { New-Item -ItemType Directory -Force -Path $full | Out-Null } }
}

function Invoke-Py { param([Parameter(Mandatory)][string[]]$Args) & $VenvPython @Args }

function Setup          { Ensure-Venv; Write-Host "Instalando dependencias..."; & $VenvPip install -r (Join-Path $PSScriptRoot "requirements.txt") }
function MakeMigrations { Ensure-Venv; Invoke-Py @("manage.py","makemigrations") }

function Migrate-Safe {
  Ensure-Venv
  Invoke-Py @("manage.py","migrate")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "migrate falló; aplicando fake de inicio_sesion 0018 y reintentando…"
    Invoke-Py @("manage.py","migrate","inicio_sesion","0018","--fake")
    Invoke-Py @("manage.py","migrate")
  }
}


function ShowMigrations { Ensure-Venv; Invoke-Py @("manage.py","showmigrations") }

# ===== seed =====
function Ensure-Users { Ensure-Venv; Invoke-Py @("manage.py","ensure_initial_users") }
function Seed-Demo {
  Ensure-Venv
  $root = "seeds\artists"
  $pass = "demo123"
  Invoke-Py @("manage.py","seed_demo","--root",$root,"--default-pass",$pass,"--replace-avatars","--replace-covers","--replace-audio")
}
function Seed { Ensure-Users; Seed-Demo }

function Run   { Ensure-Venv; $port = if ($env:PORT) { $env:PORT } else { 8000 }; Write-Host "Iniciando http://127.0.0.1:$port"; Invoke-Py @("manage.py","runserver","127.0.0.1:$port") }
function RunNet{ Ensure-Venv; $port = if ($env:PORT) { $env:PORT } else { 8000 }; Write-Host "Iniciando 0.0.0.0:$port"; Invoke-Py @("manage.py","runserver","0.0.0.0:$port") }

function Clean-Pyc   { Write-Host "Borrando caches…"; Get-ChildItem -Path $PSScriptRoot -Recurse -Include *.pyc,*.pyo -File -EA SilentlyContinue | Remove-Item -Force; Get-ChildItem -Path $PSScriptRoot -Recurse -Directory -Filter "__pycache__" -EA SilentlyContinue | Remove-Item -Recurse -Force; Remove-Item -Force -Recurse "$PSScriptRoot\.pytest_cache","$PSScriptRoot\.ruff_cache" -EA SilentlyContinue }
function Clean-Build { Write-Host "Borrando build…"; Remove-Item -Force -Recurse "$PSScriptRoot\build","$PSScriptRoot\dist" -EA SilentlyContinue; Get-ChildItem $PSScriptRoot -Filter *.egg-info -Recurse -Directory -EA SilentlyContinue | Remove-Item -Recurse -Force }
function Clean-Media { Write-Host "Limpiando uploaded_media…"; Ensure-Dirs; Get-ChildItem "$PSScriptRoot\uploaded_media\uploaded_songs" -Force -EA SilentlyContinue | Remove-Item -Recurse -Force -EA SilentlyContinue; Get-ChildItem "$PSScriptRoot\uploaded_media\uploaded_covers" -Force -EA SilentlyContinue | Remove-Item -Recurse -Force -EA SilentlyContinue; Get-ChildItem "$PSScriptRoot\uploaded_media\uploaded_avatars" -Force -EA SilentlyContinue | Remove-Item -Recurse -Force -EA SilentlyContinue; Get-ChildItem "$PSScriptRoot\uploaded_media" -File -Force -EA SilentlyContinue | Remove-Item -Force; Write-Host "Media limpia." }
function Clean-Db    { Write-Host "Eliminando SQLite…"; Remove-Item -Force "$PSScriptRoot\melodifyDB.sqlite3" -EA SilentlyContinue; Write-Host "DB eliminada." }
function Reset-Db    { Clean-Db; Migrate-Safe; Write-Host "DB reseteada." }
function Clean       { Clean-Pyc; Clean-Build; Write-Host "Limpieza básica OK." }
function SuperClean  { Clean; Clean-Media; Clean-Db; Write-Host "Superclean OK." }

function Test-Unit   { Ensure-Venv; Invoke-Py @("manage.py","test","-v","2") }
function Coverage    { Ensure-Venv; & $VenvPip install -U coverage; Push-Location $PSScriptRoot; try { & $VenvPython -m coverage run manage.py test -v 2; & $VenvPython -m coverage report -m } finally { Pop-Location } }

$TaskMap = @{
  'help'             = { Write-Host "Tareas: dev, setup, init-dirs, makemigrations, migrate-safe, ensure-users, seed-demo, seed, run, runnet, clean, clean-media, clean-db, reset-db, superclean, test, coverage, showmigrations" }
  'dev'              = { Setup; Ensure-Dirs; MakeMigrations; Migrate-Safe; Seed; Run }
  'setup'            = { Setup }
  'init-dirs'        = { Ensure-Dirs }
  'makemigrations'   = { MakeMigrations }
  'migrate-safe'     = { Migrate-Safe }
  'showmigrations'   = { ShowMigrations }
  'ensure-users'     = { Ensure-Users }
  'seed-demo'        = { Seed-Demo }
  'seed'             = { Seed }
  'run'              = { Run }
  'runnet'           = { RunNet }
  'clean'            = { Clean }
  'clean-media'      = { Clean-Media }
  'clean-db'         = { Clean-Db }
  'reset-db'         = { Reset-Db }
  'superclean'       = { SuperClean }
  'test'             = { Test-Unit }
  'coverage'         = { Coverage }
}

foreach ($t in $Tasks) {
  if ($TaskMap.ContainsKey($t)) { & $TaskMap[$t] } else { throw "Tarea desconocida: $t`nUsa: ./dev.ps1 help" }
}
