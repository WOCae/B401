#!/usr/bin/env bash
# JS と PHP の検証・診断・差分適用が同じ結果になることを確認する
set -euo pipefail
cd "$(dirname "$0")"
T=$(mktemp -d)
node dump.mjs > "$T/js.json"
php dump.php > "$T/php.json"
node compare.mjs "$T/js.json" "$T/php.json"
