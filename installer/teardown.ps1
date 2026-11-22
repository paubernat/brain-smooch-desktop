<#
.SYNOPSIS
    Desmontaje manual de Brain Smooch SIN la app (kit de recuperación del custodio).

.DESCRIPTION
    Para cuando el servicio no responde o no se tiene la contraseña de la app, pero sí la de
    Windows admin (BrainSmoochAdmin). Autónomo: no necesita el repo ni el servicio.

    Desde una sesión de BrainSmoochAdmin (o "Ejecutar como administrador" con sus credenciales):

        powershell -ExecutionPolicy Bypass -File teardown.ps1 -DryRun
        powershell -ExecutionPolicy Bypass -File teardown.ps1
        powershell -ExecutionPolicy Bypass -File teardown.ps1 -RestoreAdmin <tu_usuario>

    Quita, en este orden: watchdog (E3) -> servicio (E2) -> hosts (E6) -> Edge/Chrome (E5)
    -> Firefox policies.json (E4) -> C:\ProgramData\BrainSmooch (conserva data\ y policy\
    salvo -RemoveData). Las cuentas (E1) no se tocan, salvo -RestoreAdmin, que vuelve a meter
    a ese usuario en Administradores (BrainSmoochAdmin se queda: bórrala tú si quieres).
    Idempotente: se puede repetir.

.PARAMETER DryRun
    Solo muestra lo que haría.
.PARAMETER Yes
    No pide confirmación escrita (lo usa uninstall.ps1 tras validar la contraseña de la app).
.PARAMETER RemoveData
    Borra también data\ (etiquetas, cupo) y policy\.
.PARAMETER RestoreAdmin
    Usuario al que devolver los permisos de administrador.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Yes,
    [switch]$RemoveData,
    [string]$RestoreAdmin
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Join-Path $env:ProgramData 'BrainSmooch'
$ServiceName = 'BrainSmooch'
$TaskName = 'BrainSmoochWatchdog'
$ExtensionId = 'brain-smooch-desktop@local'
$FirefoxPolicies = Join-Path $env:ProgramFiles 'Mozilla Firefox\distribution\policies.json'
$FirefoxBackup = "$FirefoxPolicies.brainsmooch-backup"
$Hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$HostsBegin = '# BEGIN BrainSmooch'
$HostsEnd = '# END BrainSmooch'
$Chromium = @(
    @{ Key = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'; Values = @('InPrivateModeAvailability', 'DnsOverHttpsMode', 'BrowserGuestModeEnabled') },
    @{ Key = 'HKLM:\SOFTWARE\Policies\Google\Chrome'; Values = @('IncognitoModeAvailability', 'DnsOverHttpsMode', 'BrowserGuestModeEnabled') }
)
$SidAdministrators = 'S-1-5-32-544'
$Changes = 0

function Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Info([string]$Text) { Write-Host "   $Text" }
function Change([string]$Description, [scriptblock]$Action) {
    $script:Changes++
    if ($DryRun) { Write-Host "   [plan] $Description" -ForegroundColor DarkCyan; return }
    Write-Host "   ->  $Description"
    try { & $Action } catch { Write-Host "   !!  $($_.Exception.Message)" -ForegroundColor Yellow }
}

$isAdmin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host 'Brain Smooch - desmontaje manual (teardown)' -ForegroundColor Green
if ($DryRun) { Write-Host 'MODO ENSAYO (DRY RUN): no se cambia nada.' -ForegroundColor Yellow }
if (-not $isAdmin -and -not $DryRun) {
    Write-Host 'Hace falta una consola de administrador (BrainSmoochAdmin).' -ForegroundColor Red
    exit 1
}
if (-not $DryRun -and -not $Yes) {
    $answer = Read-Host 'Se quitarán todas las capas de Brain Smooch. Escribe DESMONTAR para continuar'
    if ($answer -cne 'DESMONTAR') { Write-Host 'Cancelado.'; exit 1 }
}

Step 'E3 watchdog'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Change "Parar y borrar la tarea programada $TaskName" {
        # Parar primero una ejecución en curso: podría reinstalar/arrancar el servicio que se
        # borra justo después.
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
} else { Info 'No existe.' }

Step 'E2 servicio'
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    Change "Parar y borrar el servicio $ServiceName" {
        # Si no para a tiempo, seguir igualmente: lo importante es borrar el registro del servicio.
        if ($service.Status -ne 'Stopped') {
            try { Stop-Service -Name $ServiceName -Force } catch { Write-Host "   !!  $($_.Exception.Message)" -ForegroundColor Yellow }
        }
        $winsw = Join-Path $Root 'winsw\BrainSmooch.exe'
        if (Test-Path $winsw) { & $winsw uninstall | Out-Null }
        if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { & sc.exe delete $ServiceName | Out-Null }
    }
} else { Info 'No existe.' }
# Todo $Root, no solo venv\: el python.exe del venv es un lanzador y el intérprete real
# (proceso hijo) se ejecuta desde $Root\python\. También WinSW (winsw\BrainSmooch.exe).
$rootPrefix = $Root.TrimEnd('\') + '\'
$leftovers = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($rootPrefix, 'OrdinalIgnoreCase') } catch { $false } })
if ($leftovers.Count -gt 0) {
    Change "Cerrar $($leftovers.Count) proceso(s) del servicio que siguen vivos en $Root" { $leftovers | Stop-Process -Force }
}

