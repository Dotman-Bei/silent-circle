param(
    [switch]$DryRun,
    [string]$Distro = "Ubuntu"
)

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Convert-ToWslPath {
    param([string]$WindowsPath)

    $resolvedPath = [System.IO.Path]::GetFullPath($WindowsPath)
    if ($resolvedPath -notmatch '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
        throw "Cannot convert path to WSL format: $WindowsPath"
    }

    $drive = $Matches.drive.ToLowerInvariant()
    $rest = $Matches.rest -replace '\\', '/'
    return "/mnt/$drive/$rest"
}

function Write-Step {
    param([string]$Message)
    Write-Host "[setup-wsl] $Message"
}

function Invoke-Step {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$Arguments
    )

    Write-Step $Label
    Write-Host ("  " + $FilePath + " " + ($Arguments -join " "))

    if ($DryRun) {
        return
    }

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wslRepoRoot = Convert-ToWslPath -WindowsPath $repoRoot
$bootstrapScriptPath = "$wslRepoRoot/scripts/bootstrap-devnet-toolchain.sh"
$bootstrapScriptCommand = "bash '$bootstrapScriptPath'"

if (-not $DryRun -and -not (Test-IsAdministrator)) {
    throw "This script must be run from an elevated PowerShell session. Re-run as Administrator or use -DryRun to preview the steps."
}

Write-Step "Repository root: $repoRoot"
Write-Step "Target WSL distro: $Distro"

Invoke-Step -Label "Enable Windows Subsystem for Linux" -FilePath "dism.exe" -Arguments @("/online", "/enable-feature", "/featurename:Microsoft-Windows-Subsystem-Linux", "/all", "/norestart")
Invoke-Step -Label "Enable Virtual Machine Platform" -FilePath "dism.exe" -Arguments @("/online", "/enable-feature", "/featurename:VirtualMachinePlatform", "/all", "/norestart")
Invoke-Step -Label "Set WSL 2 as the default version" -FilePath "wsl.exe" -Arguments @("--set-default-version", "2")
Invoke-Step -Label "Install the requested WSL distro if needed" -FilePath "wsl.exe" -Arguments @("--install", "-d", $Distro)

Write-Host ""
Write-Step "Next step inside WSL after the distro is installed and opened:"
Write-Host ("  " + $bootstrapScriptCommand)
Write-Host ""
Write-Step "After the WSL bootstrap finishes, return to this repo and run:"
Write-Host "  npm run deploy:devnet:dry-run"
Write-Host "  npm run deploy:devnet"

if (-not $DryRun) {
    Write-Host ""
    Write-Step "A reboot or first-launch setup may be required by Windows before WSL commands are available."
}