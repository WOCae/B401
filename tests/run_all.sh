#!/usr/bin/env bash
# 全テストを一括実行する(PHPサーバーを一時ポート・一時データで起動して後片付けまで行う)
#   tests/run_all.sh            ... JS/PHP一致 + エンジン等価 + API(アップロード) + 画面テスト
#   NO_E2E=1 tests/run_all.sh   ... Playwright が無い環境ではブラウザのテストを省く
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8097}; APORT=${APORT:-8098}; LPORT=${LPORT:-8092}; DATA=$(mktemp -d); ADATA=$(mktemp -d); OUT=$(mktemp -d)
export PM_DATA_DIR=$DATA BASE=http://127.0.0.1:$PORT OUT
export PM_DEV_OPEN=1   # 開発用: ループバックのときだけ認証を省略(認証のテストは別サーバー・別設定で行う)
php -d upload_max_filesize=6M -d post_max_size=8M -S 127.0.0.1:$PORT -t . >"$OUT/php.log" 2>&1 &
SRV=$!
# 認証つきサーバー(DEV_OPENなし・パスワード設定済み): ログインの画面テスト用
APASS="e2e-login-password-1"; ACFG="$ADATA/config.php"
php -r 'file_put_contents($argv[1], "<?php return " . var_export(["password_hash" => password_hash($argv[2], PASSWORD_DEFAULT), "secret" => bin2hex(random_bytes(32)), "session_hours" => 12], true) . ";");' "$ACFG" "$APASS"
PM_DEV_OPEN= PM_CONFIG_FILE="$ACFG" PM_DATA_DIR="$ADATA/data" php -S 127.0.0.1:$APORT -t . >"$OUT/php-auth.log" 2>&1 &
ASRV=$!
# PHPなしの静的サーバー: ブラウザ保存モード(既定)がサーバー無しで動くことの確認用
python3 -m http.server $LPORT --bind 127.0.0.1 >"$OUT/static.log" 2>&1 &
LSRV=$!
cleanup() { kill $SRV $ASRV $LSRV 2>/dev/null; rm -rf "$DATA" "$ADATA" uploads/t-* uploads/demo; }
trap cleanup EXIT
sleep 1
FAIL=0
fresh() { rm -rf "$DATA/demo" uploads/demo; } # 画面テストは毎回、初期状態のゲームから始める(互いに干渉させない)
run() { echo "== $1"; shift; case "$1" in bash) fresh;; esac; "$@" || { echo "!! 失敗: $*"; FAIL=1; }; }
run "JS↔PHP 検証の一致"            tests/parity.sh
run "エンジン等価(元プロトタイプ)"  node tests/engine_equivalence.mjs
run "テンプレート(検証・クリア可能)" node tests/templates.mjs
run "GLB検証のJS↔PHP一致"          node tests/parity_glb.mjs
run "履歴の間引き"                  php tests/prune_test.php
run "認証API"                       node tests/api_auth.mjs
run "ステージ編集の純粋関数"        node tests/level_ops.mjs
run "アップロードAPI"               node tests/api_assets.mjs
# 画面テスト: 出力を保存し、"ok":true(または ok を持たないものは "errs":[])なら成功。失敗時は出力を表示する
e2e() { # $1=表示名 $2=スクリプト名 [ENV=値 ...]
  local label=$1 script=$2; shift 2
  echo "== 画面: $label"; fresh
  env "$@" node "tests/$script.cjs" >"$OUT/$script.out" 2>&1
  if grep -q '"ok":true' "$OUT/$script.out" || { ! grep -q '"ok":' "$OUT/$script.out" && grep -Eq '"errs": *\[\]' "$OUT/$script.out"; }; then return 0; fi
  echo "!! 失敗: $script"; tail -c 1500 "$OUT/$script.out"; FAIL=1
}
if [ -z "${NO_E2E:-}" ]; then
  export NODE_PATH=$(npm root -g)
  e2e "e2e_local(ブラウザ保存・PHPなし)" e2e_local LOCAL_BASE=http://127.0.0.1:$LPORT
  e2e "e2e_editor(ナビゲーション・レイアウト)" e2e_editor
  e2e "e2e_login(ログイン)" e2e_login AUTH_BASE=http://127.0.0.1:$APORT AUTH_PASSWORD="$APASS"
  for t in e2e_stage e2e_dashboard e2e_3d e2e_no_webgl e2e_models e2e_broken_glb e2e_assets; do e2e "$t" "$t"; done
fi
[ $FAIL = 0 ] && echo "すべて成功" || echo "失敗あり"
exit $FAIL
