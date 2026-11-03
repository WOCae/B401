// 公開後の確認: node tools/check_deploy.mjs https://example.com/gameGeneB401/
// データ・設定ファイルが外から見えないか、未ログインで書き込めないか等を調べる(読み取りのみ。何も書き込まない)。
const base = (process.argv[2] || "").replace(/\/?$/, "/");
if (!/^https?:\/\//.test(base)) { console.error("使い方: node tools/check_deploy.mjs https://example.com/path/"); process.exit(2); }
let bad = 0, warn = 0;
const row = (ok, name, detail = "", soft = false) => { console.log(`${ok ? "  ok  " : soft ? " WARN " : "  NG  "} ${name}${ok ? "" : "  " + detail}`); if (!ok) { soft ? warn++ : bad++; } };
const get = async (p, init) => { try { const r = await fetch(base + p, { redirect: "manual", ...init }); return { s: r.status, t: await r.text(), h: r.headers }; } catch (e) { return { s: 0, t: "", err: e.message }; } };
const hidden = r => r.s === 403 || r.s === 404 || r.s === 401;

let r = await get("index.html"); row(r.s === 200, "index.html が開ける", `status ${r.s}`);
r = await get("api/index.php?tool=get_schema"); row(r.s === 200 && r.t.includes('"fields"'), "API が動く(get_schema)", `status ${r.s}`);
r = await get("api/index.php?tool=auth_status"); const st = r.s === 200 ? JSON.parse(r.t).result : {};
row(st.configured === true, "管理者パスワードが設定済み", "未設定です。README の「認証の設定」を参照", false);
row(st.dev_open !== true, "開発モード(PM_DEV_OPEN)が無効", "PM_DEV_OPEN が有効です。本番では外してください");
r = await get("api/index.php?tool=create_game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game_id: "check-deploy-zz" }) });
row(r.s === 401 || r.s === 403, "未ログインでは書き込めない", `status ${r.s} ${r.t.slice(0, 80)}`);
for (const [p, label] of [["games/demo/game.json", "ゲームデータ(games/)がHTTPで読めない"], ["games/demo/state.json", "state.json がHTTPで読めない"], ["games/.auth-attempts.json", "ログイン試行の記録がHTTPで読めない"],
  ["api/config.php", "api/config.php の中身が見えない"], ["api/setup.key", "api/setup.key が見えない"], ["api/.user.ini", ".user.ini が見えない"], ["api/lib/tools.php", "api/lib/ のソースが見えない"], ["api/lib/auth.php", "api/lib/auth.php のソースが見えない"]]) {
  r = await get(p); const leaked = r.s === 200 && r.t.length > 0 && !r.t.trimStart().startsWith("<!doctype");
  row(!leaked, label, `status ${r.s}(内容が取得できてしまいます。.htaccess が効いているか、nginxなら設定を確認)`);
}
r = await get("api/setup.php"); row(r.s === 403 || r.s === 404, "設定済みなら setup.php は使えない", `status ${r.s}(setup.key が残っていないか確認)`);
r = await get("uploads/"); row(r.s !== 200 || !r.t.includes("Index of"), "uploads/ の一覧が表示されない", "ディレクトリ一覧が見えます(Options -Indexes)", true);
r = await get("uploads/.htaccess"); row(r.s !== 200, "uploads/.htaccess が見えない", `status ${r.s}`, true);
r = await get("uploads/probe-test.php"); row(!(r.s === 200 && r.t.includes("<?php")), "uploads/ の .php のソースが見えない", "PHPが実行されず中身が見えます");
r = await get("vendor/three/three.module.js"); row(r.s === 200, "Three.js が配信される", `status ${r.s}`);
r = await get("assets/samples/player.glb"); row(r.s === 200, "サンプルGLBが配信される", `status ${r.s}`, true);
const sec = ["x-content-type-options"]; r = await get("api/index.php?tool=get_schema"); row(sec.every(h => r.h && r.h.get(h)), "セキュリティヘッダ(nosniff)", "付いていません", true);
console.log(`\n${bad ? "要対応: " + bad + " 件" : "重大な問題なし"}${warn ? "(注意 " + warn + " 件)" : ""}`); process.exit(bad ? 1 : 0);
