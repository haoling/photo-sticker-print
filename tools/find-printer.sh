#!/usr/bin/env bash
# host ネットワークの Docker コンテナで mDNS を引き、LAN 内のプリンタの IP を探す。
# 使い方: tools/find-printer.sh [待ち時間(秒)]
# 前提: Linux の Docker（host ネットワークが LAN に直結する環境）。
#       Docker Desktop (Mac/Windows) では mDNS が届かないので、その場合はルーターの
#       DHCP 一覧かプリンタの操作パネルで IP を確認する。
set -euo pipefail

wait_sec="${1:-6}"
here="$(cd "$(dirname "$0")" && pwd)"

exec docker run --rm --network host \
  -v "$here/find-printer.py:/find-printer.py:ro" \
  python:3.13-slim \
  sh -c 'pip install -q --no-cache-dir --root-user-action=ignore zeroconf >/dev/null && python /find-printer.py "$1"' _ "$wait_sec"