Step 'E6 hosts'
# Latin-1 lee y escribe cada byte tal cual: lo que está fuera del bloque no cambia (ASCII lo
# convertiría en '?').
$Latin1 = [Text.Encoding]::GetEncoding(28591)
$hostsText = if (Test-Path $Hosts) { [IO.File]::ReadAllText($Hosts, $Latin1) } else { '' }
if ($hostsText.Contains($HostsBegin)) {
    Change "Quitar el bloque $HostsBegin ... $HostsEnd" {
        # Igual que hosts.py: BEGIN..END entero; sin END, solo nuestras líneas tras BEGIN.
        $lines = @($hostsText -split "`r?`n")
        $out = New-Object System.Collections.Generic.List[string]
        $i = 0
        while ($i -lt $lines.Count) {
            if ($lines[$i].Trim().StartsWith($HostsBegin)) {
                $end = -1
                for ($j = $i + 1; $j -lt $lines.Count; $j++) { if ($lines[$j].Trim() -eq $HostsEnd) { $end = $j; break } }
                if ($end -ge 0) { $i = $end + 1 }
                else {
                    $i++
                    while ($i -lt $lines.Count -and $lines[$i].Trim() -match '^(0\.0\.0\.0|::)\s+\S+$') { $i++ }
                }
                continue
            }
            $out.Add($lines[$i])
            $i++
        }
        while ($out.Count -gt 0 -and $out[$out.Count - 1] -eq '') { $out.RemoveAt($out.Count - 1) }
        [IO.File]::WriteAllText($Hosts, (($out -join "`r`n") + "`r`n"), $Latin1)
        & ipconfig.exe /flushdns | Out-Null
    }
} else { Info 'Sin bloque BrainSmooch.' }

Step 'E5 Edge / Chrome'
foreach ($browser in $Chromium) {
    $blocklist = "$($browser.Key)\URLBlocklist"
    $touched = $false
    if (Test-Path $blocklist) {
        $touched = $true
        Change "Borrar $blocklist" { Remove-Item -Path $blocklist -Recurse -Force }
    }
    if (Test-Path $browser.Key) {
        $props = Get-ItemProperty -Path $browser.Key
        foreach ($name in $browser.Values) {
            if ($null -ne $props.PSObject.Properties[$name]) {
                $touched = $true
                Change "Borrar $($browser.Key)\$name" { Remove-ItemProperty -Path $browser.Key -Name $name -Force }
            }
        }
    }
    if ($touched) {
        Change "Borrar $($browser.Key) si quedó vacía" {
            $key = Get-Item -Path $browser.Key
            if ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0) { Remove-Item -Path $browser.Key -Force }
        }
    }
}

Step 'E4 Firefox'
if (Test-Path $FirefoxPolicies) {
    $content = Get-Content -Raw $FirefoxPolicies
    $ours = $content.Contains($ExtensionId) -or ($content.Contains('DisableDeveloperTools') -and $content.Contains('WebsiteFilter'))
    if ($ours -and (Test-Path $FirefoxBackup)) {
        Change 'Restaurar el policies.json anterior a Brain Smooch' { Move-Item -Force $FirefoxBackup $FirefoxPolicies }
    } elseif ($ours) {
        Change "Borrar $FirefoxPolicies" { Remove-Item -Force $FirefoxPolicies }
    } else { Info 'policies.json no es de Brain Smooch: se deja.' }
} elseif (Test-Path $FirefoxBackup) {
    # Sin policies.json pero con la copia del original: devolver el original.
    Change 'Restaurar el policies.json anterior a Brain Smooch' { Move-Item -Force $FirefoxBackup $FirefoxPolicies }
} else { Info 'No hay policies.json.' }

Step "Archivos en $Root"
if (Test-Path $Root) {
    $keep = if ($RemoveData) { @() } else { @('data', 'policy') }
    foreach ($item in Get-ChildItem -Force $Root) {
        if ($keep -contains $item.Name) { continue }
        Change "Borrar $($item.FullName)" { Remove-Item -Recurse -Force $item.FullName }
    }
    if ($RemoveData) {
        Change "Borrar $Root" { Remove-Item -Recurse -Force $Root }
    } else {
        Change "Permisos heredados en $Root (data\ y policy\ se conservan y vuelven a ser legibles)" {
            & icacls.exe $Root /reset /T /C /Q | Out-Null
        }
    }
} else { Info 'No existe.' }

Step 'E1 cuentas'
if ($RestoreAdmin) {
    Change "Volver a meter a $RestoreAdmin en Administradores" {
        $group = (New-Object Security.Principal.SecurityIdentifier $SidAdministrators).Translate([Security.Principal.NTAccount]).Value.Split('\')[-1]
        ([ADSI]"WinNT://$env:COMPUTERNAME/$group,group").Add("WinNT://$env:COMPUTERNAME/$RestoreAdmin,user")
    }
} else {
    Info 'No se tocan. Para volver a ser administrador: teardown.ps1 -RestoreAdmin <usuario>'
    Info '(o, como BrainSmoochAdmin: Configuración > Cuentas > Otros usuarios > Cambiar tipo de cuenta).'
}

Write-Host ''
if ($DryRun) { Write-Host "DRY RUN: $Changes cambio(s) planificado(s). No se ha cambiado nada." -ForegroundColor Yellow }
else { Write-Host 'Desmontaje terminado. Reinicia Firefox (y Edge/Chrome si los usas).' -ForegroundColor Green }
exit 0
