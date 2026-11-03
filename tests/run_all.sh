#!/usr/bin/env bash
# 全テストを一括実行する(PHPサーバーを一時ポート・一時データで起動して後片付けまで行う)
#   tests/run_all.sh            ... JS/PHP一致 + エンジン等価 + API(アップロード) + 画面テスト
#   NO_E2E=1 tests/run_all.sh   ... Playwright が無い環境ではブラウザのテストを省く
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8097}; APORT=${APORT:-8098}; DATA=$(mktemp -d); ADATA=$(mktemp -d); OUT=$(mktemp -d)
export PM_DATA_DIR=$DATA BASE=http://127.0.0.1:$PORT OUT
export PM_DEV_OPEN=1   # 開発用: ループバックのときだけ認証を省略(認証のテストは別サーバー・別設定で行う)
php -d upload_max_filesize=6M -d post_max_size=8M -S 127.0.0.1:$PORT -t . >"$OUT/php.log" 2>&1 &
SRV=$!
# 認証つきサーバー(DEV_OPENなし・パスワード設定済み): ログインの画面テスト用
APASS="e2e-login-password-1"; ACFG="$ADATA/config.php"
php -r 'file_put_contents($argv[1], "<?php return " . var_export(["password_hash" => password_hash($argv[2], PASSWORD_DEFAULT), "secret" => bin2hex(random_bytes(32)), "session_hours" => 12], true) . ";");' "$ACFG" "$APASS"
PM_DEV_OPEN= PM_CONFIG_FILE="$ACFG" PM_DATA_DIR="$ADATA/data" php -S 127.0.0.1:$APORT -t . >"$OUT/php-auth.log" 2>&1 &
ASRV=$!
cleanup() { kill $SRV $ASRV 2>/dev/null; rm -rf "$DATA" "$ADATA" uploads/t-* uploads/demo; }
trap cleanup EXIT
sleep 1
FAIL=0
fresh() { rm -rf "$DATA/demo" uploads/demo; } # 画面テストは毎回、初期状態のゲームから始める(互いに干渉させない)
run() { echo "== $1"; shift; case "$1" in bash) fresh;; esac; "$@" || { echo "!! 失敗: $*"; FAIL=1; }; }
run "JS↔PHP 検証の一致"            tests/parity.sh
run "エンジン等価(元プロトタイプ)"  node tests/engine_equivalence.mjs
run "履歴の間引き"                  php tests/prune_test.php
run "認証API"                       node tests/api_auth.mjs
run "ステージ編集の純粋関数"        node tests/level_ops.mjs
run "アップロードAPI"               node tests/api_assets.mjs
if [ -z "${NO_E2E:-}" ]; then
  export NODE_PATH=$(npm root -g)
  run "画面: e2e_editor(ナビゲーション・レイアウト)" bash -c "node tests/e2e_editor.cjs | grep -q '\"ok\":true' && echo ok"
  run "画面: e2e_login(ログイン)" bash -c "AUTH_BASE=http://127.0.0.1:$APORT AUTH_PASSWORD='$APASS' node tests/e2e_login.cjs | grep -q '\"ok\":true' && echo ok"
  run "画面: e2e_stage(ステージ編集)" bash -c "node tests/e2e_stage.cjs | grep -q '\"ok\":true' && echo ok"
  for t in e2e_dashboard e2e_3d e2e_no_webgl e2e_models e2e_broken_glb e2e_assets; do
    run "画面: $t" bash -c "node tests/$t.cjs | tee '$OUT/$t.json' | grep -q '\"errs\": *\\[\\]' || grep -q '\"errs\":\\[\\]' '$OUT/$t.json' || { echo 'コンソールエラーあり'; cat '$OUT/$t.json'; exit 1; }"
  done
fi
[ $FAIL = 0 ] && echo "すべて成功" || echo "失敗あり"
exit $FAIL
