# Brain Smooch watchdog (E3). Runs as SYSTEM every minute, at boot and at logon.
# - Service missing -> reinstall it with WinSW.  - Not automatic -> set it back.
# - Not running     -> start it.
# The layers themselves (E4-E6) are restored by the service's integrity check (E9) every
# 60 s. Installed by install.ps1 in C:\ProgramData\BrainSmooch\installer\.

$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:ProgramData 'BrainSmooch'
$Name = 'BrainSmooch'
$WinSW = Join-Path $Root 'winsw\BrainSmooch.exe'
$Log = Join-Path $Root 'logs\watchdog.log'

function Write-Log([string]$Text) {
    try { Add-Content -Path $Log -Value "$(Get-Date -Format o) $Text" -Encoding ascii } catch { }
}

try {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        if (-not (Test-Path $WinSW)) { Write-Log 'service missing and WinSW not found'; exit 1 }
        Write-Log 'service missing: reinstalling'
        & $WinSW install | Out-Null
        $service = Get-Service -Name $Name
    }
    if ($service.StartType -ne 'Automatic') {
        Write-Log "start type was $($service.StartType): set to Automatic"
        Set-Service -Name $Name -StartupType Automatic
    }
    if ($service.Status -ne 'Running') {
        Write-Log "service was $($service.Status): starting"
        Start-Service -Name $Name
    }
} catch {
    Write-Log "error: $($_.Exception.Message)"
    exit 1
}
exit 0
