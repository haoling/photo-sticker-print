#!/usr/bin/env bash
# プリンタの IPP 対応状況を調べて、結果を tools/probe-out/ に保存する。
# 使い方: tools/probe-printer.sh <プリンタのIPアドレス or ホスト名>
# IP が分からないときは先に tools/find-printer.sh で探す。
# 前提: docker が使えること（ipptool を含むイメージを使うので、ホストへのインストールは不要）。
# ipptool を直接使える環境なら IPPTOOL=ipptool を指定すれば docker を使わない。
set -euo pipefail

host="${1:?使い方: $0 <プリンタのIPアドレス or ホスト名>}"
out="$(cd "$(dirname "$0")" && pwd)/probe-out"
mkdir -p "$out"

run_ipptool() {
  if [ -n "${IPPTOOL:-}" ]; then
    "$IPPTOOL" "$@"
  else
    docker run --rm --network host -v "$out:/out" debian:stable-slim bash -c \
      'apt-get update -qq >/dev/null && apt-get install -y -qq cups-ipp-utils >/dev/null && ipptool "$@"' _ "$@"
  fi
}

# Get-Printer-Attributes（全属性）。パスはプリンタによって違うので順に試す。
for path in ipp/print ipp/printer ipp ""; do
  uri="ipp://${host}:631/${path}"
  echo "== $uri を試します"
  if run_ipptool -tv "$uri" get-printer-attributes.test >"$out/attributes.txt" 2>"$out/attributes.err"; then
    echo "$uri" >"$out/uri.txt"
    echo "成功: $out/attributes.txt に保存しました"
    break
  fi
done

if [ ! -s "$out/uri.txt" ]; then
  echo "どの URI でも応答がありませんでした。$out/attributes.err を確認してください。" >&2
  exit 1
fi

echo
echo "== 重要な属性の抜粋"
grep -E 'document-format-supported|media-supported|media-col-database|media-type-supported|print-quality-supported|media-source-supported|print-color-mode-supported|printer-resolution-supported|printer-uuid|printer-make-and-model|printer-info|urf-supported|pwg-raster-document|media-left-margin|media-bottom-margin|print-content-optimize|output-bin|sides-supported|printer-state-reasons' \
  "$out/attributes.txt" || true
