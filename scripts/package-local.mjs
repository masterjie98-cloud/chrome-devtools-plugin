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
const updateRepository = "masterjie98-cloud/chrome-devtools-plugin";
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
  await bundlePortableNode(join(stagingRoot, "runtime", "node"));
  await copyReleaseSupportFiles(stagingRoot);
  await writeReleasePackageJson(stagingRoot);
  await writeReleaseManifest(stagingRoot);
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
        windowsInstaller: join(packageRoot, "安装 AI DevTools Assistant.cmd"),
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

async function bundlePortableNode(outputRoot) {
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts", "bundle-portable-node.mjs"), "--output", outputRoot],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to bundle portable Node runtimes: ${result.error?.message || `exit ${result.status}`}`,
    );
  }
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
    join(projectRoot, "scripts", "install-local.mjs"),
    join(runtimeRoot, "install-local.mjs"),
  );
  await cp(
    join(projectRoot, "scripts", "restart-daemon.mjs"),
    join(runtimeRoot, "restart-daemon.mjs"),
  );
  // Legacy macOS-only installer kept for older docs/scripts that still call it.
  await cp(
    join(projectRoot, "scripts", "install-local-macos.mjs"),
    join(runtimeRoot, "install-local-macos.mjs"),
  );
  await cp(
    join(projectRoot, "packaging", "setup.cmd"),
    join(stagingRoot, "安装 AI DevTools Assistant.cmd"),
  );
  await cp(
    join(projectRoot, "packaging", "setup.command"),
    join(stagingRoot, "安装 AI DevTools Assistant.command"),
  );
  await writeShareGuide(join(stagingRoot, "安装说明.md"));
  await writeExtensionUpdateNotice(join(stagingRoot, "extension"));
  await chmod(join(stagingRoot, "安装 AI DevTools Assistant.command"), 0o755);
}

async function writeExtensionUpdateNotice(extensionRoot) {
  const wsVersion = await readWsVersion();
  const notice = {
    version,
    buildId: `${version}+ws${wsVersion}`,
    updatedAt: new Date().toISOString(),
    source: "package-local",
    commit: "",
    previousCommit: "",
    previousVersion: version,
    needsExtensionReload: false,
  };
  await writeFile(
    join(extensionRoot, "update-notice.json"),
    `${JSON.stringify(notice, null, 2)}\n`,
    "utf8",
  );
}

async function writeShareGuide(destinationPath) {
  const guide = `# AI DevTools Assistant 安装说明（zip）

本压缩包用于把扩展 + 本地 daemon 装到本机，不经过 Chrome 网上应用店。

## 系统要求

- Windows 10+ 或 macOS
- Google Chrome 116+
- 无需预装 Node.js；压缩包已包含经过官方 SHA-256 校验的便携 Node 运行时
- 请先完整解压 zip，不要在压缩预览里直接运行

## 一键安装

### Windows

1. 解压 zip
2. 双击 \`安装 AI DevTools Assistant.cmd\`
3. 安装器会注册登录自启动、启动 daemon 并打印 Bridge Token

### macOS

1. 解压 zip
2. 双击 \`安装 AI DevTools Assistant.command\`
   （若被拦截：右键 → 打开 → 仍要打开）
3. 安装器会注册 LaunchAgent、后台启动 daemon 并打印 Token

## 加载 Chrome 扩展

1. 打开 \`chrome://extensions\`
2. 开启开发者模式 → 加载已解压的扩展程序
3. 选择安装器输出的 extension 目录（也会打印在终端里）
4. 侧栏 AI 设置填入 Bridge Token

## 更新

首次安装后，打开侧栏设置 →「检查更新」→「由 Daemon 更新」。Daemon 会从
GitHub Release 下载版本匹配的 zip 和 SHA-256，完成校验、覆盖并自动重启。
磁盘更新完成后仍需按侧栏提示重载 Chrome 扩展。

如果本机尚未安装 daemon，仍需先手动下载并运行最新 zip。包含自动更新能力之前的
旧版 zip 也需要人工覆盖安装一次；之后即可使用 daemon 自动更新。

## MCP（Cursor / Codex）

安装完成后，在安装目录的 runtime 下可运行：

\`\`\`bash
runtime/node/<当前平台>/node runtime/print-client-config.mjs --server-path runtime/mcp/server.js
\`\`\`

按输出配置客户端。不要把 Bridge Token 写进 MCP 配置。
`;
  await writeFile(destinationPath, guide, "utf8");
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
      "daemon:restart-helper": "node runtime/restart-daemon.mjs --help",
    },
    aiDevtools: {
      installMode: "release-zip",
      updateRepository,
    },
  };
  await writeFile(
    join(stagingRoot, "package.json"),
    `${JSON.stringify(releasePackageJson, null, 2)}\n`,
    "utf8",
  );
}

async function writeReleaseManifest(stagingRoot) {
  const wsVersion = await readWsVersion();
  const manifest = {
    schemaVersion: 1,
    product: "ai-devtools-assistant",
    version,
    buildId: `${version}+ws${wsVersion}`,
    updateRepository,
    archiveName: `${artifactName}.zip`,
    checksumName: `${artifactName}.zip.sha256`,
  };
  await writeFile(
    join(stagingRoot, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function readWsVersion() {
  try {
    const wsSource = await readFile(
      join(projectRoot, "src/shared/wsProtocol.ts"),
      "utf8",
    );
    return wsSource.match(/export const WS_PROTOCOL_VERSION = (\d+)/)?.[1] ?? "0";
  } catch {
    return "0";
  }
}

async function validateRelease(stagingRoot, runtimeBuild) {
  const requiredFiles = [
    "extension/manifest.json",
    "extension/sidepanel.html",
    "extension/update-notice.json",
    "runtime/daemon/server.js",
    "runtime/daemon/status.js",
    "runtime/daemon/printToken.js",
    "runtime/daemon/allowExtension.js",
    "runtime/mcp/server.js",
    "runtime/manage-local-service.mjs",
    "runtime/print-client-config.mjs",
    "runtime/install-local.mjs",
    "runtime/restart-daemon.mjs",
    "runtime/node/portable-node.json",
    "runtime/node/darwin-arm64/node",
    "runtime/node/darwin-x64/node",
    "runtime/node/win32-x64/node.exe",
    "安装 AI DevTools Assistant.cmd",
    "安装 AI DevTools Assistant.command",
    "安装说明.md",
    "release-manifest.json",
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
      : process.platform === "win32"
        ? [
            {
              command: "powershell",
              args: [
                "-NoProfile",
                "-Command",
                `Compress-Archive -Path '${join(cwd, sourceName).replaceAll("'", "''")}' -DestinationPath '${destinationPath.replaceAll("'", "''")}' -Force`,
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
