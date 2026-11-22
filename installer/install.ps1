<#
.SYNOPSIS
    Instala Brain Smooch como servicio de Windows con sus capas de bloqueo (PLAN-FASE2 §8).

.DESCRIPTION
    Ejecutar UNA vez en una consola de PowerShell "Ejecutar como administrador", desde la
    raíz del repo:

        powershell -ExecutionPolicy Bypass -File installer\install.ps1 -DryRun   # ensayo
        powershell -ExecutionPolicy Bypass -File installer\install.ps1           # instala
        powershell -ExecutionPolicy Bypass -File installer\install.ps1 -Accounts # cuentas (al final)

    Pasos (idempotentes: repetir el instalador actualiza código, XPI y servicio):
      1. Comprobaciones (solo lectura).
      2. C:\ProgramData\BrainSmooch\ con ACL (SYSTEM y Administradores control total,
         Usuarios solo lectura; secrets.env solo SYSTEM/Administradores).
      3. Copia del servicio, eval/, política, datos (si aún no existen) y XPI firmado.
      4. Entorno de Python (uv) dentro de ProgramData.
      5. Servicio de Windows con WinSW (LocalSystem, inicio automático, reinicio x3).  [E2]
      6. Watchdog: tarea programada SYSTEM cada minuto y al iniciar sesión.            [E3]
      7. Arranca el servicio, que aplica Firefox policies.json, Edge/Chrome y hosts    [E4-E6]
         y empieza el vigilante de navegadores y la comprobación de integridad.        [E7, E9]

    -Accounts hace SOLO el paso de cuentas (E1), aparte y con confirmaciones: crea
    BrainSmoochAdmin con la contraseña del custodio, VERIFICA que existe, es administradora
    y la contraseña funciona, y solo entonces quita tu cuenta de Administradores. Si algo
    falla, aborta sin tocar tu cuenta. Nunca deja el equipo sin administradores.

.PARAMETER DryRun
    Modo ensayo: muestra todo lo que haría sin cambiar nada (no necesita administrador).
.PARAMETER Soft
    Modo blando: sin cuentas y con el vigilante de navegadores solo observando (no cierra).
.PARAMETER Accounts
    Paso final de cuentas (E1). Requiere haber instalado antes sin -Accounts.
.PARAMETER DemoteUser
    Cuenta a pasar a estándar con -Accounts. Por defecto, el usuario con la sesión abierta.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Soft,
    [switch]$Accounts,
    [string]$DemoteUser
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$script:BsDryRun = [bool]$DryRun

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ServiceSrc = Join-Path $RepoRoot 'service'
$EvalSrc = Join-Path $RepoRoot 'eval'
$PolicySrc = Join-Path $RepoRoot 'policy'
$DataSrc = Join-Path $RepoRoot 'data'
$EnvSrc = Join-Path $RepoRoot '.env'
$ArtifactsDir = Join-Path $RepoRoot 'extension\web-ext-artifacts'
$WebBundle = Join-Path $ServiceSrc 'app\web\static\index.html'

$AppDir = Join-Path $BsRoot 'app'
$VenvDir = Join-Path $BsRoot 'venv'
$WinSWDir = Join-Path $BsRoot 'winsw'
$WinSWExe = Join-Path $WinSWDir 'BrainSmooch.exe'
$ExtDir = Join-Path $BsRoot 'extension'
$ScriptsDir = Join-Path $BsRoot 'installer'

# Claves que pasan del .env del repo a secrets.env (las de AMO se quedan en el repo).
$SecretKeys = @('YOUTUBE_API_KEY', 'LIQUID_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ADMIN_SESSION_S')

function Get-SignedXpi {
    if (-not (Test-Path $ArtifactsDir)) { return $null }
    return Get-ChildItem -Path $ArtifactsDir -Filter '*.xpi' -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

function Test-PortOwnedByOthers {
    <# ¿Hay algo escuchando en 8765 que no sea el servicio instalado (p. ej. `uv run python -m app`)? #>
    $listen = @(Get-NetTCPConnection -LocalPort $BsPort -State Listen -ErrorAction SilentlyContinue)
    if ($listen.Count -eq 0) { return $false }
    $service = Get-Service -Name $BsServiceName -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -eq 'Running') { return $false }
    return $true
}

