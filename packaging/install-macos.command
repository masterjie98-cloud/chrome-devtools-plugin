#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "未找到 Node.js。请先安装 Node.js 20 或更高版本，然后重新双击本文件。"
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/runtime/install-local-macos.mjs" "$@"
