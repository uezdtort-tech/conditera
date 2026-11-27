[CmdletBinding()]
param(
    [ValidateSet("Config", "Up", "Status", "Health", "Logs", "Stop")]
    [string]$Mode = "Config",
    [switch]$ConfirmEmptyLegacyDatabases
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$deployScript = Join-Path $repositoryRoot "scripts/deploy-single-container.sh"

if (-not (Test-Path -LiteralPath $deployScript -PathType Leaf)) {
    throw "Не найден release-скрипт: $deployScript"
}

$bashCommand = Get-Command "bash.exe" -ErrorAction SilentlyContinue
if (-not $bashCommand) {
    $gitCommand = Get-Command "git.exe" -ErrorAction SilentlyContinue
    if ($gitCommand) {
        $gitRoot = Split-Path -Parent $gitCommand.Source
        $candidates = @(
            (Join-Path $gitRoot "bin/bash.exe"),
            (Join-Path $gitRoot "../bin/bash.exe"),
            (Join-Path $gitRoot "../usr/bin/bash.exe")
        )
        foreach ($candidate in $candidates) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $bashCommand = [pscustomobject]@{ Source = (Resolve-Path $candidate).Path }
                break
            }
        }
    }
}

if (-not $bashCommand) {
    throw "Git Bash не найден. Установите Git for Windows и повторите запуск."
}

if (-not (Get-Command "docker.exe" -ErrorAction SilentlyContinue)) {
    throw "Docker CLI не найден. Установите Docker Desktop for Windows."
}

$previousCutoverConfirmation = $env:CONDITERA_CONFIRM_LEGACY_DATABASES_EMPTY
if ($ConfirmEmptyLegacyDatabases) {
    $env:CONDITERA_CONFIRM_LEGACY_DATABASES_EMPTY = "1"
}

Push-Location $repositoryRoot
try {
    Write-Host "Conditera release mode: --$($Mode.ToLowerInvariant())"
    if ($ConfirmEmptyLegacyDatabases) {
        Write-Warning "Подтверждён переход на пустую PG17 БД. Старые volumes будут сохранены."
    }
    Write-Host "Repository: $repositoryRoot"
    & $bashCommand.Source $deployScript "--$($Mode.ToLowerInvariant())"
    $result = $LASTEXITCODE
    if ($result -ne 0) {
        throw "Release script завершился с кодом $result."
    }
}
finally {
    Pop-Location
    if ($null -eq $previousCutoverConfirmation) {
        Remove-Item Env:CONDITERA_CONFIRM_LEGACY_DATABASES_EMPTY -ErrorAction SilentlyContinue
    } else {
        $env:CONDITERA_CONFIRM_LEGACY_DATABASES_EMPTY = $previousCutoverConfirmation
    }
}
