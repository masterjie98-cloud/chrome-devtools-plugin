#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
cd "$ROOT_DIR"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "未找到 Node.js。请先安装 Node.js 20 或更高版本，然后重新双击本文件。"
  echo "可用: brew install node@20   或 https://nodejs.org/"
  exit 1
fi

exec "$NODE_BIN" "$ROOT_DIR/scripts/setup-local-scaffold.mjs" "$@"