# ------------------------------------------------------------------------------------------
function Invoke-Preflight {
    Write-Step '1' 'Comprobaciones (solo lectura)'
    Assert-Admin
    $problems = 0
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { Write-Fail 'Esto solo funciona en Windows.'; exit 1 }
    foreach ($path in @($ServiceSrc, $EvalSrc, (Join-Path $PolicySrc 'policy.yaml'))) {
        if (Test-Path $path) { Write-Ok $path } else { Write-Fail "Falta $path"; $problems++ }
    }
    if (Test-Path $WebBundle) { Write-Ok 'Web local construida (service\app\web\static)' }
    else { Write-Fail 'Falta la web local: cd extension; npm run build'; $problems++ }

    $xpi = Get-SignedXpi
    if ($xpi) { Write-Ok "XPI firmado: $($xpi.Name)" }
    else { Write-Fail 'No hay XPI firmado en extension\web-ext-artifacts: cd extension; npm run sign'; $problems++ }

    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) { Write-Ok "uv: $($uv.Source)" } else { Write-Fail 'No se encuentra uv en el PATH.'; $problems++ }

    if (Test-Path (Join-Path $BsFirefoxDir 'firefox.exe')) { Write-Ok "Firefox: $BsFirefoxDir" }
    else { Write-Warn "Firefox no está en ${BsFirefoxDir}: la capa E4 quedará pendiente." }

    if (Test-PortOwnedByOthers) {
        Write-Fail "El puerto $BsPort está ocupado (¿servicio de desarrollo 'uv run python -m app'?). Ciérralo antes."
        $problems++
    } else { Write-Ok "Puerto $BsPort libre o ya del servicio" }

    $service = Get-Service -Name $BsServiceName -ErrorAction SilentlyContinue
    if ($service) { Write-Info "El servicio ya existe ($($service.Status)): se actualizará." }

    if ($problems -gt 0) {
        if ($script:BsDryRun) { Write-Warn "$problems problema(s): la instalación real se detendría aquí." }
        else { Write-Fail "$problems problema(s). No se ha cambiado nada."; exit 1 }
    }
    return $xpi
}

