#!/usr/bin/env node

import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const version = String(packageJson.version ?? "").trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json contains an unsupported version: ${version}`);
}

const releaseRoot = join(projectRoot, "release");
const artifactName = `ai-devtools-assistant-local-${version}`;
const packageRoot = join(releaseRoot, artifactName);
const stagingRoot = join(
  releaseRoot,
  `.${artifactName}.staging-${process.pid}`,
);
const archivePath = join(releaseRoot, `${artifactName}.zip`);
const checksumPath = `${archivePath}.sha256`;
const allowedRuntimeExternals = new Set([
  ...builtinModules,
  ...builtinModules.map((name) =>
    name.startsWith("node:") ? name : `node:${name}`,
  ),
  "bufferutil",
  "utf-8-validate",
]);

await mkdir(releaseRoot, { recursive: true });
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

try {
  await buildExtension(join(stagingRoot, "extension"));
  const runtimeBuild = await buildRuntime(join(stagingRoot, "runtime"));
  await copyReleaseSupportFiles(stagingRoot);
  await writeReleasePackageJson(stagingRoot);
  await validateRelease(stagingRoot, runtimeBuild);

  await rm(packageRoot, { recursive: true, force: true });
  await rename(stagingRoot, packageRoot);
  await rm(archivePath, { force: true });
  await rm(checksumPath, { force: true });
  createZip(releaseRoot, artifactName, archivePath);

  const archiveBytes = await readFile(archivePath);
  const checksum = createHash("sha256").update(archiveBytes).digest("hex");
  await writeFile(
    checksumPath,
    `${checksum}  ${artifactName}.zip\n`,
    "utf8",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        packageDirectory: packageRoot,
        archive: archivePath,
        sha256: checksum,
        chromeLoadPath: join(packageRoot, "extension"),
        macInstaller: join(packageRoot, "安装 AI DevTools Assistant.command"),
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

async function buildExtension(extensionRoot) {
  await viteBuild({
    root: projectRoot,
    configFile: join(projectRoot, "vite.config.ts"),
    logLevel: "warn",
    build: {
      outDir: extensionRoot,
      emptyOutDir: true,
      sourcemap: false,
    },
  });
  await esbuild({
    absWorkingDir: projectRoot,
    entryPoints: ["src/content/index.ts"],
    outfile: join(extensionRoot, "assets", "content.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116",
    logLevel: "warning",
  });
}

async function buildRuntime(runtimeRoot) {
  return esbuild({
    absWorkingDir: projectRoot,
    entryPoints: [
      "src/daemon/server.ts",
      "src/daemon/status.ts",
      "src/daemon/printToken.ts",
      "src/daemon/allowExtension.ts",
      "src/mcp/server.ts",
    ],
    outbase: "src",
    outdir: runtimeRoot,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "bundle",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    sourcemap: false,
    metafile: true,
    logLevel: "warning",
  });
}

async function copyReleaseSupportFiles(stagingRoot) {
  const runtimeRoot = join(stagingRoot, "runtime");
  await cp(
    join(projectRoot, "scripts", "manage-local-service.mjs"),
    join(runtimeRoot, "manage-local-service.mjs"),
  );
  await cp(
    join(projectRoot, "scripts", "print-client-config.mjs"),
    join(runtimeRoot, "print-client-config.mjs"),
  );
  await cp(
    join(projectRoot, "scripts", "install-local-macos.mjs"),
    join(runtimeRoot, "install-local-macos.mjs"),
  );
  await cp(
    join(projectRoot, "packaging", "install-macos.command"),
    join(stagingRoot, "安装 AI DevTools Assistant.command"),
  );
  await cp(
    join(projectRoot, "docs", "local-install.zh-CN.md"),
    join(stagingRoot, "安装说明.md"),
  );
  await chmod(join(stagingRoot, "安装 AI DevTools Assistant.command"), 0o755);
}

async function writeReleasePackageJson(stagingRoot) {
  const releasePackageJson = {
    name: packageJson.name,
    private: true,
    version,
    type: "module",
    scripts: {
      "daemon:start": "node runtime/daemon/server.js",
      "daemon:status": "node runtime/daemon/status.js",
      "daemon:token": "node runtime/daemon/printToken.js",
      "daemon:allow-extension":
        "node runtime/daemon/allowExtension.js",
      "daemon:install-service":
        "node runtime/manage-local-service.mjs install --server-path runtime/daemon/server.js",
      "daemon:uninstall-service":
        "node runtime/manage-local-service.mjs uninstall --server-path runtime/daemon/server.js",
      "client:config":
        "node runtime/print-client-config.mjs --server-path runtime/mcp/server.js",
    },
  };
  await writeFile(
    join(stagingRoot, "package.json"),
    `${JSON.stringify(releasePackageJson, null, 2)}\n`,
    "utf8",
  );
}

async function validateRelease(stagingRoot, runtimeBuild) {
  const requiredFiles = [
    "extension/manifest.json",
    "extension/sidepanel.html",
    "runtime/daemon/server.js",
    "runtime/daemon/status.js",
    "runtime/daemon/printToken.js",
    "runtime/daemon/allowExtension.js",
    "runtime/mcp/server.js",
    "runtime/manage-local-service.mjs",
    "runtime/print-client-config.mjs",
    "runtime/install-local-macos.mjs",
    "安装 AI DevTools Assistant.command",
    "安装说明.md",
    "package.json",
  ];
  await Promise.all(
    requiredFiles.map((path) => assertFile(join(stagingRoot, path))),
  );

  const externalPackageImports = Object.values(
    runtimeBuild.metafile?.outputs ?? {},
  )
    .flatMap((output) => output.imports)
    .filter(
      (runtimeImport) =>
        runtimeImport.external &&
        !allowedRuntimeExternals.has(runtimeImport.path),
    )
    .map((runtimeImport) => runtimeImport.path);
  if (externalPackageImports.length > 0) {
    throw new Error(
      `The local runtime still requires external packages: ${[
        ...new Set(externalPackageImports),
      ].join(", ")}`,
    );
  }
}

function createZip(cwd, sourceName, destinationPath) {
  const candidates =
    process.platform === "darwin"
      ? [
          {
            command: "/usr/bin/ditto",
            args: [
              "-c",
              "-k",
              "--sequesterRsrc",
              "--keepParent",
              join(cwd, sourceName),
              destinationPath,
            ],
            cwd,
          },
          {
            command: "zip",
            args: ["-qry", destinationPath, sourceName],
            cwd,
          },
        ]
      : [
          {
            command: "zip",
            args: ["-qry", destinationPath, sourceName],
            cwd,
          },
        ];

  const failures = [];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, {
      cwd: candidate.cwd,
      encoding: "utf8",
    });
    if (result.status === 0) {
      return;
    }
    failures.push(
      `${candidate.command}: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  }
  throw new Error(`Unable to create ZIP archive. ${failures.join(" | ")}`);
}

async function assertFile(path) {
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat?.isFile()) {
    throw new Error(`Missing required file: ${path}`);
  }
}
