// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//
// Script to build Hermes for Windows.
// See the options and printHelp() below for the usage details.
//
// This script is intended to be run in the Azure DevOps pipeline
// or locally with Node.js.
// It enables the following features:
// 1. Clean the previous configuration and built files.
// 2. Configure CMake before the build.
// 3. Build binaries.
// 4. Run tests.
// 5. Create NuGet packages.
//

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("node:util");

// The root of the local Hermes repository.
const sourcesPath = path.resolve(__dirname, path.join("..", ".."));

// The command line options.
const options = {
  help: { type: "boolean", default: false },
  configure: { type: "boolean", default: false },
  build: { type: "boolean", default: true },
  test: { type: "boolean", default: false },
  pack: { type: "boolean", default: false },
  "clean-all": { type: "boolean", default: false },
  "clean-build": { type: "boolean", default: false },
  "clean-tools": { type: "boolean", default: false },
  "clean-pkg": { type: "boolean", default: false },
  "app-platform": {
    type: "string",
    default: "win32",
    validSet: ["win32", "uwp"],
  },
  platform: {
    type: "string",
    multiple: true,
    default: ["x64"],
    validSet: ["x64", "x86", "arm64", "arm64ec"],
  },
  configuration: {
    type: "string",
    multiple: true,
    default: ["release"],
    validSet: ["debug", "release"],
  },
  "output-path": {
    type: "string",
    default: path.join(sourcesPath, "out"),
  },
  "semantic-version": { type: "string", default: "0.0.0" },
  "file-version": { type: "string", default: "0.0.0.0" },
  "windows-sdk-version": { type: "string", default: "" },
  "fake-build": { type: "boolean", default: false },
};

// To access parsed args values, use args.<option-name>.
const { values: args } = parseArgs({ options, allowNegative: true });

// To be used in help message.
const scriptRelativePath = path.relative(process.cwd(), __filename);

if (args.help) {
  printHelp();
  process.exit(0);
}

function printHelp() {
  console.log(`Usage: node ${scriptRelativePath} [options]

Options:
  --help                  Show this help message and exit
  --configure             Configure CMake before the build (default: ${
    options.configure.default
  })
  --build                 Build binaries (default: ${options.build.default})
  --test                  Run tests (default: ${options.test.default})
  --pack                  Create NuGet packages (default: ${
    options.pack.default
  })
  --clean-all             Delete the whole output folder (default: ${
    options["clean-all"].default
  })
  --clean-build           Delete the build folder for the targeted configurations (default: ${
    options["clean-build"].default
  })
  --clean-tools           Delete the tools folder used for UWP and ARM64 builds (default: ${
    options["clean-tools"].default
  })
  --clean-pkg             Delete NuGet pkg and pkg-staging folders (default: ${
    options["clean-pkg"].default
  })
  --app-platform          Application platform (default: ${
    options["app-platform"].default
  }) [valid values: ${options["app-platform"].validSet.join(", ")}]
  --platform              Target platform(s) (default: ${options.platform.default.join(
    ", "
  )}) [valid values: ${options.platform.validSet.join(", ")}]
  --configuration         Build configuration(s) (default: ${options.configuration.default.join(
    ", "
  )}) [valid values: ${options.configuration.validSet.join(", ")}]
  --output-path           Path to the output directory (default: ${
    options["output-path"].default
  })
  --semantic-version      NuGet package semantic version (default: ${
    options["semantic-version"].default
  })
  --file-version          Version set in binary files (default: ${
    options["file-version"].default
  })
  --windows-sdk-version   Windows SDK version E.g. "10.0.19041.0" (default: ${
    options["windows-sdk-version"].default
  })
  --fake-build            Replace binaries with fake files for script debugging (default: ${
    options["fake-build"].default
  })
`);
}

// Convert all string arg values to lower case.
for (const [key, value] of Object.entries(args)) {
  if (typeof value === "string") {
    args[key] = value.toLowerCase();
  }
}

// Validate args values against the validSet.
for (const [key, value] of Object.entries(args)) {
  if (options[key]?.validSet) {
    const values = options[key].multiple ? value : [value];
    for (const item of values) {
      if (!options[key].validSet.includes(item)) {
        console.error(`Invalid value for ${key}: ${item}`);
        console.error(`Valid values are: ${options[key].validSet.join(", ")}`);
        process.exit(1);
      }
    }
  }
}

// Get the path to vcvarsall.bat.
// It is used to invoke CMake commands in the targeted MSVC context.
const vcVarsAllBat = getVCVarsAllBat();

main();

