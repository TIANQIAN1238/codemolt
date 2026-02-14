# codeblog installer for Windows — downloads pre-compiled binary, no dependencies needed
# Usage: irm https://codeblog.ai/install.ps1 | iex

$ErrorActionPreference = "Stop"

$InstallDir = if ($env:CODEBLOG_INSTALL_DIR) { $env:CODEBLOG_INSTALL_DIR } else { "$env:USERPROFILE\.local\bin" }
$BinName = "codeblog"
$NpmRegistry = "https://registry.npmjs.org"

function Write-Info($msg) { Write-Host "[codeblog] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[codeblog] $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "[codeblog] $msg" -ForegroundColor Red; exit 1 }

function Get-LatestVersion {
    $resp = Invoke-RestMethod -Uri "$NpmRegistry/codeblog-app/latest" -ErrorAction Stop
    return $resp.version
}

function Install-Binary {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower()
    if ($arch -eq "x64") { $arch = "x64" }
    elseif ($arch -eq "arm64") { $arch = "arm64" }
    else { Write-Err "Unsupported architecture: $arch" }

    $pkg = "codeblog-app-windows-$arch"

    Write-Info "Checking latest version..."
    $version = Get-LatestVersion
    if (-not $version) { Write-Err "Failed to fetch latest version" }
    Write-Info "Latest version: $version"

    Write-Info "Downloading $pkg@$version..."
    $url = "$NpmRegistry/$pkg/-/$pkg-$version.tgz"

    $tmpDir = Join-Path $env:TEMP "codeblog-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        $tgz = Join-Path $tmpDir "pkg.tgz"
        Invoke-WebRequest -Uri $url -OutFile $tgz -ErrorAction Stop

        Write-Info "Installing..."
        tar -xzf $tgz -C $tmpDir

        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Copy-Item -Force (Join-Path $tmpDir "package\bin\codeblog.exe") (Join-Path $InstallDir "$BinName.exe")

        Write-Ok "Installed codeblog v$version to $InstallDir\$BinName.exe"
    }
    finally {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
}

function Setup-Path {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -split ";" | Where-Object { $_ -eq $InstallDir }) { return }
    [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$currentPath", "User")
    $env:PATH = "$InstallDir;$env:PATH"
    Write-Info "Added $InstallDir to user PATH"
}

function Main {
    Write-Host ""
    Write-Host "  CodeBlog CLI Installer" -ForegroundColor Cyan
    Write-Host ""

    Write-Info "Platform: windows-$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower())"

    Install-Binary
    Setup-Path

    Write-Host ""
    Write-Ok "codeblog installed successfully!"
    Write-Host ""
    Write-Host "  Get started:" -ForegroundColor White
    Write-Host ""
    Write-Host "    codeblog             " -NoNewline -ForegroundColor Cyan; Write-Host "Launch interactive TUI"
    Write-Host "    codeblog --help      " -NoNewline -ForegroundColor Cyan; Write-Host "See all commands"
    Write-Host ""
    Write-Host "  Note: Restart your terminal for PATH changes to take effect." -ForegroundColor Yellow
    Write-Host ""
}

Main
