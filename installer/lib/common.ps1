# Funciones y constantes comunes de install.ps1 y uninstall.ps1 (se cargan con ". ").
# teardown.ps1 NO las usa: va en el kit de recuperación y tiene que funcionar solo.
#
# Todo cambio en el sistema pasa por Invoke-Change: en modo ensayo (-DryRun) solo se imprime.

Set-StrictMode -Version Latest

$script:BsRoot = Join-Path $env:ProgramData 'BrainSmooch'
$script:BsServiceName = 'BrainSmooch'
$script:BsTaskName = 'BrainSmoochWatchdog'
$script:BsAdminAccount = 'BrainSmoochAdmin'
$script:BsPort = 8765
$script:BsBaseUrl = "http://127.0.0.1:$script:BsPort"
$script:BsFirefoxDir = Join-Path $env:ProgramFiles 'Mozilla Firefox'
$script:BsExtensionId = 'brain-smooch-desktop@local'

# WinSW (envoltorio de servicio). Versión fijada; el binario NO se versiona en el repo.
# SHA256 calculado sobre la descarga de la release oficial v2.12.0 (WinSW-x64.exe):
#   https://github.com/winsw/winsw/releases/tag/v2.12.0
$script:BsWinSWVersion = 'v2.12.0'
$script:BsWinSWUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$script:BsWinSWSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

# SIDs conocidos (los nombres de grupo están traducidos: "Administradores", "Usuarios"...).
$script:SidSystem = 'S-1-5-18'
$script:SidAdministrators = 'S-1-5-32-544'
$script:SidUsers = 'S-1-5-32-545'

$script:BsDryRun = $false
$script:BsPlanCount = 0

function Write-Banner([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor DarkGreen
    Write-Host "  $Text" -ForegroundColor Green
    Write-Host ('=' * 72) -ForegroundColor DarkGreen
}

function Write-Step([string]$Number, [string]$Title) {
    Write-Host ''
    Write-Host "[$Number] $Title" -ForegroundColor Cyan
}

function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host "    XX  $Text" -ForegroundColor Red }

function Invoke-Change {
    <# Ejecuta un cambio en el sistema, o solo lo describe en modo ensayo. #>
    param(
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][scriptblock]$Action
    )
    $script:BsPlanCount++
    if ($script:BsDryRun) {
        Write-Host "    [plan] $Description" -ForegroundColor DarkCyan
        return
    }
    Write-Host "    ->  $Description"
    & $Action
}

function Invoke-Native {
    <# Ejecuta un programa externo y falla si el código de salida no es 0 (o no está en $Ok). #>
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int[]]$Ok = @(0)
    )
    & $FilePath @ArgumentList
    if ($Ok -notcontains $LASTEXITCODE) {
        throw "$FilePath $($ArgumentList -join ' ') terminó con código $LASTEXITCODE"
    }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin {
    if (Test-IsAdmin) { return }
    if ($script:BsDryRun) {
        Write-Warn 'No estás en una consola de administrador (en modo ensayo no hace falta).'
        return
    }
    Write-Fail 'Hace falta una consola de PowerShell "Ejecutar como administrador".'
    exit 1
}

function Confirm-Typed {
    <# Pide escribir una palabra exacta para continuar. En ensayo no pregunta. #>
    param([Parameter(Mandatory)][string]$Message, [Parameter(Mandatory)][string]$Word)
    if ($script:BsDryRun) { return }
    Write-Host ''
    Write-Host "    $Message" -ForegroundColor Yellow
    $answer = Read-Host "    Escribe $Word para continuar (cualquier otra cosa cancela)"
    if ($answer -cne $Word) {
        Write-Fail 'Cancelado. No se ha cambiado nada más.'
        exit 1
    }
}

function Get-GroupName([string]$Sid) {
    $account = (New-Object Security.Principal.SecurityIdentifier $Sid).Translate([Security.Principal.NTAccount])
    return $account.Value.Split('\')[-1]
}

function Get-GroupMemberNames([string]$Sid) {
    <# Miembros de un grupo local por SID, vía ADSI (Get-LocalGroupMember falla con SIDs huérfanos). #>
    $group = [ADSI]"WinNT://$env:COMPUTERNAME/$(Get-GroupName $Sid),group"
    $members = @($group.psbase.Invoke('Members'))
    return @($members | ForEach-Object { $_.GetType().InvokeMember('Name', 'GetProperty', $null, $_, $null) })
}

function Test-GroupMember([string]$Sid, [string]$User) {
    return @(Get-GroupMemberNames $Sid | Where-Object { $_ -ieq $User }).Count -gt 0
}

function Add-GroupMember([string]$Sid, [string]$User) {
    $group = [ADSI]"WinNT://$env:COMPUTERNAME/$(Get-GroupName $Sid),group"
    $group.Add("WinNT://$env:COMPUTERNAME/$User,user")
}

function Remove-GroupMember([string]$Sid, [string]$User) {
    $group = [ADSI]"WinNT://$env:COMPUTERNAME/$(Get-GroupName $Sid),group"
    $group.Remove("WinNT://$env:COMPUTERNAME/$User,user")
}

function Get-EnabledAdmins {
    <# Cuentas locales habilitadas que están en Administradores. #>
    $names = Get-GroupMemberNames $script:SidAdministrators
    return @($names | Where-Object {
            $user = Get-LocalUser -Name $_ -ErrorAction SilentlyContinue
            $null -ne $user -and $user.Enabled
        })
}

function Test-ServiceHealth([int]$TimeoutSec = 3) {
    try {
        $res = Invoke-RestMethod -Uri "$script:BsBaseUrl/health" -TimeoutSec $TimeoutSec -UseBasicParsing
        return $res.status -eq 'ok'
    } catch {
        return $false
    }
}

function Wait-ServiceHealth([int]$Seconds = 90) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-ServiceHealth) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function ConvertFrom-SecureText([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Show-Layers {
    <# Tabla de capas E1-E9 tal como las ve el servicio (GET /system/layers). #>
    try {
        $status = Invoke-RestMethod -Uri "$script:BsBaseUrl/system/layers" -TimeoutSec 15 -UseBasicParsing
    } catch {
        Write-Warn "No se pudo leer /system/layers: $($_.Exception.Message)"
        return
    }
    foreach ($layer in $status.layers) {
        $mark = switch ($layer.status) { 'ok' { 'OK ' } 'missing' { 'XX ' } 'pending' { '.. ' } default { 'ADM' } }
        $detail = if ($layer.detail) { " - $($layer.detail)" } else { '' }
        Write-Host ("    {0} {1} {2,-18}{3}" -f $mark, $layer.id, $layer.key, $detail)
    }
}