function main() {
  const startTime = new Date();

  ensureDir(args["output-path"]);
  args["output-path"] = path.resolve(args["output-path"]);

  console.log();
  console.log(`The ${scriptRelativePath} is invoked with parameters:`);
  console.log(`            clean-pkg: ${args["clean-pkg"]}`);
  console.log(`            configure: ${args.configure}`);
  console.log(`                build: ${args.build}`);
  console.log(`                 test: ${args.test}`);
  console.log(`                 pack: ${args.pack}`);
  console.log(`            clean-all: ${args["clean-all"]}`);
  console.log(`          clean-build: ${args["clean-build"]}`);
  console.log(`          clean-tools: ${args["clean-tools"]}`);
  console.log(`            clean-pkg: ${args["clean-pkg"]}`);
  console.log(`         app-platform: ${args["app-platform"]}`);
  console.log(`             platform: ${args.platform}`);
  console.log(`        configuration: ${args.configuration}`);
  console.log(`          output-path: ${args["output-path"]}`);
  console.log(`     semantic-version: ${args["semantic-version"]}`);
  console.log(`         file-version: ${args["file-version"]}`);
  console.log(`  windows-sdk-version: ${args["windows-sdk-version"]}`);
  console.log(`           fake-build: ${args["fake-build"]}`);
  console.log();

  removeUnusedFilesForComponentGovernance();

  updateHermesVersion();

  if (args["clean-all"]) {
    cleanAll();
  }

  const runParams = {
    isUwp: args["app-platform"] === "uwp",
    buildPath: path.join(args["output-path"], "build"),
    toolsPath: path.join(args["output-path"], "tools"),
    pkgStagingPath: path.join(args["output-path"], "pkg-staging"),
    pkgPath: path.join(args["output-path"], "pkg"),
  };

  if (args["clean-tools"]) {
    cleanTools(runParams);
  }

  if (args["clean-pkg"]) {
    cleanPkg(runParams);
  }

  const platforms = Array.isArray(args.platform)
    ? args.platform
    : [args.platform];
  const configurations = Array.isArray(args.configuration)
    ? args.configuration
    : [args.configuration];
  platforms.forEach((platform) => {
    configurations.forEach((configuration) => {
      const configParams = {
        ...runParams,
        platform,
        configuration,
      };
      const buildParams = {
        ...configParams,
        buildPath: getBuildPath(configParams),
        targets: runParams.isUwp ? "libshared" : "",
        onBuildCompleted: copyBuiltFilesToPkgStaging,
      };
      console.log(
        "Build for " +
          `IsUWP: ${buildParams.isUwp}, ` +
          `Platform: ${buildParams.platform}, ` +
          `Configuration: ${buildParams.configuration}, ` +
          `Build path: ${buildParams.buildPath}`
      );

      if (args["fake-build"]) {
        copyFakeFilesToPkgStaging(buildParams);
        return;
      }
      if (args["clean-build"]) {
        cleanBuild(buildParams);
      }
      if (args.configure) {
        cmakeConfigure(buildParams);
      }
      if (args.build) {
        cmakeBuild(buildParams);
      }
      if (args.test) {
        cmakeTest(buildParams);
      }
    });
  });

  if (args.pack) {
    packNuGet();
  }

  const elapsedTime = new Date() - startTime;
  const totalTime = new Date(elapsedTime).toISOString().substring(11, 19);
  console.log(`Build took ${totalTime} to run`);
  console.log();
}

function removeUnusedFilesForComponentGovernance() {
  if (args["file-version"].trim() === "0.0.0.0") {
    return;
  }
  deleteDir(path.join(sourcesPath, "unsupported", "juno"));
}

function updateHermesVersion() {
  if (!args["semantic-version"].trim()) {
    return;
  }
  if (args["file-version"].trim() === "0.0.0.0") {
    return;
  }

  let hermesVersion = args["semantic-version"];
  if (hermesVersion.startsWith("0.0.0")) {
    hermesVersion = args["file-version"];
  }

  const cmakeListsPath = path.join(args["sources-path"], "CMakeLists.txt");
  const cmakeContent = fs
    .readFileSync(cmakeListsPath, "utf8")
    .replace(/VERSION .*/, `VERSION ${hermesVersion}`);
  fs.writeFileSync(cmakeListsPath, cmakeContent);

  const packageJsonPath = path.join(
    args["sources-path"],
    "npm",
    "package.json"
  );
  const packageContent = fs
    .readFileSync(packageJsonPath, "utf8")
    .replace(/"version": ".*",/, `"version": "${args["semantic-version"]}",`);
  fs.writeFileSync(packageJsonPath, packageContent);

  console.log(`Semantic version set to ${args["semantic-version"]}`);
  console.log(`Hermes version set to ${hermesVersion}`);
}

