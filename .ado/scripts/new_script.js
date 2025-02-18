const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("node:util");

const options = {
  SourcesPath: {
    type: "string",
    default: path.resolve(__dirname, path.join("..", "..")),
  },
  WorkSpacePath: {
    type: "string",
    default: path.resolve(__dirname, path.join("..", "..", "workspace")),
  },
  OutputPath: {
    type: "string",
    default: path.resolve(__dirname, path.join("..", "..", "workspace", "out")),
  },
  // "x64", "x86", "arm64", "arm64ec"
  Platform: { type: "string", multiple: true, default: ["x64"] },
  // "x64", "x86", "arm64"
  ToolsPlatform: { type: "string", default: "x86" },
  // "debug", "release"
  ToolsConfiguration: { type: "string", default: "release" },
  // "debug", "release"
  Configuration: { type: "string", multiple: true, default: ["release"] },
  // "win32", "uwp"
  AppPlatform: { type: "string", default: "uwp" },
  WindowsSDKVersion: { type: "string", default: "" },
  ReleaseVersion: { type: "string", default: "0.0.0" },
  FileVersion: { type: "string", default: "0.0.0.0" },
  RunTests: { type: "boolean", default: false },
  IncrementalBuild: { type: "boolean", default: false },
  ConfigureOnly: { type: "boolean", default: false },
  NoBuild: { type: "boolean", default: false },
  NoPack: { type: "boolean", default: false },
  FakeBuild: { type: "boolean", default: false },
};

const { values: args } = parseArgs({ options, allowNegative: true });

// Convert all string arg values to lower case.
for (const [key, value] of Object.entries(args)) {
  if (typeof value === "string") {
    args[key] = value.toLowerCase();
  }
}

main();

function main() {
//   const startTime = new Date();

//   args.SourcesPath = path.resolve(args.SourcesPath);
//   ensureDir(args.WorkSpacePath);
//   args.WorkSpacePath = path.resolve(args.WorkSpacePath);
//   ensureDir(args.OutputPath);
//   args.OutputPath = path.resolve(args.OutputPath);

  console.log(`${__filename} is invoked with parameters:`);
  console.log(`         SourcesPath: ${args.SourcesPath}`);
  console.log(`       WorkSpacePath: ${args.WorkSpacePath}`);
  console.log(`          OutputPath: ${args.OutputPath}`);
  console.log(`         AppPlatform: ${args.AppPlatform}`);
  console.log(`            Platform: ${args.Platform}`);
  console.log(`       Configuration: ${args.Configuration}`);
  console.log(`       ToolsPlatform: ${args.ToolsPlatform}`);
  console.log(`  ToolsConfiguration: ${args.ToolsConfiguration}`);
  console.log(`   WindowsSDKVersion: ${args.WindowsSDKVersion}`);
  console.log(`      ReleaseVersion: ${args.ReleaseVersion}`);
  console.log(`         FileVersion: ${args.FileVersion}`);
  console.log(`            RunTests: ${args.RunTests}`);
  console.log(`    IncrementalBuild: ${args.IncrementalBuild}`);
  console.log(`       ConfigureOnly: ${args.ConfigureOnly}`);
  console.log(`             NoBuild: ${args.NoBuild}`);
  console.log(`              NoPack: ${args.NoPack}`);
  console.log(`           FakeBuild: ${args.FakeBuild}`);
  console.log("");

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

/*
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
