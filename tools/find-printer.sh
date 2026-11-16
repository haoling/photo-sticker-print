#!/usr/bin/env bash
# host ネットワークの Docker コンテナで mDNS を引き、LAN 内のプリンタの IP を探す。
# 使い方: tools/find-printer.sh [待ち時間(秒)]
# 前提: Linux の Docker（host ネットワークが LAN に直結する環境）。
#       Docker Desktop (Mac/Windows) では mDNS が届かないので、その場合はルーターの
#       DHCP 一覧かプリンタの操作パネルで IP を確認する。
set -euo pipefail

wait_sec="${1:-6}"
here="$(cd "$(dirname "$0")" && pwd)"

# pip の -q は接続リトライの WARNING も隠してしまい、PyPI に届かないだけなのに
# "No matching distribution found (from versions: none)" としか見えなくなるので付けない。
exec docker run --rm --network host \
  -v "$here/find-printer.py:/find-printer.py:ro" \
  python:3.13-slim \
  sh -c 'pip install --no-cache-dir --root-user-action=ignore --disable-pip-version-check --retries 2 --timeout 10 zeroconf >/dev/null \
    || { echo "ERROR: コンテナ内から PyPI (pypi.org) に届きません。DNS / プロキシ / ファイアウォールを確認してください。" >&2; exit 2; }; \
    python /find-printer.py "$1"' _ "$wait_sec"