function getBuildPath({ buildPath, platform, configuration }) {
  const triplet = `${args["app-platform"]}-${platform}-${configuration}`;
  return path.join(buildPath, triplet);
}

function cleanAll() {
  deleteDir(args["output-path"]);
}

function cleanTools(runParams) {
  deleteDir(buildParams.toolsPath);
}

function cleanBuild(buildParams) {
  deleteDir(buildParams.buildPath);
}

function cleanPkg(runParams) {
  deleteDir(runParams.pkgStagingPath);
  deleteDir(runParams.pkgPath);
}

function cmakeConfigure(buildParams) {
  const { isUwp, platform, configuration, toolsPath } = buildParams;

  cmakeBuildHermesCompiler(buildParams);

  const genArgs = ["-G Ninja"];

  const cmakeConfiguration =
    configuration === "release" ? "Release" : "FastDebug";
  genArgs.push(`-DCMAKE_BUILD_TYPE=${cmakeConfiguration}`);
  genArgs.push("-DHERMESVM_PLATFORM_LOGGING=ON");

  if (args["file-version"] && args["file-version"] !== "0.0.0.0") {
    genArgs.push(`-DHERMES_FILE_VERSION=${args["file-version"]}`);
  }

  genArgs.push("-DHERMES_ENABLE_DEBUGGER=ON");
  genArgs.push("-DHERMES_ENABLE_INTL=ON");

  genArgs.push(
    `-DHERMES_MSVC_USE_PLATFORM_UNICODE_WINGLOB=${isUwp ? "OFF" : "ON"}`
  );

  if (isUwp) {
    genArgs.push("-DCMAKE_SYSTEM_NAME=WindowsStore");
    genArgs.push(`-DCMAKE_SYSTEM_VERSION="${args["windows-sdk-version"]}"`);
    genArgs.push(
      `-DIMPORT_HERMESC=\"${path.join(toolsPath, "ImportHermesc.cmake")}\"`
    );
  } else if (platform === "arm64" || platform === "arm64ec") {
    genArgs.push("-DHERMES_MSVC_ARM64=ON");
    genArgs.push(
      `-DIMPORT_HERMESC=\"${path.join(toolsPath, "ImportHermesc.cmake")}\"`
    );
  }

  runCMakeCommand(`cmake ${genArgs.join(" ")} \"${sourcesPath}\"`, buildParams);
}

function cmakeBuild(buildParams) {
  const { buildPath, targets, onBuildCompleted } = buildParams;
  if (!fs.existsSync(buildPath)) {
    cmakeConfigure(buildParams);
  }

  cmakeBuildHermesCompiler(buildParams);

  const target = targets ? `--target ${targets}` : "";
  runCMakeCommand(`cmake --build . ${target}`, buildParams);

  if (onBuildCompleted) {
    onBuildCompleted(buildParams);
  }
}

function cmakeTest(buildParams) {
  if (buildParams.isUwp) {
    console.log("Skip testing for UWP");
    return;
  }

  if (!fs.existsSync(buildParams.buildPath)) {
    cmakeBuild(buildParams);
  }

  runCMakeCommand("ctest --output-on-failure", buildParams);
}

function cmakeBuildHermesCompiler(buildParams) {
  const { toolsPath, isUwp } = buildParams;
  if (!isUwp) {
    return;
  }

  const hermesCompilerPath = path.join(toolsPath, "bin", "hermesc.exe");
  if (!fs.existsSync(hermesCompilerPath)) {
    cmakeBuild({
      ...buildParams,
      isUwp: false,
      platform: "x64",
      configuration: "release",
      buildPath: toolsPath,
      targets: "hermesc",
      onBuildCompleted: undefined,
    });
  }
}

function runCMakeCommand(command, buildParams) {
  const { platform, buildPath } = buildParams;

  const savedCFlags = process.env.CFLAGS;
  const savedCXXFlags = process.env.CXXFLAGS;
  if (platform === "arm64ec") {
    process.env.CFLAGS = "-arm64EC";
    process.env.CXXFLAGS = "-arm64EC";
  }

  ensureDir(buildPath);
  const originalCwd = process.cwd();
  process.chdir(buildPath);
  try {
    const vsCommand =
      `"${vcVarsAllBat}" ${getVCVarsAllBatArgs(buildParams)}` +
      ` && ${command} 2>&1`;
    console.log(`Run command: ${vsCommand}`);
    execSync(vsCommand, { stdio: "inherit" });
  } finally {
    process.chdir(originalCwd);
    process.env.CFLAGS = savedCFlags;
    process.env.CXXFLAGS = savedCXXFlags;
  }
}

