#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) NODE_TARGET="darwin-arm64" ;;
  x86_64|amd64) NODE_TARGET="darwin-x64" ;;
  *) echo "不支持的 macOS 架构：$ARCH"; exit 1 ;;
esac
NODE_BIN="$SCRIPT_DIR/runtime/node/$NODE_TARGET/node"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "安装包缺少当前平台的便携 Node：$NODE_BIN"
  echo "请重新下载完整的 Release ZIP 并完整解压。"
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/runtime/install-local.mjs" "$@"
