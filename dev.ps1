# dev.ps1 (Windows) — pipeline 1-clic para Melodify
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Tasks = @('dev'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Fuerza DEBUG local para servir /static sin collectstatic
$env:DJANGO_DEBUG = '1'
$env:PYTHONUTF8   = '1'

# ============================ Helpers ============================
function Get-HostPython {
  # Devuelve una lista [exe, args...] p.ej. @('py','-3.11') o @('python')
  $candidates = @(
    @('py','-3.11'),
    @('py','-3'),
    @('py'),
    @('python'),
    @('python3')
  )
  foreach ($c in $candidates) {
    try {
      $name = $c[0]
      if (Get-Command $name -ErrorAction SilentlyContinue) { return $c }
    } catch {}
  }
  throw "Python 3.11+ no encontrado. Instala Python y/o agrega 'py' o 'python' al PATH."
}

$VenvDir    = Join-Path $PSScriptRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip    = Join-Path $VenvDir "Scripts\pip.exe"

function Ensure-Venv {
  if (-not (Test-Path $VenvPython)) {
    $hostPy = Get-HostPython
    $exe = $hostPy[0]
    $args = @()
    if ($hostPy.Length -gt 1) { $args += $hostPy[1..($hostPy.Length-1)] }
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
  foreach ($d in $dirs) {
    $full = Join-Path $PSScriptRoot $d
    if (-not (Test-Path $full)) { New-Item -ItemType Directory -Force -Path $full | Out-Null }
  }
}

function Invoke-Py {
  param([Parameter(Mandatory)][string[]]$Args)
  & $VenvPython @Args
}

# ========================= Tareas núcleo =========================
function Setup {
  Ensure-Venv
  Write-Host "Instalando dependencias..."
  & $VenvPip install -r (Join-Path $PSScriptRoot "requirements.txt")
}

function MakeMigrations {
  Ensure-Venv
  # General (todas las apps); evita limitar a una sola
  Invoke-Py @("manage.py", "makemigrations")
}

function Migrate {
  Ensure-Venv
  Invoke-Py @("manage.py", "migrate")
}

function Merge-Migrations {
  Ensure-Venv
  Write-Host "Unificando migraciones si hay ramas en conflicto (makemigrations --merge)…"
  "y" | & $VenvPython "manage.py" "makemigrations" "--merge"
}

function ShowMigrations {
  Ensure-Venv
  Invoke-Py @("manage.py", "showmigrations")
}

# ====== Seed (usuarios base + demo) ======
function Ensure-Users {
  Ensure-Venv
  Invoke-Py @("manage.py", "ensure_initial_users")
}

function Seed-Demo {
  Ensure-Venv
  $root = "seeds\artists"   # ajusta si tu carpeta difiere
  $pass = "demo123"
  Invoke-Py @("manage.py", "seed_demo", "--root", $root, "--default-pass", $pass)
}

function Seed {
  Ensure-Users
  Seed-Demo
}

function Run {
  Ensure-Venv
  $port = if ($env:PORT) { $env:PORT } else { 8000 }
  Write-Host "Iniciando servidor en http://127.0.0.1:$port"
  Invoke-Py @("manage.py", "runserver", "127.0.0.1:$port")
}

function RunNet {
  Ensure-Venv
  $port = if ($env:PORT) { $env:PORT } else { 8000 }
  Write-Host "Iniciando servidor para la red (0.0.0.0:$port)"
  Invoke-Py @("manage.py", "runserver", "0.0.0.0:$port")
}

# =========================== Limpieza ============================
function Clean-Pyc {
  Write-Host "Borrando caches de Python..."
  Get-ChildItem -Path $PSScriptRoot -Recurse -Include *.pyc,*.pyo -File -ErrorAction SilentlyContinue | Remove-Item -Force
  Get-ChildItem -Path $PSScriptRoot -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
  Remove-Item -Force -Recurse "$PSScriptRoot\.pytest_cache","$PSScriptRoot\.ruff_cache" -ErrorAction SilentlyContinue
}

function Clean-Build {
  Write-Host "Borrando artefactos de build..."
  Remove-Item -Force -Recurse "$PSScriptRoot\build","$PSScriptRoot\dist" -ErrorAction SilentlyContinue
  Get-ChildItem $PSScriptRoot -Filter *.egg-info -Recurse -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}

function Clean-Media {
  Write-Host "Limpiando uploaded_media..."
  Ensure-Dirs
  Get-ChildItem "$PSScriptRoot\uploaded_media\uploaded_songs"   -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem "$PSScriptRoot\uploaded_media\uploaded_covers"  -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem "$PSScriptRoot\uploaded_media\uploaded_avatars" -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem "$PSScriptRoot\uploaded_media" -File -Force -ErrorAction SilentlyContinue | Remove-Item -Force
  Write-Host "Media limpia."
}

function Clean-Db {
  Write-Host "Eliminando base de datos SQLite..."
  Remove-Item -Force "$PSScriptRoot\melodifyDB.sqlite3" -ErrorAction SilentlyContinue
  Write-Host "Base de datos eliminada."
}

function Reset-Db {
  Clean-Db
  Migrate
  Write-Host "DB reseteada (migraciones aplicadas)."
}

function Clean {
  Clean-Pyc
  Clean-Build
  Write-Host "Limpieza basica completa."
}

function SuperClean {
  Clean
  Clean-Media
  Clean-Db
  Write-Host "Superclean completo."
}

# ======================= Tests / Coverage =======================
function Test-Unit {
  Ensure-Venv
  Invoke-Py @("manage.py","test","-v","2")
}

function Coverage {
  Ensure-Venv
  & $VenvPip install -U coverage
  Push-Location $PSScriptRoot
  try {
    & $VenvPython -m coverage run manage.py test inicio_sesion -v 2 --pattern="tests\test_*.py"
    & $VenvPython -m coverage run manage.py test -v 2
  } finally {
    Pop-Location
  }
}

# ======================== Mapa de tareas ========================
$TaskMap = @{
  'help'             = { Write-Host "Tareas: dev, setup, init-dirs, makemigrations, merge-migrations, migrate, ensure-users, seed-demo, seed, run, runnet, clean, clean-media, clean-db, reset-db, superclean, test, coverage, showmigrations" }
  'dev'              = { Setup; Ensure-Dirs; Merge-Migrations; MakeMigrations; Migrate; Seed; Run }
  'setup'            = { Setup }
  'init-dirs'        = { Ensure-Dirs }
  'makemigrations'   = { MakeMigrations }
  'merge-migrations' = { Merge-Migrations }
  'migrate'          = { Migrate }
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
  if ($TaskMap.ContainsKey($t)) {
    & $TaskMap[$t]
  } else {
    throw "Tarea desconocida: $t`nUsa: ./dev.ps1 help"
  }
}