function Invoke-Directories {
    Write-Step '2' "Carpeta $BsRoot y permisos"
    foreach ($dir in @($BsRoot, $AppDir, $ExtDir, (Join-Path $ExtDir 'pristine'), $WinSWDir, (Join-Path $BsRoot 'logs'), $ScriptsDir)) {
        if (-not (Test-Path $dir)) {
            Invoke-Change "Crear $dir" { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        }
    }
    Invoke-Change "ACL de $BsRoot : SYSTEM y Administradores control total, Usuarios solo lectura" {
        Invoke-Native icacls.exe @($BsRoot, '/inheritance:r', '/grant:r',
            "*$($SidSystem):(OI)(CI)F", "*$($SidAdministrators):(OI)(CI)F", "*$($SidUsers):(OI)(CI)RX", '/T', '/C', '/Q')
    }
}

function Invoke-CopyFiles([System.IO.FileInfo]$Xpi) {
    Write-Step '3' 'Código, política, datos y XPI'
    $robocopyOk = @(0, 1, 2, 3, 4, 5, 6, 7)
    $serviceDst = Join-Path $AppDir 'service'
    Invoke-Change "Copiar service\ -> $serviceDst (sin .venv, tests ni cachés)" {
        Invoke-Native robocopy.exe @($ServiceSrc, $serviceDst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
            '/XD', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache', 'tests') -Ok $robocopyOk
    }
    Invoke-Change "Copiar eval\ -> $(Join-Path $AppDir 'eval') (sin informes)" {
        Invoke-Native robocopy.exe @($EvalSrc, (Join-Path $AppDir 'eval'), '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
            '/XD', 'reports', '__pycache__') -Ok $robocopyOk
    }
    $policyDst = Join-Path $BsRoot 'policy'
    if (Test-Path (Join-Path $policyDst 'policy.yaml')) {
        Write-Info "La política ya existe en $policyDst : no se sobrescribe."
    } else {
        Invoke-Change "Copiar policy\ -> $policyDst" {
            Invoke-Native robocopy.exe @($PolicySrc, $policyDst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') -Ok $robocopyOk
        }
    }
    $dataDst = Join-Path $BsRoot 'data'
    if (Test-Path $dataDst) {
        Write-Info "Los datos ya existen en $dataDst : no se sobrescriben."
    } elseif (Test-Path $DataSrc) {
        Invoke-Change "Copiar data\ -> $dataDst (etiquetas, cupo, contraseña del candado)" {
            Invoke-Native robocopy.exe @($DataSrc, $dataDst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', 'firefox-profile') -Ok $robocopyOk
        }
    }
    if ($Xpi) {
        $installed = Join-Path $ExtDir 'brain-smooch.xpi'
        Invoke-Change "XPI firmado $($Xpi.Name) -> $installed (+ copia prístina y SHA256)" {
            Copy-Item -Force $Xpi.FullName $installed
            Copy-Item -Force $Xpi.FullName (Join-Path $ExtDir 'pristine\brain-smooch.xpi')
            $hash = (Get-FileHash -Algorithm SHA256 $installed).Hash.ToLowerInvariant()
            Set-Content -Encoding ascii -Path (Join-Path $ExtDir 'brain-smooch.xpi.sha256') -Value $hash
        }
    }
    $watchMode = if ($Soft) { 'observe' } else { 'enforce' }
    Invoke-Change "service.env: BS_BROWSER_WATCH=$watchMode" {
        Set-Content -Encoding ascii -Path (Join-Path $BsRoot 'service.env') -Value @(
            '# Escrito por install.ps1. Modo del vigilante de navegadores (E7): enforce | observe.',
            "BS_BROWSER_WATCH=$watchMode")
    }
    $secrets = Join-Path $BsRoot 'secrets.env'
    Invoke-Change "secrets.env con las claves de API del .env (sin mostrarlas; ACL solo SYSTEM/Administradores)" {
        $lines = @('# Escrito por install.ps1 a partir del .env del repo.')
        if (Test-Path $EnvSrc) {
            foreach ($line in Get-Content $EnvSrc) {
                $name = ($line -split '=', 2)[0].Trim()
                if ($SecretKeys -contains $name) { $lines += $line }
            }
        }
        Set-Content -Encoding ascii -Path $secrets -Value $lines
        Invoke-Native icacls.exe @($secrets, '/inheritance:r', '/grant:r', "*$($SidSystem):F", "*$($SidAdministrators):F", '/Q')
    }
}

function Invoke-PythonEnv {
    Write-Step '4' "Entorno de Python en $VenvDir (uv)"
    Invoke-Change 'uv sync --frozen --no-dev con Python gestionado dentro de ProgramData' {
        $env:UV_PYTHON_INSTALL_DIR = Join-Path $BsRoot 'python'
        $env:UV_PROJECT_ENVIRONMENT = $VenvDir
        $env:UV_CACHE_DIR = Join-Path $BsRoot 'cache\uv'
        Push-Location (Join-Path $AppDir 'service')
        try { Invoke-Native uv @('sync', '--frozen', '--no-dev', '--python-preference', 'only-managed') }
        finally { Pop-Location }
    }
}

function Invoke-Service {
    Write-Step '5' "Servicio de Windows '$BsServiceName' (WinSW $BsWinSWVersion, LocalSystem)  [E2]"
    $needsDownload = -not (Test-Path $WinSWExe) -or ((Get-FileHash -Algorithm SHA256 $WinSWExe).Hash -ne $BsWinSWSha256)
    if ($needsDownload) {
        Invoke-Change "Descargar WinSW $BsWinSWVersion y comprobar SHA256 $BsWinSWSha256" {
            $tmp = Join-Path $env:TEMP "WinSW-$([guid]::NewGuid()).exe"
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $BsWinSWUrl -OutFile $tmp -UseBasicParsing
            $hash = (Get-FileHash -Algorithm SHA256 $tmp).Hash
            if ($hash -ne $BsWinSWSha256) { Remove-Item $tmp -Force; throw "SHA256 de WinSW inesperado: $hash" }
            Move-Item -Force $tmp $WinSWExe
        }
    } else { Write-Ok 'WinSW ya descargado y verificado' }
    Invoke-Change 'Copiar winsw\BrainSmooch.xml' {
        Copy-Item -Force (Join-Path $PSScriptRoot 'winsw\BrainSmooch.xml') (Join-Path $WinSWDir 'BrainSmooch.xml')
    }
    $service = Get-Service -Name $BsServiceName -ErrorAction SilentlyContinue
    if ($service) {
        Invoke-Change 'Parar el servicio y actualizar su configuración (WinSW refresh)' {
            if ($service.Status -ne 'Stopped') { Stop-Service -Name $BsServiceName -Force }
            Invoke-Native $WinSWExe @('refresh')
        }
    } else {
        Invoke-Change 'Registrar el servicio (WinSW install: automático, reinicio x3 si falla)' {
            Invoke-Native $WinSWExe @('install')
        }
    }
}

function Invoke-Watchdog {
    Write-Step '6' "Watchdog: tarea programada '$BsTaskName' (SYSTEM, cada minuto y al iniciar sesión)  [E3]"
    $script = Join-Path $ScriptsDir 'watchdog.ps1'
    Invoke-Change "Copiar watchdog.ps1 -> $script" {
        Copy-Item -Force (Join-Path $PSScriptRoot 'watchdog\watchdog.ps1') $script
    }
    Invoke-Change "Registrar la tarea $BsTaskName desde watchdog\BrainSmoochWatchdog.xml" {
        $xml = (Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'watchdog\BrainSmoochWatchdog.xml')).Replace('__BS_ROOT__', $BsRoot)
        Register-ScheduledTask -TaskName $BsTaskName -Xml $xml -Force | Out-Null
    }
}

function Invoke-StartAndApply {
    Write-Step '7' 'Arrancar el servicio y aplicar las capas E4-E9 (las aplica el propio servicio como SYSTEM)'
    Write-Info '  E4 Firefox policies.json (extensión forzada, sin privado, sin DoH, sin about:config/devtools, webs bloqueadas)'
    Write-Info '  E5 Edge/Chrome en HKLM\SOFTWARE\Policies (YouTube y webs bloqueadas, sin InPrivate/incógnito, sin DoH)'
    Write-Info '  E6 hosts: bloque # BEGIN/END BrainSmooch con las webs bloqueadas'
    Write-Info "  E7 vigilante de navegadores: $(if ($Soft) { 'solo observa (modo blando)' } else { 'cierra navegadores no gestionados' })"
    Write-Info '  E9 integridad: comprueba y restaura cada 60 s'
    Invoke-Change 'Start-Service BrainSmooch y esperar a /health' {
        Start-Service -Name $BsServiceName
        if (-not (Wait-ServiceHealth 120)) { throw 'El servicio no responde en /health (mira C:\ProgramData\BrainSmooch\logs).' }
    }
    Invoke-Change 'POST /system/apply (endurecer: no pide contraseña)' {
        Invoke-RestMethod -Method Post -Uri "$BsBaseUrl/system/apply" -TimeoutSec 60 -UseBasicParsing | Out-Null
    }
    if (-not $script:BsDryRun) { Show-Layers }
}

# ------------------------------------------------------------------------------------------
function Resolve-DemoteUser {
    if ($DemoteUser) { return $DemoteUser }
    $console = (Get-CimInstance Win32_ComputerSystem).UserName
    if ($console) { return $console.Split('\')[-1] }
    return $env:USERNAME
}

function Test-AdminCredential([string]$User, [Security.SecureString]$Password) {
    <# Verifica la contraseña de dos formas: ValidateCredentials y un proceso de prueba (runas). #>
    Add-Type -AssemblyName System.DirectoryServices.AccountManagement
    $context = New-Object System.DirectoryServices.AccountManagement.PrincipalContext([System.DirectoryServices.AccountManagement.ContextType]::Machine)
    $plain = ConvertFrom-SecureText $Password
    try {
        if (-not $context.ValidateCredentials($User, $plain)) { return $false }
    } finally { $plain = $null; $context.Dispose() }
    $credential = New-Object Management.Automation.PSCredential("$env:COMPUTERNAME\$User", $Password)
    $proc = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList '/c', 'exit 0' `
        -Credential $credential -WorkingDirectory (Join-Path $env:SystemRoot 'System32') -WindowStyle Hidden -Wait -PassThru
    return $proc.ExitCode -eq 0
}

function Invoke-AccountsStep {
    Write-Step 'E1' "Cuentas: '$BsAdminAccount' administradora y tu cuenta como estándar"
    Assert-Admin
    $target = Resolve-DemoteUser
    Write-Info "Cuenta a pasar a estándar: $target"
    Write-Info "Plan: (a) crear/actualizar $BsAdminAccount con la contraseña del custodio y meterla en Administradores;"
    Write-Info '      (b) VERIFICAR que existe, está habilitada, es administradora y la contraseña funciona;'
    Write-Info "      (c) solo si (b) pasa: quitar a $target de Administradores (sigue en Usuarios)."
    if ($target -ieq $BsAdminAccount) { Write-Fail "No se puede degradar $BsAdminAccount."; exit 1 }
    if (-not $script:BsDryRun -and -not (Test-ServiceHealth)) {
        Write-Fail 'El servicio no responde: instala primero sin -Accounts y comprueba que todo funciona.'
        exit 1
    }
    if ($script:BsDryRun) {
        $script:BsPlanCount += 3
        Write-Host "    [plan] New-LocalUser/Set-LocalUser $BsAdminAccount + añadir a Administradores" -ForegroundColor DarkCyan
        Write-Host '    [plan] Verificar cuenta, grupo y credenciales (ValidateCredentials + proceso de prueba)' -ForegroundColor DarkCyan
        Write-Host "    [plan] Quitar $target de Administradores (con confirmación escrita)" -ForegroundColor DarkCyan
        return
    }

    Confirm-Typed "Se creará la cuenta $BsAdminAccount con la contraseña del CUSTODIO (la de Windows admin del kit)." 'CONFIRMO'
    $pw1 = Read-Host -AsSecureString "    Contraseña para $BsAdminAccount"
    $pw2 = Read-Host -AsSecureString '    Repítela'
    $plain1 = ConvertFrom-SecureText $pw1
    $plain2 = ConvertFrom-SecureText $pw2
    $same = $plain1 -ceq $plain2
    $longEnough = $plain1.Length -ge 8
    $plain1 = $null; $plain2 = $null
    if (-not $same) { Write-Fail 'Las contraseñas no coinciden. No se ha tocado ninguna cuenta.'; exit 1 }
    if (-not $longEnough) { Write-Fail 'Mínimo 8 caracteres. No se ha tocado ninguna cuenta.'; exit 1 }

    $existing = Get-LocalUser -Name $BsAdminAccount -ErrorAction SilentlyContinue
    if ($existing) {
        Invoke-Change "Actualizar la contraseña de $BsAdminAccount y habilitarla" {
            Set-LocalUser -Name $BsAdminAccount -Password $pw1 -PasswordNeverExpires $true
            Enable-LocalUser -Name $BsAdminAccount
        }
    } else {
        Invoke-Change "Crear $BsAdminAccount" {
            New-LocalUser -Name $BsAdminAccount -Password $pw1 -PasswordNeverExpires -AccountNeverExpires `
                -FullName 'Brain Smooch Admin' -Description 'Administrador del custodio (Brain Smooch)' | Out-Null
        }
    }
    if (-not (Test-GroupMember $SidAdministrators $BsAdminAccount)) {
        Invoke-Change "Añadir $BsAdminAccount a Administradores" { Add-GroupMember $SidAdministrators $BsAdminAccount }
    }

    Write-Step 'E1b' "Verificación de $BsAdminAccount (si algo falla, tu cuenta NO se toca)"
    $user = Get-LocalUser -Name $BsAdminAccount -ErrorAction SilentlyContinue
    $checks = [ordered]@{
        'La cuenta existe y está habilitada' = ($null -ne $user -and $user.Enabled)
        'Está en Administradores'            = (Test-GroupMember $SidAdministrators $BsAdminAccount)
        'La contraseña funciona (runas)'     = $false
    }
    try { $checks['La contraseña funciona (runas)'] = Test-AdminCredential $BsAdminAccount $pw1 }
    catch { Write-Warn "Prueba de credenciales: $($_.Exception.Message)" }
    $failed = 0
    foreach ($check in $checks.GetEnumerator()) {
        if ($check.Value) { Write-Ok $check.Key } else { Write-Fail $check.Key; $failed++ }
    }
    if ($failed -gt 0) {
        Write-Fail "Verificación fallida: se aborta. Tu cuenta '$target' sigue siendo administradora."
        exit 1
    }

    if (-not (Test-GroupMember $SidAdministrators $target)) {
        Write-Ok "$target ya no es administradora. Nada más que hacer."
        return
    }
    $others = @(Get-EnabledAdmins | Where-Object { $_ -ine $target })
    if ($others -notcontains $BsAdminAccount -or $others.Count -lt 1) {
        Write-Fail 'No quedaría ningún administrador habilitado. Se aborta sin tocar tu cuenta.'
        exit 1
    }
    Confirm-Typed "Ahora se quitará a '$target' de Administradores. Para volver a ser admin hará falta la contraseña de $BsAdminAccount." 'DEGRADAR'
    if (-not (Test-GroupMember $SidUsers $target)) {
        Invoke-Change "Añadir $target a Usuarios" { Add-GroupMember $SidUsers $target }
    }
    Invoke-Change "Quitar $target de Administradores" { Remove-GroupMember $SidAdministrators $target }

    if ((Test-GroupMember $SidAdministrators $BsAdminAccount) -and -not (Test-GroupMember $SidAdministrators $target)) {
        Write-Ok "Hecho. Cierra sesión y vuelve a entrar para que '$target' sea estándar."
        Write-Info "Deshacer (como $BsAdminAccount): installer\teardown.ps1 -RestoreAdmin $target"
    } else {
        Write-Fail 'Estado inesperado tras el cambio: revisa los Administradores con lusrmgr.msc.'
        exit 1
    }
}

# ------------------------------------------------------------------------------------------
$mode = if ($Accounts) { 'cuentas (E1)' } elseif ($Soft) { 'blando (sin cuentas, vigilante solo observa)' } else { 'completo' }
Write-Banner "Brain Smooch - instalador ($mode)"
if ($script:BsDryRun) { Write-Host '  MODO ENSAYO (DRY RUN): solo se muestra el plan, no se cambia nada.' -ForegroundColor Yellow }
if ($Accounts -and $Soft) { Write-Fail '-Accounts y -Soft no se combinan (el modo blando no toca cuentas).'; exit 1 }

if ($Accounts) {
    Invoke-AccountsStep
} else {
    $xpi = Invoke-Preflight
    if (-not $script:BsDryRun) {
        Confirm-Typed "Se instalará Brain Smooch en $BsRoot como servicio de Windows con sus capas de bloqueo." 'INSTALAR'
    }
    Invoke-Directories
    Invoke-CopyFiles $xpi
    Invoke-PythonEnv
    Invoke-Service
    Invoke-Watchdog
    Invoke-StartAndApply
}

Write-Host ''
if ($script:BsDryRun) {
    Write-Host "  DRY RUN: $script:BsPlanCount cambio(s) planificado(s). No se ha cambiado nada." -ForegroundColor Yellow
} elseif ($Accounts) {
    Write-Host '  Cuentas listas.' -ForegroundColor Green
} else {
    Write-Host '  Instalado. Abre http://127.0.0.1:8765/ -> panel "Capas".' -ForegroundColor Green
    if (-not $Soft) { Write-Host '  Último paso (cuando lo hayas probado): install.ps1 -Accounts' -ForegroundColor Green }
}
exit 0