function copyBuiltFilesToPkgStaging(buildParams) {
  const { buildPath } = buildParams;
  const { dllStagingPath, toolsStagingPath } = ensureStagingPaths(buildParams);

  const dllSourcePath = path.join(buildPath, "API", "hermes_shared");
  copyFile("hermes.dll", dllSourcePath, dllStagingPath);
  copyFile("hermes.lib", dllSourcePath, dllStagingPath);
  copyFile("hermes.pdb", dllSourcePath, dllStagingPath);

  if (!buildParams.isUwp) {
    const toolsSourcePath = path.join(buildPath, "bin");
    copyFile("hermes.exe", toolsSourcePath, toolsStagingPath);
    copyFile("hermesc.exe", toolsSourcePath, toolsStagingPath);
  }
}

function copyFakeFilesToPkgStaging(buildParams) {
  const { dllStagingPath, toolsStagingPath } = ensureStagingPaths(buildParams);

  createFakeBinFile(dllStagingPath, "hermes.dll");
  createFakeBinFile(dllStagingPath, "hermes.lib");
  createFakeBinFile(dllStagingPath, "hermes.pdb");

  if (!buildParams.isUwp) {
    createFakeBinFile(toolsStagingPath, "hermes.exe");
    createFakeBinFile(toolsStagingPath, "hermesc.exe");
  }
}

function copyFile(fileName, sourcePath, targetPath) {
  fs.copyFileSync(
    path.join(sourcePath, fileName),
    path.join(targetPath, fileName)
  );
}

function createFakeBinFile(targetPath, fileName) {
  fs.copyFileSync(
    path.join(process.env.SystemRoot, "system32", "kernel32.dll"),
    path.join(targetPath, fileName)
  );
}

function ensureStagingPaths(buildParams) {
  const { platform, configuration } = buildParams;

  const dllStagingPath = path.join(
    buildParams.pkgStagingPath,
    "lib",
    "native",
    args["app-platform"],
    configuration,
    platform
  );
  ensureDir(dllStagingPath);

  const toolsStagingPath = path.join(
    buildParams.pkgStagingPath,
    "tools",
    "native",
    configuration,
    platform
  );
  ensureDir(toolsStagingPath);

  return { dllStagingPath, toolsStagingPath };
}

