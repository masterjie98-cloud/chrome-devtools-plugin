# Host AI MCP Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one file that a user can hand to an AI inside any local stdio-MCP-capable host so that AI can configure and verify AI DevTools Assistant without the user copying JSON.

**Architecture:** A static AI-facing instruction file lives under `packaging/` and is copied to both the Release ZIP root and the fixed installation root. The existing config generator remains the source of absolute executable paths and gains a host-neutral `genericMcp` descriptor; the instruction file tells the host AI to run it, merge the descriptor through the host's official configuration mechanism, and report restart or permission boundaries honestly.

**Tech Stack:** Node.js ESM packaging scripts, Markdown, Node test runner with `tsx`.

---

### Task 1: Define package and installer behavior with failing tests

**Files:**
- Modify: `tests/portablePackage.test.ts`
- Test: `tests/portablePackage.test.ts`

- [ ] **Step 1: Add the failing package contract test**

Add a test that reads `packaging/让 AI 自动接入 MCP.md`, `scripts/package-local.mjs`,
`scripts/install-local.mjs`, and `scripts/print-client-config.mjs`. Assert that:

```typescript
assert.match(aiGuide, /genericMcp/);
assert.match(aiGuide, /不得覆盖|merge/i);
assert.match(aiGuide, /Bridge Token/);
assert.match(aiGuide, /重启|restart/i);
assert.match(aiGuide, /验证|verify/i);
assert.match(clientConfig, /genericMcp/);
assert.match(clientConfig, /transport:\s*"stdio"/);
assert.match(packager, /让 AI 自动接入 MCP\.md/);
assert.match(installer, /让 AI 自动接入 MCP\.md/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test --test-name-pattern="host AI" tests/portablePackage.test.ts
```

Expected: FAIL because `packaging/让 AI 自动接入 MCP.md` does not exist or the
generic descriptor/copy operations are absent.

### Task 2: Add the host-neutral config descriptor

**Files:**
- Modify: `scripts/print-client-config.mjs:19-62`
- Test: `tests/portablePackage.test.ts`

- [ ] **Step 1: Extend generated JSON**

Create one shared `serverConfig`, then add:

```javascript
genericMcp: {
  serverName: "ai-devtools",
  transport: "stdio",
  command: serverConfig.command,
  args: serverConfig.args,
  env: serverConfig.env,
},
```

Keep existing Codex, Cursor, and Claude Desktop fields compatible. The generator must
continue resolving `command` and the server argument to absolute paths.

- [ ] **Step 2: Run the focused test**

Run the Task 1 command. Expected: the generic descriptor assertions pass while package
copy assertions remain failing.

### Task 3: Create the AI-facing onboarding file

**Files:**
- Create: `packaging/让 AI 自动接入 MCP.md`
- Test: `tests/portablePackage.test.ts`

- [ ] **Step 1: Write the executable AI instructions**

The file must directly address the host AI and contain:

```markdown
# 给宿主应用内 AI 的 MCP 接入任务

你正在替用户把 AI DevTools Assistant 注册到当前宿主应用。
先识别操作系统、宿主应用、配置入口和你的写权限。
运行本目录内便携 Node 对应的 runtime/print-client-config.mjs，
读取 genericMcp；优先使用宿主官方 CLI/API，否则备份并合并配置文件。
不得覆盖其他 MCP server，不得把 Bridge Token 写入 MCP 配置或聊天。
如果宿主需要重启，只说明重启后如何验证，不得声称当前会话已加载新工具。
```

Include exact Windows, macOS arm64, and macOS x64 generator commands using the file's
containing directory as `INSTALL_ROOT`. Stop on unsupported OS, malformed config, or
denied write access. Require a final tool-list/connection verification.

- [ ] **Step 2: Run the focused test**

Expected: guide-content assertions pass; package/install copy assertions still fail.

### Task 4: Ship and install the onboarding file

**Files:**
- Modify: `scripts/package-local.mjs:163-197,365-388`
- Modify: `scripts/install-local.mjs:56-103,151-165`
- Modify: `scripts/package-local.mjs:227-299`
- Test: `tests/portablePackage.test.ts`

- [ ] **Step 1: Copy and validate during packaging**

Copy the static guide from `packaging/让 AI 自动接入 MCP.md` to the staging root.
Add the filename to `validateRelease()` required files.

- [ ] **Step 2: Copy during local installation**

Define `installedAiMcpGuidePath`, copy the file from `bundleRoot` to `installRoot`, and
print:

```javascript
`交给宿主 AI 的 MCP 接入文件：${installedAiMcpGuidePath}`
```

The normal installation must fail if the Release file is missing; do not silently write
a weaker fallback.

- [ ] **Step 3: Update the human install guide**

Add a short section explaining that users of any other MCP host can attach
`让 AI 自动接入 MCP.md` to the host AI instead of copying configuration manually.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx tsx --test tests/portablePackage.test.ts
```

Expected: all portable package tests pass.

### Task 5: Verify build and release artifact

**Files:**
- Verify: `packaging/让 AI 自动接入 MCP.md`
- Verify: `release/ai-devtools-assistant-local-0.1.0.zip`

- [ ] **Step 1: Run diagnostics and full regression**

Run IDE lint diagnostics for all modified source/test files, then:

```bash
npm test
npm run build
```

Expected: zero test failures and successful TypeScript/build output.

- [ ] **Step 2: Rebuild and inspect the package**

Run:

```bash
npm run package:local
unzip -t release/ai-devtools-assistant-local-0.1.0.zip
shasum -a 256 -c release/ai-devtools-assistant-local-0.1.0.zip.sha256
```

Expected: archive integrity and checksum pass. Confirm both the ZIP root and a dry-run
or source inspection show `让 AI 自动接入 MCP.md` copied to the fixed install root.

- [ ] **Step 3: Verify Windows installer format**

Run `file` against the packaged `.cmd`; expected output remains ASCII with CRLF line
terminators.

No commit is included because the user has not authorized creating one.
