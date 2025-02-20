const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("node:util");

const sourcesPath = path.resolve(__dirname, path.join("..", ".."));

const options = {
  help: { type: "boolean", default: false },
  clean: { type: "boolean", default: false },
  configure: { type: "boolean", default: false },
  build: { type: "boolean", default: true },
  test: { type: "boolean", default: false },
  pack: { type: "boolean", default: false },
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

const { values: args } = parseArgs({ options, allowNegative: true });
const scriptRelativePath = path.relative(process.cwd(), __filename);
const vcVarsAllBat = getVCVarsAllBat();

if (args.help) {
  printHelp();
  process.exit(0);
}

function printHelp() {
  console.log(`Usage: node ${scriptRelativePath} [options]

Options:
  --help                  Show this help message and exit
  --clean                 Delete previous configuration and built files (default: ${
    options.clean.default
  })
  --configure             Configure CMake before the build (default: ${
    options.configure.default
  })
  --build                 Build binaries (default: ${options.build.default})
  --test                  Run tests (default: ${options.test.default})
  --pack                  Create NuGet packages (default: ${
    options.pack.default
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

main();

function main() {
  const startTime = new Date();

  ensureDir(args["output-path"]);
  args["output-path"] = path.resolve(args["output-path"]);

  console.log();
  console.log(`The ${scriptRelativePath} is invoked with parameters:`);
  console.log(`                clean: ${args.clean}`);
  console.log(`            configure: ${args.configure}`);
  console.log(`                build: ${args.build}`);
  console.log(`                 test: ${args.test}`);
  console.log(`                 pack: ${args.pack}`);
  console.log(`         app-platform: ${args["app-platform"]}`);
  console.log(`             platform: ${args.platform}`);
  console.log(`        configuration: ${args.configuration}`);
  console.log(`          output-path: ${args["output-path"]}`);
  console.log(`     semantic-version: ${args["semantic-version"]}`);
  console.log(`         file-version: ${args["file-version"]}`);
  console.log(`  windows-sdk-version: ${args["windows-sdk-version"]}`);
  console.log(`           fake-build: ${args["fake-build"]}`);
  console.log();

  //TODO: implement.
  //removeUnusedFilesForComponentGovernance();

  // updateHermesVersion();

  const runParams = {
    isUwp: args["app-platform"] === "uwp",
    buildPath: path.join(args["output-path"], "build"),
    toolsPath: path.join(args["output-path"], "tools"),
    pkgStagingPath: path.join(args["output-path"], "pkg-staging"),
    pkgPath: path.join(args["output-path"], "pkg"),
  };

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
        copyFakeFilesToStaging(buildParams);
        return;
      }
      if (args.clean) {
        cmakeClean(buildParams);
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
  // if (args.pack) {
  //   packFiles();
  // }

  const elapsedTime = new Date() - startTime;
  const totalTime = new Date(elapsedTime).toISOString().substring(11, 19);
  console.log(`Build took ${totalTime} to run`);
  console.log();
}

// function updateHermesVersion() {
//   if (!args["semantic-version"].trim()) {
//     return;
//   }
//   if (args["file-version"].trim() === "0.0.0.0") {
//     return;
//   }

//   let hermesVersion = args["semantic-version"];
//   if (hermesVersion.startsWith("0.0.0")) {
//     hermesVersion = args["file-version"];
//   }

//   const cmakeListsPath = path.join(args["sources-path"], "CMakeLists.txt");
//   const cmakeContent = fs
//     .readFileSync(cmakeListsPath, "utf8")
//     .replace(/VERSION .*/, `VERSION ${hermesVersion}`);
//   fs.writeFileSync(cmakeListsPath, cmakeContent);

//   const packageJsonPath = path.join(
//     args["sources-path"],
//     "npm",
//     "package.json"
//   );
//   const packageContent = fs
//     .readFileSync(packageJsonPath, "utf8")
//     .replace(/"version": ".*",/, `"version": "${args["semantic-version"]}",`);
//   fs.writeFileSync(packageJsonPath, packageContent);

//   console.log(`Semantic version set to ${args["semantic-version"]}`);
//   console.log(`Hermes version set to ${hermesVersion}`);
// }

function getBuildPath({ buildPath, platform, configuration }) {
  const triplet = `${args["app-platform"]}-${platform}-${configuration}`;
  return path.join(buildPath, triplet);
}

function cmakeClean(buildParams) {
  deleteDir(buildParams.buildPath);
  deleteDir(buildParams.pkgPath);
  deleteDir(buildParams.pkgStagingPath);
  deleteDir(buildParams.toolsPath);
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

function copyFakeFilesToStaging(buildParams) {
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
  ensureDir(buildParams.pkgStagingPath);

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

function copyBuiltFiles({ platform, configuration }) {
  console.log(
    `Build for Platform: ${platform}, Configuration: ${configuration}`
  );

  const triplet = `${args["app-platform"]}-${platform}-${configuration}`;
  const toolsBuildPath = path.join(args["output-path"], "build", "tools");
  const compilerPath = path.join(toolsBuildPath, "bin", "hermesc.exe");

  if (args["fake-build"]) {
    if (!fs.existsSync(compilerPath) && args["app-platform"] === "uwp") {
      buildHermesCompiler({
        platform: args["tools-platform"],
        configuration: args["tools-configuration"],
        toolsBuildPath,
      });
    }
  }

  const buildPath = path.join(args["output-path"], "build", triplet);
  if (!args["fake-build"]) {
    buildDll({
      platform,
      configuration,
      buildPath,
      toolsBuildPath,
    });
  }

  const finalOutputPath = path.join(
    args["output-path"],
    "lib",
    "native",
    args["app-platform"],
    configuration,
    platform
  );
  ensureDir(finalOutputPath);

  if (!args["fake-build"]) {
    fs.copyFileSync(
      path.join(buildPath, "API", "hermes_shared", "hermes.dll"),
      path.join(finalOutputPath, "hermes.dll")
    );
    fs.copyFileSync(
      path.join(buildPath, "API", "hermes_shared", "hermes.lib"),
      path.join(finalOutputPath, "hermes.lib")
    );
    fs.copyFileSync(
      path.join(buildPath, "API", "hermes_shared", "hermes.pdb"),
      path.join(finalOutputPath, "hermes.pdb")
    );
  } else {
    fs.copyFileSync(
      path.join(process.env.SystemRoot, "system32", "kernel32.dll"),
      path.join(finalOutputPath, "hermes.dll")
    );
    fs.writeFileSync(path.join(finalOutputPath, "hermes.lib"), "");
    fs.writeFileSync(path.join(finalOutputPath, "hermes.pdb"), "");
  }

  const toolsPath = path.join(
    args["output-path"],
    "tools",
    "native",
    args["tools-configuration"],
    args["tools-platform"]
  );
  ensureDir(toolsPath);
  if (!args["fake-build"]) {
    fs.copyFileSync(
      path.join(compilerAndToolsBuildPath, "bin", "hermes.exe"),
      path.join(toolsPath, "hermes.exe")
    );
  } else {
    fs.writeFileSync(path.join(toolsPath, "hermes.exe"), "");
  }
}

function createNugetPackage() {
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

function buildHermesCompiler(buildParams) {
  runBuild({
    ...buildParams,
    appPlatform: "win32",
    genArgs: getCommonArgs(buildParams),
    targets: ["hermes", "hermesc"],
  });
}

function runBuild(buildParams) {
  const { buildPath, genArgs, targets } = buildParams;

  if (!args["incremental-build"]) {
    deleteDir(buildPath);
  }

  ensureDir(buildPath);
  process.chdir(buildPath);

  try {
    const setVCVars = `"${getVCVarsAllBat()}" ${getVCVarsAllBatArgs(
      buildParams
    )}`;

    const genCmd =
      `${setVCVars} && ` +
      `cmake ${genArgs.join(" ")} ${args["sources-path"]} 2>&1`;
    console.log(`Run command: ${genCmd}`);
    execSync(genCmd, { stdio: "inherit" });

    if (args["configure-only"]) {
      console.log("Exit: configure only");
      process.exit(0);
    }

    const ninjaCmd = `${setVCVars} && ninja ${targets.join(" ")} 2>&1`;
    console.log(`Run command: ${ninjaCmd}`);
    execSync(ninjaCmd, { stdio: "inherit" });
  } finally {
    process.chdir(__dirname);
  }
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

/*
// Convert all string arg values to lower case.
for (const [key, value] of Object.entries(args)) {
  if (typeof value === "string") {
    args[key] = value.toLowerCase();
  }
}

// Validate args values against the validSet.
for (const [key, value] of Object.entries(args)) {
  if (options[key]?.validSet && !options[key].validSet.includes(value)) {
    console.error(`Invalid value for ${key}: ${value}`);
    console.error(`Valid values are: ${options[key].validSet.join(", ")}`);
    process.exit(1);
  }
}

main();

function main() {
  //   const startTime = new Date();

  //   args['sources-path'] = path.resolve(args['sources-path']);
  //   ensureDir(args['workspace-path']);
  //   args['workspace-path'] = path.resolve(args['workspace-path']);
  //   ensureDir(args['output-path']);
  //   args['output-path'] = path.resolve(args['output-path']);

  console.log(`${__filename} is invoked with parameters:`);
  console.log(`       sources-path: ${args["sources-path"]}`);
  console.log(`        output-path: ${args["output-path"]}`);
  console.log(`       app-platform: ${args["app-platform"]}`);
  console.log(`           platform: ${args.platform}`);
  console.log(`      configuration: ${args.configuration}`);
  console.log(`     tools-platform: ${args["tools-platform"]}`);
  console.log(`tools-configuration: ${args["tools-configuration"]}`);
  console.log(`   semantic-version: ${args["semantic-version"]}`);
  console.log(`       file-version: ${args["file-version"]}`);
  console.log(`windows-sdk-version: ${args["windows-sdk-version"]}`);
  console.log(`  incremental-build: ${args["incremental-build"]}`);
  console.log(`     configure-only: ${args["configure-only"]}`);
  console.log(`              build: ${args.build}`);
  console.log(`               test: ${args.test}`);
  console.log(`               pack: ${args.pack}`);
  console.log(`         fake-build: ${args["fake-build"]}`);
  console.log();

  //   // Invoke-RemoveUnusedFilesForComponentGovernance
  //   deleteDir(path.join(args.WorkSpacePath, "unsupported", "juno"));

  //   const vcvarsallBat = findVSPath();

  //   process.chdir(args.WorkSpacePath);
  //   try {
  //     updateHermesVersion();

  //     if (!args.NoBuild) {
  //       const platforms = Array.isArray(args.Platform)
  //         ? args.Platform
  //         : [args.Platform];
  //       const configurations = Array.isArray(args.Configuration)
  //         ? args.Configuration
  //         : [args.Configuration];
  //       platforms.forEach((platform) => {
  //         configurations.forEach((configuration) => {
  //           buildAndCopy(platform, configuration);
  //         });
  //       });
  //     }

  //     if (!args.NoPack) {
  //       createNugetPackage();
  //     }
  //   } finally {
  //     process.chdir(__dirname);
  //   }

  //   const elapsedTime = new Date() - startTime;
  //   const totalTime = new Date(elapsedTime).toISOString().substr(11, 8);
  //   console.log(`Build took ${totalTime} to run`);
  //   console.log("");
}


function findVSPath() {
  let vsWhere = path.join(
    process.env["ProgramFiles(x86)"] || process.env["ProgramFiles"],
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );
  if (!fs.existsSync(vsWhere)) {
    throw new Error("Could not find vswhere.exe");
  }

  const versionJson = JSON.parse(
    execSync(`${vsWhere} -format json -version 17`).toString()
  );
  if (versionJson.length > 1) {
    console.warn("More than one VS install detected, picking the first one");
  }

  const installationPath = versionJson[0].installationPath;
  const vcVarsPath = path.join(
    installationPath,
    "VC",
    "Auxiliary",
    "Build",
    "vcvarsall.bat"
  );
  if (!fs.existsSync(vcVarsPath)) {
    throw new Error(
      `Could not find vcvarsall.bat at expected Visual Studio installation path: ${vcVarsPath}`
    );
  }

  return vcVarsPath;
}

function updateHermesVersion() {
  if (!args.ReleaseVersion.trim()) {
    return;
  }

  let hermesVersion = args.ReleaseVersion;
  if (args.ReleaseVersion.startsWith("0.0.0")) {
    hermesVersion = args.FileVersion;
  }

  const cmakeListsPath = path.join(args.SourcesPath, "CMakeLists.txt");
  const cmakeContent = fs
    .readFileSync(cmakeListsPath, "utf8")
    .replace(/VERSION .* /, `VERSION ${hermesVersion}`);
  fs.writeFileSync(cmakeListsPath, cmakeContent);

  const packageJsonPath = path.join(args.SourcesPath, "npm", "package.json");
  const packageContent = fs
    .readFileSync(packageJsonPath, "utf8")
    .replace(/"version": ".*",/, `"version": "${args.ReleaseVersion}",`);
  fs.writeFileSync(packageJsonPath, packageContent);

  console.log(`Release version set to ${args.ReleaseVersion}`);
  console.log(`Hermes version set to ${hermesVersion}`);
}

function buildAndCopy(platform, configuration) {
  console.log(
    `Invoke-BuildAndCopy is called with Platform: ${platform}, Configuration: ${configuration}`
  );

  const triplet = `${args.AppPlatform}-${platform}-${configuration}`;
  const compilerAndToolsBuildPath = path.join(
    args.WorkSpacePath,
    "build",
    "tools"
  );
  const compilerPath = path.join(
    compilerAndToolsBuildPath,
    "bin",
    "hermesc.exe"
  );

  if (
    !args.FakeBuild &&
    !fs.existsSync(compilerPath) &&
    args.AppPlatform === "uwp"
  ) {
    // Invoke-Compiler-Build
  }

  const buildPath = path.join(args.WorkSpacePath, "build", triplet);
  if (!args.FakeBuild) {
    // Invoke-Dll-Build
  }

  const finalOutputPath = path.join(
    args.OutputPath,
    "lib",
    "native",
    args.AppPlatform,
    configuration,
    platform
  );
  ensureDir(finalOutputPath);

  if (!args.FakeBuild) {
    fs.copyFileSync(
      path.join(buildPath, "API", "hermes_shared", "hermes.dll"),
      path.join(finalOutputPath, "hermes.dll")
    );
    fs.copyFileSync(
      path.join(buildPath, "API", "hermes_shared", "hermes.lib"),
      path.join(finalOutputPath, "hermes.lib")
    );
    fs.copyFileSync(
      path.join(buildPath, "API", "hermes_shared", "hermes.pdb"),
      path.join(finalOutputPath, "hermes.pdb")
    );
  } else {
    fs.copyFileSync(
      path.join(process.env.SystemRoot, "system32", "kernel32.dll"),
      path.join(finalOutputPath, "hermes.dll")
    );
    fs.writeFileSync(path.join(finalOutputPath, "hermes.lib"), "");
    fs.writeFileSync(path.join(finalOutputPath, "hermes.pdb"), "");
  }

  const toolsPath = path.join(
    args.OutputPath,
    "tools",
    "native",
    args.ToolsConfiguration,
    args.ToolsPlatform
  );
  ensureDir(toolsPath);
  if (!args.FakeBuild) {
    fs.copyFileSync(
      path.join(compilerAndToolsBuildPath, "bin", "hermes.exe"),
      path.join(toolsPath, "hermes.exe")
    );
  } else {
    fs.writeFileSync(path.join(toolsPath, "hermes.exe"), "");
  }
}

function createNugetPackage() {
  ensureDir(path.join(args.OutputPath, "lib", "native", "win32", "release"));
  ensureDir(path.join(args.OutputPath, "lib", "native", "uwp", "release"));

  ensureDir(path.join(args.OutputPath, "build", "native", "include", "jsi"));
  fs.cpSync(
    path.join(args.SourcesPath, "API", "jsi", "jsi"),
    path.join(args.OutputPath, "build", "native", "include", "jsi"),
    { recursive: true }
  );

  ensureDir(
    path.join(args.OutputPath, "build", "native", "include", "node-api")
  );
  fs.copyFileSync(
    path.join(
      args.SourcesPath,
      "API",
      "hermes_shared",
      "node-api",
      "js_native_api.h"
    ),
    path.join(
      args.OutputPath,
      "build",
      "native",
      "include",
      "node-api",
      "js_native_api.h"
    )
  );
  fs.copyFileSync(
    path.join(
      args.SourcesPath,
      "API",
      "hermes_shared",
      "node-api",
      "js_native_api_types.h"
    ),
    path.join(
      args.OutputPath,
      "build",
      "native",
      "include",
      "node-api",
      "js_native_api_types.h"
    )
  );
  fs.copyFileSync(
    path.join(
      args.SourcesPath,
      "API",
      "hermes_shared",
      "node-api",
      "js_runtime_api.h"
    ),
    path.join(
      args.OutputPath,
      "build",
      "native",
      "include",
      "node-api",
      "js_runtime_api.h"
    )
  );

  ensureDir(path.join(args.OutputPath, "build", "native", "include", "hermes"));
  fs.copyFileSync(
    path.join(args.SourcesPath, "API", "hermes_shared", "hermes_api.h"),
    path.join(
      args.OutputPath,
      "build",
      "native",
      "include",
      "hermes",
      "hermes_api.h"
    )
  );

  ensureDir(path.join(args.OutputPath, "license"));
  fs.copyFileSync(
    path.join(args.SourcesPath, "LICENSE"),
    path.join(args.OutputPath, "license", "LICENSE")
  );
  fs.copyFileSync(
    path.join(args.SourcesPath, ".ado", "Nuget", "NOTICE.txt"),
    path.join(args.OutputPath, "license", "NOTICE.txt")
  );
  fs.copyFileSync(
    path.join(
      args.SourcesPath,
      ".ado",
      "Nuget",
      "Microsoft.JavaScript.Hermes.props"
    ),
    path.join(
      args.OutputPath,
      "build",
      "native",
      "Microsoft.JavaScript.Hermes.props"
    )
  );
  fs.copyFileSync(
    path.join(
      args.SourcesPath,
      ".ado",
      "Nuget",
      "Microsoft.JavaScript.Hermes.targets"
    ),
    path.join(
      args.OutputPath,
      "build",
      "native",
      "Microsoft.JavaScript.Hermes.targets"
    )
  );
  fs.copyFileSync(
    path.join(
      args.SourcesPath,
      ".ado",
      "Nuget",
      "Microsoft.JavaScript.Hermes.nuspec"
    ),
    path.join(args.OutputPath, "Microsoft.JavaScript.Hermes.nuspec")
  );

  if (!fs.existsSync(path.join(args.OutputPath, "lib", "uap"))) {
    fs.mkdirSync(path.join(args.OutputPath, "lib", "uap"));
    fs.writeFileSync(path.join(args.OutputPath, "lib", "uap", "_._"), "");
  }

  const pkgPath = path.join(args.OutputPath, "pkg");
  ensureDir(pkgPath);

  const packageVersion = args.ReleaseVersion;
  const repoUrl = "https://github.com/microsoft/hermes-windows";
  const repoBranch = execSync("git rev-parse --abbrev-ref HEAD")
    .toString()
    .trim();
  const repoCommit = execSync("git rev-parse HEAD").toString().trim();
  const baseProperties =
    `nugetroot=${args.OutputPath};` +
    `version=${packageVersion};` +
    `repoUrl=${repoUrl};` +
    `repoBranch=${repoBranch};` +
    `repoCommit=${repoCommit}`;
  const packageProperties = `${baseProperties};fat_suffix=;exclude_bin_files=** /*.pdb`;
  const fatPackageProperties = `${baseProperties};fat_suffix=.Fat;exclude_bin_files=*.txt`;

  const nugetPackBaseCmd = `nuget pack "${path.join(
    args.OutputPath,
    "Microsoft.JavaScript.Hermes.nuspec"
  )}" -OutputDirectory "${pkgPath}" -NoDefaultExcludes`;
  const nugetPackCmd = `${nugetPackBaseCmd} -Properties "${packageProperties}"`;
  console.log(`Run command: ${nugetPackCmd}`);
  execSync(nugetPackCmd);

  const fatNugetPackCmd = `${nugetPackBaseCmd} -Properties "${fatPackageProperties}"`;
  console.log(`Run command: ${fatNugetPackCmd}`);
  execSync(fatNugetPackCmd);
}

function invokeCompilerBuild(platform, configuration, buildPath) {
  const genArgs = getCommonArgs(platform, configuration);

  const targets = ["hermes", "hermesc"];

  invokeBuildImpl({
    appPlatform: "win32",
    platform,
    configuration,
    buildPath,
    genArgs,
    targets,
  });
}

function getCommonArgs(platform, configuration) {
  const genArgs = ["-G Ninja"];
  const cmakeConfiguration = getCMakeConfiguration(configuration);
  genArgs.push(`-DCMAKE_BUILD_TYPE=${cmakeConfiguration}`);
  genArgs.push("-DHERMESVM_PLATFORM_LOGGING=On");

  if (args.FileVersion) {
    genArgs.push(`-DHERMES_FILE_VERSION=${args.FileVersion}`);
  }

  return genArgs;
}

function getCMakeConfiguration(config) {
  switch (config) {
    case "debug":
      return "FastDebug";
    case "release":
      return "Release";
    default:
      return "Debug";
  }
}

function invokeBuildImpl({
  appPlatform,
  platform,
  configuration,
  buildPath,
  genArgs,
  targets,
}) {
  if (!args.IncrementalBuild) {
    deleteDir(buildPath);
  }

  ensureDir(buildPath);
  process.chdir(buildPath);

  try {
    const genCall = `cmake ${genArgs.join(" ")} ${args.SourcesPath}`;
    console.log(`genCall: ${genCall}`);

    const ninjaCall = `ninja ${targets.join(" ")}`;
    console.log(`ninjaCall: ${ninjaCall}`);

    const setVCVars = `"${vcvarsallBat}" ${getVCVarsParam(
      appPlatform,
      platform
    )}`;
    const genCmd = `${setVCVars} && ${genCall} 2>&1`;
    console.log(`Run command: ${genCmd}`);
    execSync(genCmd, { stdio: "inherit" });

    if (args.ConfigureOnly) {
      console.log("Exit: configure only");
      process.exit(0);
    }

    const ninjaCmd = `${setVCVars} && ${ninjaCall} 2>&1`;
    console.log(`Run command: ${ninjaCmd}`);
    execSync(ninjaCmd, { stdio: "inherit" });
  } finally {
    process.chdir(__dirname);
  }
}

function getVCVarsParam(appPlatform, platform) {
  let vcVars;
  switch (platform) {
    case "x64":
      vcVars = "x64";
      break;
    case "x86":
      vcVars = "x64_x86";
      break;
    case "arm64":
    case "arm64ec":
      vcVars = "x64_arm64";
      break;
    default:
      vcVars = "x64";
  }

  if (appPlatform === "uwp") {
    vcVars += " uwp";
  }

  if (args.WindowsSDKVersion) {
    vcVars += ` ${args.WindowsSDKVersion}`;
  }

  // Spectre mitigations (for SDL)
  vcVars += " -vcvars_spectre_libs=spectre";

  return vcVars;
}

function invokeDllBuild(
  platform,
  configuration,
  buildPath,
  compilerAndToolsBuildPath
) {
  const genArgs = getCommonArgs(platform, configuration);

  genArgs.push("-DHERMES_ENABLE_DEBUGGER=ON");
  genArgs.push("-DHERMES_ENABLE_INTL=ON");

  if (args.AppPlatform === "uwp") {
    // Link against default ICU libraries in Windows 10.
    genArgs.push("-DHERMES_MSVC_USE_PLATFORM_UNICODE_WINGLOB=OFF");
  } else {
    // Use our custom WinGlob/NLS based implementation of unicode stubs, to
    // avoid depending on the runtime ICU library.
    genArgs.push("-DHERMES_MSVC_USE_PLATFORM_UNICODE_WINGLOB=ON");
  }

  if (args.AppPlatform === "uwp") {
    genArgs.push("-DCMAKE_SYSTEM_NAME=WindowsStore");
    genArgs.push(`-DCMAKE_SYSTEM_VERSION="${args.WindowsSDKVersion}"`);
    genArgs.push(
      `-DIMPORT_HERMESC=${compilerAndToolsBuildPath}\\ImportHermesc.cmake`
    );
  } else if (platform === "arm64" || platform === "arm64ec") {
    genArgs.push("-DHERMES_MSVC_ARM64=On");
    genArgs.push(
      `-DIMPORT_HERMESC=${compilerAndToolsBuildPath}\\ImportHermesc.cmake`
    );
  }

  if (platform === "arm64ec") {
    process.env.CFLAGS = "-arm64EC";
    process.env.CXXFLAGS = "-arm64EC";
  }

  const targets = ["libshared"];
  if (args.RunTests) {
    targets.push("check-hermes");
  }

  invokeBuildImpl({
    appPlatform: args.AppPlatform,
    platform,
    configuration,
    buildPath,
    genArgs,
    targets,
  });
}

function getCommonArgs(platform, configuration) {
  const genArgs = ["-G Ninja"];
  const cmakeConfiguration = getCMakeConfiguration(configuration);
  genArgs.push(`-DCMAKE_BUILD_TYPE=${cmakeConfiguration}`);
  genArgs.push("-DHERMESVM_PLATFORM_LOGGING=On");

  if (args.FileVersion) {
    genArgs.push(`-DHERMES_FILE_VERSION=${args.FileVersion}`);
  }

  return genArgs;
}

function getCMakeConfiguration(config) {
  switch (config) {
    case "debug":
      return "FastDebug";
    case "release":
      return "Release";
    default:
      return "Debug";
  }
}

function invokeBuildImpl({
  appPlatform,
  platform,
  configuration,
  buildPath,
  genArgs,
  targets,
}) {
  if (!args.IncrementalBuild) {
    deleteDir(buildPath);
  }

  ensureDir(buildPath);
  process.chdir(buildPath);

  try {
    const genCall = `cmake ${genArgs.join(" ")} ${args.SourcesPath}`;
    console.log(`genCall: ${genCall}`);

    const ninjaCall = `ninja ${targets.join(" ")}`;
    console.log(`ninjaCall: ${ninjaCall}`);

    const setVCVars = `"${vcvarsallBat}" ${getVCVarsParam(
      appPlatform,
      platform
    )}`;
    const genCmd = `${setVCVars} && ${genCall} 2>&1`;
    console.log(`Run command: ${genCmd}`);
    execSync(genCmd, { stdio: "inherit" });

    if (args.ConfigureOnly) {
      console.log("Exit: configure only");
      process.exit(0);
    }

    const ninjaCmd = `${setVCVars} && ${ninjaCall} 2>&1`;
    console.log(`Run command: ${ninjaCmd}`);
    execSync(ninjaCmd, { stdio: "inherit" });
  } finally {
    process.chdir(__dirname);
  }
}

function getVCVarsParam(appPlatform, platform) {
  let vcVars;
  switch (platform) {
    case "x64":
      vcVars = "x64";
      break;
    case "x86":
      vcVars = "x64_x86";
      break;
    case "arm64":
    case "arm64ec":
      vcVars = "x64_arm64";
      break;
    default:
      vcVars = "x64";
  }

  if (appPlatform === "uwp") {
    vcVars += " uwp";
  }

  if (args.WindowsSDKVersion) {
    vcVars += ` ${args.WindowsSDKVersion}`;
  }

  // Spectre mitigations (for SDL)
  vcVars += " -vcvars_spectre_libs=spectre";

  return vcVars;
}
*/

/*
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('node:util');

const options = {
    'sources-path': { type: 'string', default: path.resolve(__dirname, '../../..') },
    'workspace-path': { type: 'string', default: path.resolve(__dirname, '../../../workspace') },
    'output-path': { type: 'string', default: path.resolve(__dirname, '../../../workspace/out') },
    platform: { type: 'string', multiple: true, default: ['x64'] },
    'tools-platform': { type: 'string', default: 'x86' },
    'tools-configuration': { type: 'string', default: 'release' },
    configuration: { type: 'string', multiple: true, default: ['release'] },
    'app-platform': { type: 'string', default: 'uwp' },
    'windows-sdk-version': { type: 'string', default: '' },
    'release-version': { type: 'string', default: '0.0.0' },
    'file-version': { type: 'string', default: '0.0.0.0' },
    'run-tests': { type: 'boolean', default: false },
    'incremental-build': { type: 'boolean', default: false },
    'configure-only': { type: 'boolean', default: false },
    'no-build': { type: 'boolean', default: false },
    'no-pack': { type: 'boolean', default: false },
    'fake-build': { type: 'boolean', default: false }
};

const { values: args } = parseArgs({ options });

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

function findVSPath() {
    let vsWhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    if (!fs.existsSync(vsWhere)) {
        throw new Error('Could not find vswhere.exe');
    }

    const versionJson = JSON.parse(execSync(`${vsWhere} -format json -version 17`).toString());
    if (versionJson.length > 1) {
        console.warn('More than one VS install detected, picking the first one');
    }

    const installationPath = versionJson[0].installationPath;
    const vcVarsPath = path.join(installationPath, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat');
    if (!fs.existsSync(vcVarsPath)) {
        throw new Error(`Could not find vcvarsall.bat at expected Visual Studio installation path: ${vcVarsPath}`);
    }

    return vcVarsPath;
}

function updateHermesVersion() {
    if (!args['release-version'].trim()) {
        return;
    }

    let hermesVersion = args['release-version'];
    if (args['release-version'].startsWith('0.0.0')) {
        hermesVersion = args['file-version'];
    }

    const cmakeListsPath = path.join(args['sources-path'], 'CMakeLists.txt');
    const cmakeContent = fs.readFileSync(cmakeListsPath, 'utf8').replace(/VERSION .* /, `VERSION ${hermesVersion}`);
    fs.writeFileSync(cmakeListsPath, cmakeContent);

    const packageJsonPath = path.join(args['sources-path'], 'npm', 'package.json');
    const packageContent = fs.readFileSync(packageJsonPath, 'utf8').replace(/"version": ".*",/, `"version": "${args['release-version']}",`);
    fs.writeFileSync(packageJsonPath, packageContent);

    console.log(`Release version set to ${args['release-version']}`);
    console.log(`Hermes version set to ${hermesVersion}`);
}

function buildAndCopy(platform, configuration) {
    console.log(`Invoke-BuildAndCopy is called with Platform: ${platform}, Configuration: ${configuration}`);

    const triplet = `${args['app-platform']}-${platform}-${configuration}`;
    const compilerAndToolsBuildPath = path.join(args['workspace-path'], 'build', 'tools');
    const compilerPath = path.join(compilerAndToolsBuildPath, 'bin', 'hermesc.exe');

    if (!args['fake-build'] && !fs.existsSync(compilerPath) && args['app-platform'] === 'uwp') {
        invokeCompilerBuild(args['tools-platform'], args['tools-configuration'], compilerAndToolsBuildPath);
    }

    const buildPath = path.join(args['workspace-path'], 'build', triplet);
    if (!args['fake-build']) {
        invokeDllBuild(platform, configuration, buildPath, compilerAndToolsBuildPath);
    }

    const finalOutputPath = path.join(args['output-path'], 'lib', 'native', args['app-platform'], configuration, platform);
    ensureDir(finalOutputPath);

    if (!args['fake-build']) {
        fs.copyFileSync(path.join(buildPath, 'API', 'hermes_shared', 'hermes.dll'), path.join(finalOutputPath, 'hermes.dll'));
        fs.copyFileSync(path.join(buildPath, 'API', 'hermes_shared', 'hermes.lib'), path.join(finalOutputPath, 'hermes.lib'));
        fs.copyFileSync(path.join(buildPath, 'API', 'hermes_shared', 'hermes.pdb'), path.join(finalOutputPath, 'hermes.pdb'));
    } else {
        fs.copyFileSync(path.join(process.env.SystemRoot, 'system32', 'kernel32.dll'), path.join(finalOutputPath, 'hermes.dll'));
        fs.writeFileSync(path.join(finalOutputPath, 'hermes.lib'), '');
        fs.writeFileSync(path.join(finalOutputPath, 'hermes.pdb'), '');
    }

    const toolsPath = path.join(args['output-path'], 'tools', 'native', args['tools-configuration'], args['tools-platform']);
    ensureDir(toolsPath);
    if (!args['fake-build']) {
        fs.copyFileSync(path.join(compilerAndToolsBuildPath, 'bin', 'hermes.exe'), path.join(toolsPath, 'hermes.exe'));
    } else {
        fs.writeFileSync(path.join(toolsPath, 'hermes.exe'), '');
    }
}

function createNugetPackage() {
    ensureDir(path.join(args['output-path'], 'lib', 'native', 'win32', 'release'));
    ensureDir(path.join(args['output-path'], 'lib', 'native', 'uwp', 'release'));

    ensureDir(path.join(args['output-path'], 'build', 'native', 'include', 'jsi'));
    fs.cpSync(path.join(args['sources-path'], 'API', 'jsi', 'jsi'), path.join(args['output-path'], 'build', 'native', 'include', 'jsi'), { recursive: true });

    ensureDir(path.join(args['output-path'], 'build', 'native', 'include', 'node-api'));
    fs.copyFileSync(path.join(args['sources-path'], 'API', 'hermes_shared', 'node-api', 'js_native_api.h'), path.join(args['output-path'], 'build', 'native', 'include', 'node-api', 'js_native_api.h'));
    fs.copyFileSync(path.join(args['sources-path'], 'API', 'hermes_shared', 'node-api', 'js_native_api_types.h'), path.join(args['output-path'], 'build', 'native', 'include', 'node-api', 'js_native_api_types.h'));
    fs.copyFileSync(path.join(args['sources-path'], 'API', 'hermes_shared', 'node-api', 'js_runtime_api.h'), path.join(args['output-path'], 'build', 'native', 'include', 'node-api', 'js_runtime_api.h'));

    ensureDir(path.join(args['output-path'], 'build', 'native', 'include', 'hermes'));
    fs.copyFileSync(path.join(args['sources-path'], 'API', 'hermes_shared', 'hermes_api.h'), path.join(args['output-path'], 'build', 'native', 'include', 'hermes', 'hermes_api.h'));

    ensureDir(path.join(args['output-path'], 'license'));
    fs.copyFileSync(path.join(args['sources-path'], 'LICENSE'), path.join(args['output-path'], 'license', 'LICENSE'));
    fs.copyFileSync(path.join(args['sources-path'], '.ado', 'Nuget', 'NOTICE.txt'), path.join(args['output-path'], 'license', 'NOTICE.txt'));
    fs.copyFileSync(path.join(args['sources-path'], '.ado', 'Nuget', 'Microsoft.JavaScript.Hermes.props'), path.join(args['output-path'], 'build', 'native', 'Microsoft.JavaScript.Hermes.props'));
    fs.copyFileSync(path.join(args['sources-path'], '.ado', 'Nuget', 'Microsoft.JavaScript.Hermes.targets'), path.join(args['output-path'], 'build', 'native', 'Microsoft.JavaScript.Hermes.targets'));
    fs.copyFileSync(path.join(args['sources-path'], '.ado', 'Nuget', 'Microsoft.JavaScript.Hermes.nuspec'), path.join(args['output-path'], 'Microsoft.JavaScript.Hermes.nuspec'));

    if (!fs.existsSync(path.join(args['output-path'], 'lib', 'uap'))) {
        fs.mkdirSync(path.join(args['output-path'], 'lib', 'uap'));
        fs.writeFileSync(path.join(args['output-path'], 'lib', 'uap', '_._'), '');
    }

    const pkgPath = path.join(args['output-path'], 'pkg');
    ensureDir(pkgPath);

    const packageVersion = args['release-version'];
    const repoUrl = 'https://github.com/microsoft/hermes-windows';
    const repoBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    const repoCommit = execSync('git rev-parse HEAD').toString().trim();
    const baseProperties = `nugetroot=${args['output-path']};version=${packageVersion};repoUrl=${repoUrl};repoBranch=${repoBranch};repoCommit=${repoCommit}`;
    const packageProperties = `${baseProperties};fat_suffix=;exclude_bin_files=** /*.pdb`;
    const fatPackageProperties = `${baseProperties};fat_suffix=.Fat;exclude_bin_files=*.txt`;

    const nugetPackBaseCmd = `nuget pack "${path.join(args['output-path'], 'Microsoft.JavaScript.Hermes.nuspec')}" -OutputDirectory "${pkgPath}" -NoDefaultExcludes`;
    const nugetPackCmd = `${nugetPackBaseCmd} -Properties "${packageProperties}"`;
    console.log(`Run command: ${nugetPackCmd}`);
    execSync(nugetPackCmd);

    const fatNugetPackCmd = `${nugetPackBaseCmd} -Properties "${fatPackageProperties}"`;
    console.log(`Run command: ${fatNugetPackCmd}`);
    execSync(fatNugetPackCmd);
}

function invokeCompilerBuild(platform, configuration, buildPath) {
    const genArgs = getCommonArgs(platform, configuration);

    const targets = ["hermes", "hermesc"];

    invokeBuildImpl({
        appPlatform: "win32",
        platform,
        configuration,
        buildPath,
        genArgs,
        targets
    });
}

function invokeDllBuild(platform, configuration, buildPath, compilerAndToolsBuildPath) {
    const genArgs = getCommonArgs(platform, configuration);

    genArgs.push("-DHERMES_ENABLE_DEBUGGER=ON");
    genArgs.push("-DHERMES_ENABLE_INTL=ON");

    if (args['app-platform'] === "uwp") {
        genArgs.push("-DHERMES_MSVC_USE_PLATFORM_UNICODE_WINGLOB=OFF");
    } else {
        genArgs.push("-DHERMES_MSVC_USE_PLATFORM_UNICODE_WINGLOB=ON");
    }

    if (args['app-platform'] === "uwp") {
        genArgs.push("-DCMAKE_SYSTEM_NAME=WindowsStore");
        genArgs.push(`-DCMAKE_SYSTEM_VERSION="${args['windows-sdk-version']}"`);
        genArgs.push(`-DIMPORT_HERMESC=${compilerAndToolsBuildPath}\\ImportHermesc.cmake`);
    } else if (platform === "arm64" || platform === "arm64ec") {
        genArgs.push("-DHERMES_MSVC_ARM64=On");
        genArgs.push(`-DIMPORT_HERMESC=${compilerAndToolsBuildPath}\\ImportHermesc.cmake`);
    }

    if (platform === "arm64ec") {
        process.env.CFLAGS = "-arm64EC";
        process.env.CXXFLAGS = "-arm64EC";
    }

    const targets = ["libshared"];
    if (args['run-tests']) {
        targets.push("check-hermes");
    }

    invokeBuildImpl({
        appPlatform: args['app-platform'],
        platform,
        configuration,
        buildPath,
        genArgs,
        targets
    });
}

function getCommonArgs(platform, configuration) {
    const genArgs = ["-G Ninja"];
    const cmakeConfiguration = getCMakeConfiguration(configuration);
    genArgs.push(`-DCMAKE_BUILD_TYPE=${cmakeConfiguration}`);
    genArgs.push("-DHERMESVM_PLATFORM_LOGGING=On");

    if (args['file-version']) {
        genArgs.push(`-DHERMES_FILE_VERSION=${args['file-version']}`);
    }

    return genArgs;
}

function getCMakeConfiguration(config) {
    switch (config) {
        case "debug":
            return "FastDebug";
        case "release":
            return "Release";
        default:
            return "Debug";
    }
}

function invokeBuildImpl({ appPlatform, platform, configuration, buildPath, genArgs, targets }) {
    if (!args['incremental-build']) {
        deleteDir(buildPath);
    }

    ensureDir(buildPath);
    process.chdir(buildPath);

    try {
        const genCall = `cmake ${genArgs.join(" ")} ${args['sources-path']}`;
        console.log(`genCall: ${genCall}`);

        const ninjaCall = `ninja ${targets.join(" ")}`;
        console.log(`ninjaCall: ${ninjaCall}`);

        const setVCVars = `"${vcvarsallBat}" ${getVCVarsParam(appPlatform, platform)}`;
        const genCmd = `${setVCVars} && ${genCall} 2>&1`;
        console.log(`Run command: ${genCmd}`);
        execSync(genCmd, { stdio: 'inherit' });

        if (args['configure-only']) {
            console.log("Exit: configure only");
            process.exit(0);
        }

        const ninjaCmd = `${setVCVars} && ${ninjaCall} 2>&1`;
        console.log(`Run command: ${ninjaCmd}`);
        execSync(ninjaCmd, { stdio: 'inherit' });
    } finally {
        process.chdir(__dirname);
    }
}

function getVCVarsParam(appPlatform, platform) {
    let vcVars;
    switch (platform) {
        case "x64":
            vcVars = "x64";
            break;
        case "x86":
            vcVars = "x64_x86";
            break;
        case "arm64":
        case "arm64ec":
            vcVars = "x64_arm64";
            break;
        default:
            vcVars = "x64";
    }

    if (appPlatform === "uwp") {
        vcVars += " uwp";
    }

    if (args['windows-sdk-version']) {
        vcVars += ` ${args['windows-sdk-version']}`;
    }

    vcVars += " -vcvars_spectre_libs=spectre";

    return vcVars;
}

function main() {
    const startTime = new Date();

    args['sources-path'] = path.resolve(args['sources-path']);
    ensureDir(args['workspace-path']);
    args['workspace-path'] = path.resolve(args['workspace-path']);
    ensureDir(args['output-path']);
    args['output-path'] = path.resolve(args['output-path']);

    console.log('cibuild is invoked with parameters:');
    console.log(`         SourcesPath: ${args['sources-path']}`);
    console.log(`       WorkSpacePath: ${args['workspace-path']}`);
    console.log(`          OutputPath: ${args['output-path']}`);
    console.log(`         AppPlatform: ${args['app-platform']}`);
    console.log(`            Platform: ${args.platform}`);
    console.log(`       Configuration: ${args.configuration}`);
    console.log(`       ToolsPlatform: ${args['tools-platform']}`);
    console.log(`  ToolsConfiguration: ${args['tools-configuration']}`);
    console.log(`   WindowsSDKVersion: ${args['windows-sdk-version']}`);
    console.log(`      ReleaseVersion: ${args['release-version']}`);
    console.log(`         FileVersion: ${args['file-version']}`);
    console.log(`            RunTests: ${args['run-tests']}`);
    console.log(`    IncrementalBuild: ${args['incremental-build']}`);
    console.log(`       ConfigureOnly: ${args['configure-only']}`);
    console.log(`             NoBuild: ${args['no-build']}`);
    console.log(`              NoPack: ${args['no-pack']}`);
    console.log(`           FakeBuild: ${args['fake-build']}`);
    console.log('');

    deleteDir(path.join(args['workspace-path'], 'unsupported', 'juno'));

    const vcvarsallBat = findVSPath();

    process.chdir(args['workspace-path']);
    try {
        updateHermesVersion();

        if (!args['no-build']) {
            const platforms = Array.isArray(args.platform) ? args.platform : [args.platform];
            const configurations = Array.isArray(args.configuration) ? args.configuration : [args.configuration];
            platforms.forEach(platform => {
                configurations.forEach(configuration => {
                    buildAndCopy(platform, configuration);
                });
            });
        }

        if (!args['no-pack']) {
            createNugetPackage();
        }
    } finally {
        process.chdir(__dirname);
    }

    const elapsedTime = new Date() - startTime;
    const totalTime = new Date(elapsedTime).toISOString().substr(11, 8);
    console.log(`Build took ${totalTime} to run`);
    console.log('');
}

main();
*/
