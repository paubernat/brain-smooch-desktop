<#
.SYNOPSIS
    Desinstala Brain Smooch con la contraseña de la app (PLAN-FASE2 §6).

.DESCRIPTION
    Consola de administrador (BrainSmoochAdmin, o tu cuenta si aún es admin), con el servicio
    en marcha:

        powershell -ExecutionPolicy Bypass -File installer\uninstall.ps1 -DryRun
        powershell -ExecutionPolicy Bypass -File installer\uninstall.ps1

    1. Pide la contraseña de la app y abre una sesión de administrador en el servicio
       (POST /lock/login). Si es incorrecta, no se toca nada.
    2. Borra el watchdog (E3), para que no vuelva a arrancar nada.
    3. POST /system/uninstall: el servicio deja de reparar y retira sus capas en orden
       inverso (E6 hosts, E5 Edge/Chrome, E4 Firefox).
    4. teardown.ps1 -Yes: para y borra el servicio (E2), comprueba que no queda nada de
       E4-E6 y limpia C:\ProgramData\BrainSmooch (conserva data\ y policy\ salvo -RemoveData).
    5. Ofrece devolver tu cuenta a Administradores.

    Sin servicio o sin la contraseña de la app: usa teardown.ps1 (kit de recuperación).
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$script:BsDryRun = [bool]$DryRun

Write-Banner 'Brain Smooch - desinstalación'
if ($script:BsDryRun) { Write-Host '  MODO ENSAYO (DRY RUN): solo se muestra el plan, no se cambia nada.' -ForegroundColor Yellow }
Assert-Admin

Write-Step '1' 'Contraseña de la app'
if (-not (Test-ServiceHealth)) {
    if ($script:BsDryRun) {
        Write-Warn "El servicio no responde en ${BsBaseUrl}: la desinstalación real se detendría aquí."
    } else {
        Write-Fail "El servicio no responde en $BsBaseUrl. Usa teardown.ps1 (kit de recuperación)."
        exit 1
    }
}
$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$csrf = $null
if ($script:BsDryRun) {
    Write-Info '[plan] Pedir la contraseña y POST /lock/login'
} else {
    $status = Invoke-RestMethod -Uri "$BsBaseUrl/lock/status" -WebSession $web -UseBasicParsing
    if ($status.password_set) {
        $secure = Read-Host -AsSecureString '    Contraseña de la app (la del custodio)'
        $body = @{ password = (ConvertFrom-SecureText $secure) } | ConvertTo-Json -Compress
        try {
            $login = Invoke-RestMethod -Method Post -Uri "$BsBaseUrl/lock/login" -WebSession $web `
                -ContentType 'application/json' -Body $body -UseBasicParsing
        } catch {
            $body = $null
            Write-Fail "Inicio de sesión rechazado ($($_.Exception.Message)). No se ha cambiado nada."
            exit 1
        }
        $body = $null
        $csrf = $login.session.csrf
        Write-Ok 'Contraseña correcta.'
    } else {
        # El servicio rechaza /system/uninstall sin contraseña (409): no borrar nada a medias.
        Write-Fail "La app no tiene contraseña: créala en $BsBaseUrl/ o usa teardown.ps1. No se ha cambiado nada."
        exit 1
    }
    Confirm-Typed 'Se desinstalará Brain Smooch y se quitarán todas sus capas.' 'DESINSTALAR'
}

Write-Step '2' "Watchdog '$BsTaskName'  [E3]"
if (Get-ScheduledTask -TaskName $BsTaskName -ErrorAction SilentlyContinue) {
    Invoke-Change "Parar y borrar la tarea $BsTaskName" {
        # Parar una ejecución en curso: podría volver a arrancar el servicio.
        Stop-ScheduledTask -TaskName $BsTaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $BsTaskName -Confirm:$false
    }
} else { Write-Info 'No existe.' }

Write-Step '3' 'Retirar capas desde el servicio (E6 hosts, E5 Edge/Chrome, E4 Firefox)'
Invoke-Change 'POST /system/uninstall' {
    $headers = @{}
    if ($csrf) { $headers['X-CSRF-Token'] = $csrf }
    $result = Invoke-RestMethod -Method Post -Uri "$BsBaseUrl/system/uninstall" -WebSession $web `
        -Headers $headers -TimeoutSec 60 -UseBasicParsing
    Write-Ok "Capas retiradas: $($result.removed -join ', ')"
}

Write-Step '4' 'Servicio, restos y archivos (teardown.ps1)'
$teardown = Join-Path $PSScriptRoot 'teardown.ps1'
$teardownArgs = @{ Yes = $true; RemoveData = [bool]$RemoveData; DryRun = [bool]$DryRun }
& $teardown @teardownArgs
if ($LASTEXITCODE -ne 0) { Write-Fail 'teardown.ps1 terminó con errores.'; exit 1 }

Write-Step '5' 'Tu cuenta'
if (-not $script:BsDryRun) {
    $user = Read-Host '    ¿Devolver permisos de administrador a alguna cuenta? Escribe su nombre (vacío = no)'
    if ($user) {
        if (Test-GroupMember $SidAdministrators $user) { Write-Ok "$user ya es administradora." }
        else {
            Invoke-Change "Añadir $user a Administradores" { Add-GroupMember $SidAdministrators $user }
            Write-Ok "Cierra sesión y vuelve a entrar como $user."
        }
    }
    Write-Info "La cuenta $BsAdminAccount se conserva; bórrala desde Configuración > Cuentas si ya no la quieres."
}

Write-Host ''
if ($script:BsDryRun) { Write-Host '  DRY RUN: No se ha cambiado nada.' -ForegroundColor Yellow }
else { Write-Host '  Brain Smooch desinstalado.' -ForegroundColor Green }
exit 0
