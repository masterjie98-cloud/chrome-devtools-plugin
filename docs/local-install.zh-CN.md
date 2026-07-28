# AI DevTools Assistant 本地安装说明

本安装包用于可信用户在本机使用 AI DevTools Assistant，不需要发布到
Chrome Web Store。Chrome 扩展通过开发者模式加载，本地 daemon 只监听
`127.0.0.1:17321`。

## 系统要求

- macOS
- Google Chrome 116 或更高版本
- Node.js 20 或更高版本
- 安装包必须先完整解压，不能直接在 ZIP 预览中运行

## 一键安装

1. 双击 `安装 AI DevTools Assistant.command`。
2. 如果 macOS 阻止首次运行，右键该文件，选择“打开”，再次确认。
3. 安装器会把程序复制到：

   ```text
   ~/Library/Application Support/AI DevTools Assistant/
   ```

4. 安装器会注册并启动当前用户的 LaunchAgent，然后输出扩展目录和本机
   Bridge Token。

安装器不会自动修改 Chrome，也不会把 Token 上传到任何位置。

## 在 Chrome 中加载扩展

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择：

   ```text
   ~/Library/Application Support/AI DevTools Assistant/extension
   ```

5. 打开扩展侧栏的 AI 设置，将安装器输出的 Token 填入“本地 Bridge Token”
   并保存。

不要把 Bridge Token 粘贴到聊天、日志、截图或共享文档。每台电脑应使用本机
生成的 Token。

## 查看状态或重新取得 Token

```bash
AI_DEVTOOLS_HOME="$HOME/Library/Application Support/AI DevTools Assistant"
node "$AI_DEVTOOLS_HOME/runtime/daemon/status.js"
node "$AI_DEVTOOLS_HOME/runtime/daemon/printToken.js"
```

## 可选：接入 Codex

```bash
AI_DEVTOOLS_HOME="$HOME/Library/Application Support/AI DevTools Assistant"
node "$AI_DEVTOOLS_HOME/runtime/print-client-config.mjs" \
  --server-path "$AI_DEVTOOLS_HOME/runtime/mcp/server.js"
```

按输出的 `codex mcp add` 命令注册。Codex 配置中不要写 Bridge Token；MCP
adapter 会从本机 daemon 私有配置读取。

## 可选：限制允许连接的扩展 ID

从 `chrome://extensions` 复制 AI DevTools Assistant 的 32 位扩展 ID：

```bash
AI_DEVTOOLS_HOME="$HOME/Library/Application Support/AI DevTools Assistant"
node "$AI_DEVTOOLS_HOME/runtime/daemon/allowExtension.js" 扩展ID
launchctl kickstart -k \
  "gui/$(id -u)/com.ai-devtools-assistant.daemon"
```

配置白名单后，其他扩展 ID 即使知道 Token 也不能连接。

## 更新

下载并解压新版本，再次双击 `安装 AI DevTools Assistant.command`。安装器会：

- 停止旧 daemon；
- 替换稳定安装目录中的 runtime 和扩展；
- 保留本机 daemon 配置、Token、状态和 artifact；
- 重新启动 LaunchAgent。

完成后打开 `chrome://extensions`，在 AI DevTools Assistant 卡片上点击“重新加载”。
扩展目录保持不变，不要删除后重新加载其他目录。

## 卸载

先停止并移除 LaunchAgent：

```bash
AI_DEVTOOLS_HOME="$HOME/Library/Application Support/AI DevTools Assistant"
node "$AI_DEVTOOLS_HOME/runtime/manage-local-service.mjs" uninstall \
  --server-path "$AI_DEVTOOLS_HOME/runtime/daemon/server.js"
```

然后在 `chrome://extensions` 移除扩展。确认不再需要后，可将下面目录移到废纸篓：

```text
~/Library/Application Support/AI DevTools Assistant/
```

本机配对配置和运行状态分别位于 `~/.config/ai-devtools-assistant/` 与
`~/.local/share/ai-devtools-assistant/`，卸载器不会自动删除这些数据。

## 常见问题

### 提示找不到 Node.js

安装 Node.js 20 或更高版本，重新打开终端后再次运行安装器。

### 扩展显示 daemon 未连接

先执行状态命令。如果状态失败，再次运行一键安装器；不要同时手工启动第二个
daemon。

### Token 不正确

执行 `printToken.js` 重新读取本机 Token，覆盖扩展设置中的旧值。不要从其他电脑
复制 Token。

### 更新后页面能力没有变化

打开 `chrome://extensions` 点击扩展的“重新加载”，然后刷新目标网页。内容脚本
不会自动替换已经加载到旧页面中的版本。
