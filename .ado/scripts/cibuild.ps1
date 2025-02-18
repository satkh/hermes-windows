<#
.SYNOPSIS
    Build and prepare NuGet packages. Use it to run locally on in CI environment.
#>
param(
    [string]$SourcesPath = "$PSScriptRoot\..\..",
    [string]$WorkSpacePath = "$SourcesPath\workspace",
    [string]$OutputPath = "$WorkSpacePath\out",
    
    [ValidateSet("x64", "x86", "arm64", "arm64ec")]
    [String[]]$Platform = @("x64"),

    [ValidateSet("x64", "x86", "arm64")]
    [String]$ToolsPlatform = @("x86"), # Platform used for building tools when cross compiling
    
    [ValidateSet("debug", "release")]
    [String]$ToolsConfiguration = @("release"), # Platform used for building tools when cross compiling
    
    [ValidateSet("debug", "release")]
    [String[]]$Configuration = @("release"),
    
    [ValidateSet("win32", "uwp")]
    [String]$AppPlatform = "uwp",

    # Windows SDK Version. E.g. "10.0.17763.0"
    [String]$WindowsSDKVersion = "",

    # The NuGet package release version
    # e.g. "0.0.0-2209.28001-8af7870c" for pre-release or "0.70.2" for release
    [String]$ReleaseVersion = "0.0.0",

    # The version set in binary files.
    # e.g. "0.0.2209.28001" for pre-release or "0.70.2.0" for release
    [String]$FileVersion = "0.0.0.0",

    [switch]$RunTests,
    [switch]$IncrementalBuild,
    [switch]$ConfigureOnly,
    
    # Do not build binaries. Use it to split the build and prepare script steps.
    [switch]$NoBuild,

    # Do not run the prepare NuGet script. Use it to split the build and prepare script steps.
    [switch]$NoPack,

    # Do not build binaries and instead replace them with fake files.
    # Use it for faster debugging the rest of the code.
    [switch]$FakeBuild
)

function Invoke-Main() {
    $StartTime = (Get-Date)

    $SourcesPath = Resolve-Path $SourcesPath
    Invoke-EnsureDir $WorkSpacePath
    $WorkSpacePath = Resolve-Path $WorkSpacePath
    Invoke-EnsureDir $OutputPath
    $OutputPath = Resolve-Path $OutputPath

    Write-Host "cibuild is invoke with parameters:"
    Write-Host "         SourcesPath: $SourcesPath"
    Write-Host "       WorkSpacePath: $WorkSpacePath"
    Write-Host "          OutputPath: $OutputPath"
    Write-Host "         AppPlatform: $AppPlatform"
    Write-Host "            Platform: $Platform"
    Write-Host "       Configuration: $Configuration"
    Write-Host "       ToolsPlatform: $ToolsPlatform"
    Write-Host "  ToolsConfiguration: $ToolsConfiguration"
    Write-Host "   WindowsSDKVersion: $WindowsSDKVersion"
    Write-Host "      ReleaseVersion: $ReleaseVersion"
    Write-Host "         FileVersion: $FileVersion"
    Write-Host "            RunTests: $RunTests"
    Write-Host "    IncrementalBuild: $IncrementalBuild"
    Write-Host "       ConfigureOnly: $ConfigureOnly"
    Write-Host "             NoBuild: $NoBuild"
    Write-Host "              NoPack: $NoPack"
    Write-Host "           FakeBuild: $FakeBuild"
    Write-Host ""

    Invoke-RemoveUnusedFilesForComponentGovernance

    $vcvarsall_bat = Find-VS-Path

    Push-Location $WorkSpacePath
    try {
        Invoke-UpdateHermesVersion

        if (!$NoBuild) {
            # run the actual builds and copy artifacts
            foreach ($Plat in $Platform) {
                foreach ($Config in $Configuration) {
                    Invoke-BuildAndCopy -Platform $Plat -Configuration $Config
                }
            }
        }

        if (!$NoPack) {
          Invoke-CreateNugetPackage
        }
    } finally {
        Pop-Location
    }

    $elapsedTime = $(get-date) - $StartTime
    $totalTime = "{0:HH:mm:ss}" -f ([datetime]$elapsedTime.Ticks)
    Write-Host "Build took $totalTime to run"
    Write-Host ""
}

function Invoke-RemoveUnusedFilesForComponentGovernance() {
    Invoke-DeleteDir ".\unsupported\juno"
}

