[CmdletBinding()]
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -le 5) {
    $taskModules = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
    $env:PSModulePath = $taskModules + [System.IO.Path]::PathSeparator + $env:PSModulePath
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot 'dist' }
$taskManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskVersion = $taskManifest.version
if ($taskVersion -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') { throw 'manifest 版本无效。' }
# 将同一份共有代码编入主世界入口，避免 Chromium 按文件名去重内容脚本。
$taskRuntime = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'shared.js')) + "`n" + [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'engine.js'))
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'main-runtime.js'), $taskRuntime, (New-Object System.Text.UTF8Encoding($false)))
$taskNames = @('manifest.json', 'background.js', 'shared.js', 'main-runtime.js', 'bridge.js', 'options.html', 'options.css', 'options.js', 'README.md', 'CHANGELOG.md', 'PRIVACY.md', 'LICENSE')
$taskOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskZip = Join-Path $taskOutput "chinese-western-font-replacer-v$taskVersion.zip"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskStream = [System.IO.File]::Open($taskZip, [System.IO.FileMode]::Create)
$taskArchive = $null
try {
    $taskArchive = New-Object System.IO.Compression.ZipArchive($taskStream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    foreach ($taskName in $taskNames) {
        $taskSource = Join-Path $PSScriptRoot $taskName
        if (-not (Test-Path -LiteralPath $taskSource)) { throw "缺少发布文件：$taskName" }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive, $taskSource, $taskName.Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    if ($null -ne $taskArchive) { $taskArchive.Dispose() }
    $taskStream.Dispose()
}
$taskShell = New-Object -ComObject Shell.Application
$taskFolder = $taskShell.Namespace('shell:Downloads')
if ($null -eq $taskFolder) { throw '无法取得 Windows 下载目录。' }
$taskDownloads = [Environment]::ExpandEnvironmentVariables($taskFolder.Self.Path)
$taskDownloadZip = Join-Path $taskDownloads ([System.IO.Path]::GetFileName($taskZip))
Copy-Item -LiteralPath $taskZip -Destination $taskDownloadZip -Force
[pscustomobject]@{ version = $taskVersion; zip = $taskZip; downloadZip = $taskDownloadZip; sha256 = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json
