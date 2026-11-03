#!/usr/bin/env bash
# 全テストを一括実行する(PHPサーバーを一時ポート・一時データで起動して後片付けまで行う)
#   tests/run_all.sh            ... JS/PHP一致 + エンジン等価 + API(アップロード) + 画面テスト
#   NO_E2E=1 tests/run_all.sh   ... Playwright が無い環境ではブラウザのテストを省く
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8097}; DATA=$(mktemp -d); OUT=$(mktemp -d); export PM_DATA_DIR=$DATA BASE=http://127.0.0.1:$PORT OUT
php -d upload_max_filesize=6M -d post_max_size=8M -S 127.0.0.1:$PORT -t . >"$OUT/php.log" 2>&1 &
SRV=$!
cleanup() { kill $SRV 2>/dev/null; rm -rf "$DATA" uploads/t-* uploads/demo; }
trap cleanup EXIT
sleep 1
FAIL=0
run() { echo "== $1"; shift; "$@" || { echo "!! 失敗: $*"; FAIL=1; }; }
run "JS↔PHP 検証の一致"            tests/parity.sh
run "エンジン等価(元プロトタイプ)"  node tests/engine_equivalence.mjs
run "ステージ編集の純粋関数"        node tests/level_ops.mjs
run "アップロードAPI"               node tests/api_assets.mjs
if [ -z "${NO_E2E:-}" ]; then
  export NODE_PATH=$(npm root -g)
  run "画面: e2e_editor(ナビゲーション・レイアウト)" bash -c "node tests/e2e_editor.cjs | grep -q '\"ok\":true' && echo ok"
  run "画面: e2e_stage(ステージ編集)" bash -c "node tests/e2e_stage.cjs | grep -q '\"ok\":true' && echo ok"
  for t in e2e_dashboard e2e_3d e2e_no_webgl e2e_models e2e_broken_glb e2e_assets; do
    run "画面: $t" bash -c "node tests/$t.cjs | tee '$OUT/$t.json' | grep -q '\"errs\": *\\[\\]' || grep -q '\"errs\":\\[\\]' '$OUT/$t.json' || { echo 'コンソールエラーあり'; cat '$OUT/$t.json'; exit 1; }"
  done
fi
[ $FAIL = 0 ] && echo "すべて成功" || echo "失敗あり"
exit $FAIL