function Find-VS-Path() {
    $vsWhere = (Get-Command "vswhere.exe" -ErrorAction SilentlyContinue)
    if ($vsWhere) {
        $vsWhere = $vsWhere.Path
    } else {
        $vsWhere = "${Env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" 
    }

    if (Test-Path $vsWhere) {
        $versionJson = & $vsWhere -format json
        $versionJson = & $vsWhere -format json -version 17
        $versionJson = $versionJson | ConvertFrom-Json
    } else {
        $versionJson = @()
    }

    if ($versionJson.Length -gt 1) {
      Write-Warning "More than one VS install detected, picking the first one";
      $versionJson = $versionJson[0];
    }

    if ($versionJson.installationPath) {
        $vcVarsPath = "$($versionJson.installationPath)\VC\Auxiliary\Build\vcvarsall.bat"
        if (Test-Path $vcVarsPath) {
            return $vcVarsPath
        } else {
            throw "Could not find vcvarsall.bat at expected Visual Studio installation path: $vcVarsPath"
        }
    } else {
        throw "Could not find Visual Studio installation path"
    }
}

function Invoke-UpdateHermesVersion() {
    if ([String]::IsNullOrWhiteSpace($ReleaseVersion)) {
        return
    }

    $hermesVersion = $ReleaseVersion
    if ($ReleaseVersion.StartsWith("0.0.0")) {
        # Use file version as a project version for pre-release builds
        # because CMake does not accept our pre-release version format.
        $hermesVersion = $FileVersion
    }

    $filePath1 = Join-Path $SourcesPath "CMakeLists.txt"
    $versionRegex1 = "        VERSION .*"
    $versionStr1 = "        VERSION $hermesVersion"
    $content1 = (Get-Content $filePath1) -replace $versionRegex1, $versionStr1 -join "`r`n"
    [IO.File]::WriteAllText($filePath1, $content1)

    $filePath2 = Join-Path (Join-Path $SourcesPath "npm") "package.json"
    $versionRegex2 = "`"version`": `".*`","
    $versionStr2 = "`"version`": `"$ReleaseVersion`","
    $content2 = (Get-Content $filePath2) -replace $versionRegex2, $versionStr2 -join "`r`n"
    [IO.File]::WriteAllText($filePath2, $content2)

    Write-Host "Release version set to $ReleaseVersion"
    Write-Host "Hermes version set to $hermesVersion"
}

function Invoke-BuildAndCopy($Platform, $Configuration) {
    Write-Host "Invoke-BuildAndCopy is called with Platform: $Platform, Configuration: $Configuration"

    $triplet = "$AppPlatform-$Platform-$Configuration"
    $compilerAndToolsBuildPath = Join-Path $WorkSpacePath "build\tools"
    $compilerPath = Join-Path $compilerAndToolsBuildPath "bin\hermesc.exe"

    # Build compiler if it doesn't exist 
    # (TODO::To be precise, we need it only when building for uwp i.e. cross compilation !).
    if (!$FakeBuild -and !(Test-Path -Path $compilerPath) -and ($AppPlatform -eq "uwp")) {
        Invoke-Compiler-Build `
            -Platform $toolsPlatform `
            -Configuration $toolsConfiguration `
            -BuildPath $compilerAndToolsBuildPath
    }

    $buildPath = Join-Path $WorkSpacePath "build\$triplet"
    if (!$FakeBuild) {
      Invoke-Dll-Build -Platform $Platform `
          -Configuration $Configuration `
          -BuildPath $buildPath `
          -CompilerAndToolsBuildPath $compilerAndToolsBuildPath
    }

    $finalOutputPath = "$OutputPath\lib\native\$AppPlatform\$Configuration\$Platform";
    Invoke-EnsureDir $finalOutputPath

    if (!$FakeBuild) {
        Copy-Item "$buildPath\API\hermes_shared\hermes.dll" -Destination $finalOutputPath -force | Out-Null
        Copy-Item "$buildPath\API\hermes_shared\hermes.lib" -Destination $finalOutputPath -force | Out-Null
        Copy-Item "$buildPath\API\hermes_shared\hermes.pdb" -Destination $finalOutputPath -force | Out-Null
    } else {
        Copy-Item "$env:SystemRoot\system32\kernel32.dll" -Destination "$finalOutputPath\hermes.dll" -force | Out-Null
        New-Item -Path $finalOutputPath -Name "hermes.lib" -ItemType File -Force | Out-Null
        New-Item -Path $finalOutputPath -Name "hermes.pdb" -ItemType File -Force | Out-Null
    }

    $toolsPath = "$OutputPath\tools\native\$toolsConfiguration\$toolsPlatform"
    Invoke-EnsureDir $toolsPath
    if (!$FakeBuild) {
        Copy-Item "$compilerAndToolsBuildPath\bin\hermes.exe" -Destination $toolsPath | Out-Null
    } else {
        New-Item -Path $toolsPath -Name "hermes.exe" -ItemType File -Force | Out-Null
    }
}