function packNuGet() {
  ensureDir(
    path.join(args["output-path"], "lib", "native", "win32", "release")
  );
  ensureDir(path.join(args["output-path"], "lib", "native", "uwp", "release"));

  ensureDir(
    path.join(args["output-path"], "build", "native", "include", "jsi")
  );
  fs.cpSync(
    path.join(args["sources-path"], "API", "jsi", "jsi"),
    path.join(args["output-path"], "build", "native", "include", "jsi"),
    { recursive: true }
  );

  ensureDir(
    path.join(args["output-path"], "build", "native", "include", "node-api")
  );
  fs.copyFileSync(
    path.join(
      sourcesPath,
      "API",
      "hermes_shared",
      "node-api",
      "js_native_api.h"
    ),
    path.join(
      args["output-path"],
      "build",
      "native",
      "include",
      "node-api",
      "js_native_api.h"
    )
  );
  fs.copyFileSync(
    path.join(
      sourcesPath,
      "API",
      "hermes_shared",
      "node-api",
      "js_native_api_types.h"
    ),
    path.join(
      args["output-path"],
      "build",
      "native",
      "include",
      "node-api",
      "js_native_api_types.h"
    )
  );
  fs.copyFileSync(
    path.join(
      sourcesPath,
      "API",
      "hermes_shared",
      "node-api",
      "js_runtime_api.h"
    ),
    path.join(
      args["output-path"],
      "build",
      "native",
      "include",
      "node-api",
      "js_runtime_api.h"
    )
  );

  ensureDir(
    path.join(args["output-path"], "build", "native", "include", "hermes")
  );
  fs.copyFileSync(
    path.join(args["sources-path"], "API", "hermes_shared", "hermes_api.h"),
    path.join(
      args["output-path"],
      "build",
      "native",
      "include",
      "hermes",
      "hermes_api.h"
    )
  );

  ensureDir(path.join(args["output-path"], "license"));
  fs.copyFileSync(
    path.join(args["sources-path"], "LICENSE"),
    path.join(args["output-path"], "license", "LICENSE")
  );
  fs.copyFileSync(
    path.join(args["sources-path"], ".ado", "Nuget", "NOTICE.txt"),
    path.join(args["output-path"], "license", "NOTICE.txt")
  );
  fs.copyFileSync(
    path.join(
      args["sources-path"],
      ".ado",
      "Nuget",
      "Microsoft.JavaScript.Hermes.props"
    ),
    path.join(
      args["output-path"],
      "build",
      "native",
      "Microsoft.JavaScript.Hermes.props"
    )
  );
  fs.copyFileSync(
    path.join(
      args["sources-path"],
      ".ado",
      "Nuget",
      "Microsoft.JavaScript.Hermes.targets"
    ),
    path.join(
      args["output-path"],
      "build",
      "native",
      "Microsoft.JavaScript.Hermes.targets"
    )
  );
  fs.copyFileSync(
    path.join(
      args["sources-path"],
      ".ado",
      "Nuget",
      "Microsoft.JavaScript.Hermes.nuspec"
    ),
    path.join(args["output-path"], "Microsoft.JavaScript.Hermes.nuspec")
  );

  if (!fs.existsSync(path.join(args["output-path"], "lib", "uap"))) {
    fs.mkdirSync(path.join(args["output-path"], "lib", "uap"));
    fs.writeFileSync(path.join(args["output-path"], "lib", "uap", "_._"), "");
  }

  const pkgPath = path.join(args["output-path"], "pkg");
  ensureDir(pkgPath);

  const packageVersion = args["release-version"];
  const repoUrl = "https://github.com/microsoft/hermes-windows";
  const repoBranch = execSync("git rev-parse --abbrev-ref HEAD")
    .toString()
    .trim();
  const repoCommit = execSync("git rev-parse HEAD").toString().trim();
  const baseProperties =
    `nugetroot=${args["output-path"]}` +
    `;version=${packageVersion}` +
    `;repoUrl=${repoUrl}` +
    `;repoBranch=${repoBranch}` +
    `;repoCommit=${repoCommit}`;
  const packageProperties = `${baseProperties};fat_suffix=;exclude_bin_files=**/*.pdb`;
  const fatPackageProperties = `${baseProperties};fat_suffix=.Fat;exclude_bin_files=*.txt`;

  const nugetPackBaseCmd = `nuget pack "${path.join(
    args["output-path"],
    "Microsoft.JavaScript.Hermes.nuspec"
  )}" -OutputDirectory "${pkgPath}" -NoDefaultExcludes`;
  const nugetPackCmd = `${nugetPackBaseCmd} -Properties "${packageProperties}"`;
  console.log(`Run command: ${nugetPackCmd}`);
  execSync(nugetPackCmd);

  const fatNugetPackCmd = `${nugetPackBaseCmd} -Properties "${fatPackageProperties}"`;
  console.log(`Run command: ${fatNugetPackCmd}`);
  execSync(fatNugetPackCmd);
}

function getVCVarsAllBat() {
  const vsWhere = path.join(
    process.env["ProgramFiles(x86)"] || process.env["ProgramFiles"],
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  if (!fs.existsSync(vsWhere)) {
    throw new Error("Could not find vswhere.exe");
  }

  const versionJson = JSON.parse(
    execSync(`"${vsWhere}" -format json -version 17`).toString()
  );
  if (versionJson.length > 1) {
    console.warn("More than one VS install detected, picking the first one");
  }

  const installationPath = versionJson[0].installationPath;
  const vcVarsAllBat = path.join(
    installationPath,
    "VC",
    "Auxiliary",
    "Build",
    "vcvarsall.bat"
  );
  if (!fs.existsSync(vcVarsAllBat)) {
    throw new Error(
      `Could not find vcvarsall.bat at expected Visual Studio installation path: ${vcVarsAllBat}`
    );
  }

  return vcVarsAllBat;
}

function getVCVarsAllBatArgs(buildParams) {
  const { platform, isUwp } = buildParams;
  let vcArgs = "";
  switch (platform) {
    case "x64":
      vcArgs += "x64";
      break;
    case "x86":
      vcArgs += "x64_x86";
      break;
    case "arm64":
    case "arm64ec":
      vcArgs += "x64_arm64";
      break;
    default:
      vcArgs += "x64";
  }

  if (isUwp) {
    vcArgs += " uwp";
  }

  if (args["windows-sdk-version"]) {
    vcArgs += ` ${args["windows-sdk-version"]}`;
  }

  vcArgs += " -vcvars_spectre_libs=spectre";

  return vcArgs;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function deleteDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}