function Invoke-CreateNugetPackage() {
    Invoke-EnsureDir "$OutputPath\lib\native\win32\release"
    Invoke-EnsureDir "$OutputPath\lib\native\uwp\release"

    Invoke-EnsureDir "$OutputPath\build\native\include\jsi"
    Copy-Item "$SourcesPath\API\jsi\jsi\*" `
        -Destination "$OutputPath\build\native\include\jsi" -Force -Recurse

    Invoke-EnsureDir "$OutputPath\build\native\include\node-api"
    Copy-Item "$SourcesPath\API\hermes_shared\node-api\js_native_api.h" `
        -Destination "$OutputPath\build\native\include\node-api" -Force
    Copy-Item "$SourcesPath\API\hermes_shared\node-api\js_native_api_types.h" `
        -Destination "$OutputPath\build\native\include\node-api" -Force
    Copy-Item "$SourcesPath\API\hermes_shared\node-api\js_runtime_api.h" `
        -Destination "$OutputPath\build\native\include\node-api" -Force

    Invoke-EnsureDir "$OutputPath\build\native\include\hermes"
    Copy-Item "$SourcesPath\API\hermes_shared\hermes_api.h" `
        -Destination "$OutputPath\build\native\include\hermes" -Force

    Invoke-EnsureDir "$OutputPath\license"
    Copy-Item "$SourcesPath\LICENSE" `
        -Destination "$OutputPath\license\" -Force
    Copy-Item "$SourcesPath\.ado\Nuget\NOTICE.txt" `
        -Destination "$OutputPath\license\" -Force
    Copy-Item "$SourcesPath\.ado\Nuget\Microsoft.JavaScript.Hermes.props" `
        -Destination "$OutputPath\build\native\" -Force
    Copy-Item "$SourcesPath\.ado\Nuget\Microsoft.JavaScript.Hermes.targets" `
        -Destination "$OutputPath\build\native\" -Force
    Copy-Item "$SourcesPath\.ado\Nuget\Microsoft.JavaScript.Hermes.nuspec" `
        -Destination "$OutputPath\" -Force

    # To make the package UWP compatible
    if (!(Test-Path -Path "$OutputPath\lib\uap\")) {
        New-Item -ItemType "directory" -Path "$OutputPath\lib\uap\" | Out-Null
        New-Item -Path "$OutputPath\lib\uap\" -Name "_._" -ItemType File
    }

    $pkgPath = Join-Path $OutputPath "pkg"
    Invoke-EnsureDir $pkgPath

    $packageVersion = $ReleaseVersion
    $repoUrl = "https://github.com/microsoft/hermes-windows"
    $repoBranch = ((git rev-parse --abbrev-ref HEAD) | Out-String).Trim()
    $repoCommit = ((git rev-parse HEAD) | Out-String).Trim()    
    $baseProperties = "nugetroot=$OutputPath"`
        + ";version=$packageVersion"`
        + ";repoUrl=$repoUrl"`
        + ";repoBranch=$repoBranch"`
        + ";repoCommit=$repoCommit"
    $packageProperties = $baseProperties`
        + ";fat_suffix="`
        + ";exclude_bin_files=**\*.pdb"
    $fatPackageProperties = $baseProperties`
        + ";fat_suffix=.Fat"`
        + ";exclude_bin_files=*.txt"

    $nugetPackBaseCmd = "nuget pack `"$OutputPath\Microsoft.JavaScript.Hermes.nuspec`""`
        + " -OutputDirectory `"$pkgPath`""`
        + " -NoDefaultExcludes"
    $nugetPackCmd = $nugetPackBaseCmd + " -Properties `"$packageProperties`""
    Write-Host "Run command: $nugetPackCmd"
    cmd /c $nugetPackCmd

    $fatNugetPackCmd = $nugetPackBaseCmd + " -Properties `"$fatPackageProperties`""
    Write-Host "Run command: $fatNugetPackCmd"
    cmd /c $fatNugetPackCmd
}

function Invoke-Compiler-Build($Platform, $Configuration, $BuildPath) {
    $genArgs = @();
    Get-CommonArgs -Platform $Platform -Configuration $Configuration -GenArgs ([ref]$genArgs)

    $targets = @("hermes","hermesc")

    Invoke-BuildImpl `
        -AppPlatform "win32" `
        -Platform $Platform `
        -Configuration $Configuration `
        -BuildPath $BuildPath `
        -GenArgs $genArgs `
        -Targets $targets
}

function Invoke-Dll-Build($Platform, $Configuration, $BuildPath, $CompilerAndToolsBuildPath) {
    $genArgs = @();
    Get-CommonArgs -Platform $Platform -Configuration $Configuration -GenArgs ([ref]$genArgs)

    $genArgs += "-DHERMES_ENABLE_DEBUGGER=ON"
    $genArgs += "-DHERMES_ENABLE_INTL=ON"

    if ($AppPlatform -eq "uwp") {
        # Link against default ICU libraries in Windows 10.
        $genArgs += "-DHERMES_MSVC_USE_PLATFORM_UNICODE_WINGLOB=OFF"
    } else {
        # Use our custom WinGlob/NLS based implementation of unicode stubs, to avoid depending on the runtime ICU library.
        $genArgs += "-DHERMES_MSVC_USE_PLATFORM_UNICODE_WINGLOB=ON"
    }

    if ($AppPlatform -eq "uwp") {
        $genArgs += "-DCMAKE_SYSTEM_NAME=WindowsStore"
        $genArgs += "-DCMAKE_SYSTEM_VERSION=`"10.0.17763.0`""
        $genArgs += "-DIMPORT_HERMESC=$CompilerAndToolsBuildPath\ImportHermesc.cmake"
    } elseif ($Platform -eq "arm64" -or $Platform -eq "arm64ec") {
        $genArgs += "-DHERMES_MSVC_ARM64=On"
        $genArgs += "-DIMPORT_HERMESC=$CompilerAndToolsBuildPath\ImportHermesc.cmake"
    }

    if ($Platform -eq "arm64ec") {
        $Env:CFLAGS = "-arm64EC"
        $Env:CXXFLAGS = "-arm64EC"
    }

    $targets = @("libshared");
    if ($RunTests) {
        $targets += "check-hermes"
    }

    Invoke-BuildImpl -AppPlatform $AppPlatform -Platform $Platform -Configuration $Configuration -BuildPath $BuildPath -GenArgs $genArgs -Targets $targets
}

function Invoke-BuildImpl($AppPlatform, $Platform, $Configuration, $BuildPath, $GenArgs, $Targets) {
    # Retain the build folder for incremental builds only.
    if (!$IncrementalBuild) {
        Invoke-DeleteDir $BuildPath
    }

    Invoke-EnsureDir $BuildPath
    Push-Location $BuildPath
    try {
        $genCall = ("cmake {0}" -f ($GenArgs -Join " ")) + " $SourcesPath"
        Write-Host "genCall: $genCall"

        $ninjaCall = ("ninja {0}" -f ($Targets -Join " "))
        Write-Host "ninjaCall: $ninjaCall"

        $setVCVars = "`"$vcvarsall_bat`" $(Get-VCVarsParam $AppPlatform $Platform)"
        $genCmd = "$setVCVars && $genCall 2>&1"
        Write-Host "Run command: $genCmd"
        cmd /c $GenCmd

        if ($ConfigureOnly) {
            Write-Host "Exit: configure only"
            exit 0;
        }

        $ninjaCmd = "$setVCVars && $ninjaCall 2>&1"
        Write-Host "Run command: $ninjaCmd"
        cmd /c $NinjaCmd
    } finally {
        Pop-Location
    }
}

function Get-CommonArgs($Platform, $Configuration, [ref]$GenArgs) {
    $GenArgs.Value += "-G Ninja"

    $cmakeConfiguration = Get-CMakeConfiguration $Configuration
    $GenArgs.Value += "-DCMAKE_BUILD_TYPE=$cmakeConfiguration"

    $GenArgs.Value += "-DHERMESVM_PLATFORM_LOGGING=On"

    if (![String]::IsNullOrWhiteSpace($FileVersion)) {
        $GenArgs.Value += "-DHERMES_FILE_VERSION=$FileVersion"
    }
}

function Get-CMakeConfiguration($config) {
    $cmakeConfig =  switch ($config) {
        "debug" {"FastDebug"}
        "release" {"Release"}
        default {"Debug"}
    }

    return $cmakeConfig;
}

function Get-VCVarsParam($AppPlatform, $Platform) {
    $vcVars = switch ($Platform)
    {
        "x64" {"x64"}
        "x86" {"x64_x86"}
        "arm64" {"x64_arm64"}
        "arm64ec" {"x64_arm64"}
        default { "x64" }
    }

    if ($AppPlatform -eq "uwp") {
        $vcVars = "$vcVars uwp"
    }

    if ($WindowsSDKVersion) {
        $vcVars = "$vcVars $WindowsSDKVersion"
    }

    # Spectre mitigations (for SDL)
    $vcVars = "$vcVars -vcvars_spectre_libs=spectre"

    return $vcVars
}

function Invoke-EnsureDir($Path) {
    if (!(Test-Path -Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Invoke-DeleteDir($Path) {
    if (Test-Path -Path $Path) {
        Remove-Item -Path $Path -Force -Recurse | Out-Null
    }
}

Invoke-Main
