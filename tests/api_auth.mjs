// 認証のテスト(専用のPHPサーバーを自分で起動する): ログイン・Cookie・改ざん・期限切れ・試行制限・未設定時・初回設定ページ
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { (c ? pass++ : fail++); console.log((c ? "  ok  " : "  NG  ") + n + (c ? "" : "  " + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function server(port, env) {
  const p = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", ROOT], { env: { ...process.env, ...env }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/index.html`); return p; } catch { await sleep(100); } }
  throw new Error("server did not start");
}
const tmp = mkdtempSync(join(tmpdir(), "pm-auth-"));
const PASSWORD = "correct-horse-battery";
const hash = execFileSync("php", ["-r", `echo password_hash(${JSON.stringify(PASSWORD)}, PASSWORD_DEFAULT);`]).toString();
const SECRET = "s".repeat(64);
const cfgFile = join(tmp, "config.php");
execFileSync("php", ["-r", `file_put_contents($argv[1], "<?php return " . var_export(["password_hash" => $argv[2], "secret" => $argv[3], "session_hours" => 12], true) . ";");`, cfgFile, hash, SECRET]);
const dataDir = join(tmp, "data");
const api = (port, tool, { body, cookie, method } = {}) => fetch(`http://127.0.0.1:${port}/api/index.php?tool=${tool}`, {
  method: method || (body !== undefined ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, headers: r.headers, ...(await r.json()) }));
const cookieOf = r => (r.headers.get("set-cookie") || "").split(";")[0];
const token = exp => { const p = `${exp}.${"ab".repeat(8)}`, key = createHash("sha256").update(`${SECRET}|${hash}`).digest(); return `pm_auth=${p}.${createHmac("sha256", key).update(p).digest("hex")}`; };

const servers = [];
try {
  // ---- 設定済み・本番相当(DEV_OPENなし) ----
  const P = 8093; servers.push(await server(P, { PM_CONFIG_FILE: cfgFile, PM_DATA_DIR: dataDir, PM_DEV_OPEN: "" }));
  let r = await api(P, "auth_status"); ok("未ログインの状態が分かる", r.ok && !r.result.authenticated && r.result.configured && !r.result.dev_open, JSON.stringify(r));
  r = await api(P, "list_games"); ok("閲覧系は未ログインでも使える", r.ok === true);
  r = await api(P, "create_game", { body: { game_id: "a1" } }); ok("書き込みは未ログインだと401", r.status === 401 && r.error.code === "unauthorized", JSON.stringify(r));
  r = await api(P, "save_game", { body: { game_id: "a1", game: {} } }); ok("save_game も401", r.status === 401);
  r = await api(P, "upload_asset", { method: "POST", body: {} }); ok("アップロードも拒否", r.ok === false && [401, 403].includes(r.status));
  r = await api(P, "login", { body: { password: "wrong" } }); ok("間違ったパスワードは401", r.status === 401 && r.error.code === "bad_password");
  r = await api(P, "login", { body: { password: PASSWORD } });
  const ck = cookieOf(r), raw = r.headers.get("set-cookie") || "";
  ok("正しいパスワードでログインでき、Cookieが発行される", r.ok && ck.startsWith("pm_auth="), JSON.stringify(r));
  ok("CookieはHttpOnly・SameSite=Strict", /HttpOnly/i.test(raw) && /SameSite=Strict/i.test(raw), raw);
  r = await api(P, "auth_status", { cookie: ck }); ok("Cookieでログイン状態になる", r.result.authenticated === true);
  r = await api(P, "create_game", { body: { game_id: "a1" }, cookie: ck }); ok("ログイン後は書き込める", r.ok === true, JSON.stringify(r));
  const bad = ck.slice(0, -3) + (ck.endsWith("aaa") ? "bbb" : "aaa");
  r = await api(P, "save_game", { body: { game_id: "a1", game: {} }, cookie: bad }); ok("署名を改ざんしたCookieは拒否", r.status === 401);
  const forged = ck.replace(/^pm_auth=\d+/, "pm_auth=" + (Math.floor(Date.now() / 1000) + 999999));
  r = await api(P, "create_game", { body: { game_id: "a2" }, cookie: forged }); ok("期限を書き換えたCookieは拒否", r.status === 401);
  r = await api(P, "create_game", { body: { game_id: "a3" }, cookie: token(Math.floor(Date.now() / 1000) - 10) }); ok("期限切れのCookieは拒否", r.status === 401);
  r = await api(P, "create_game", { body: { game_id: "a4" }, cookie: token(Math.floor(Date.now() / 1000) + 600) }); ok("(確認)同じ方式で作った有効なCookieは通る", r.ok === true, JSON.stringify(r));
  r = await api(P, "create_game", { body: { game_id: "a5" }, cookie: "pm_auth=junk" }); ok("でたらめなCookieは拒否", r.status === 401);
  r = await api(P, "logout", { body: {} }); ok("ログアウトでCookieが消される", /pm_auth=;|pm_auth=deleted|Max-Age=0|expires=Thu, 01 Jan 1970/i.test(r.headers.get("set-cookie") || ""), r.headers.get("set-cookie"));
  r = await api(P, "login", { method: "GET" }); ok("loginはGETで呼べない", r.status === 405);
  // 試行回数の制限(5回失敗で、正しいパスワードでも429)
  for (let i = 0; i < 5; i++) await api(P, "login", { body: { password: "nope" + i } });
  r = await api(P, "login", { body: { password: PASSWORD } }); ok("失敗が続くとロックされる(429)", r.status === 429 && r.error.code === "too_many_attempts", JSON.stringify(r));
  ok("ロック中は正しいパスワードでもCookieを出さない", cookieOf(r) === "");
  rmSync(join(dataDir, ".auth-attempts.json"), { force: true });

  // ---- 未設定(config無し)・DEV_OPENなし: 書き込みは全て拒否 ----
  const Q = 8094; servers.push(await server(Q, { PM_CONFIG_FILE: join(tmp, "none.php"), PM_DATA_DIR: join(tmp, "data2"), PM_DEV_OPEN: "" }));
  r = await api(Q, "create_game", { body: { game_id: "b1" } }); ok("未設定のときは書き込みを拒否(403)", r.status === 403 && r.error.code === "auth_not_configured", JSON.stringify(r));
  r = await api(Q, "login", { body: { password: "x" } }); ok("未設定ではログインもできない", r.status === 403);
  r = await api(Q, "list_games"); ok("未設定でも閲覧はできる", r.ok === true);
  // ---- 開発モード(PM_DEV_OPEN=1 かつ ループバック) ----
  const D = 8095; servers.push(await server(D, { PM_CONFIG_FILE: join(tmp, "none.php"), PM_DATA_DIR: join(tmp, "data3"), PM_DEV_OPEN: "1" }));
  r = await api(D, "create_game", { body: { game_id: "c1" } }); ok("開発モード(ローカルのみ)では認証を省略できる", r.ok === true, JSON.stringify(r));
  r = await api(D, "auth_status"); ok("開発モードが表示される", r.result.dev_open === true);

  // ---- 初回設定ページ ----
  const S = 8096, newCfg = join(tmp, "new", "config.php"); execFileSync("mkdir", ["-p", join(tmp, "new")]);
  servers.push(await server(S, { PM_CONFIG_FILE: newCfg, PM_DATA_DIR: join(tmp, "data4"), PM_DEV_OPEN: "" }));
  const setup = (body) => fetch(`http://127.0.0.1:${S}/api/setup.php`, body ? { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) } : {});
  let res = await setup(); let txt = await res.text(); ok("setup.key が無いと設定できない(案内を表示)", res.status === 403 && txt.includes("setup.key"));
  writeFileSync(join(tmp, "new", "setup.key"), "my-secret-setup-key-123456");
  res = await setup(); ok("setup.key があるとフォームが出る", res.status === 200 && txt !== "" && (await res.text()).includes("<form"));
  res = await setup({ key: "wrong-key-wrong-key", password: "longenoughpassword", password2: "longenoughpassword" }); txt = await res.text();
  ok("鍵が違うと設定できない", txt.includes("違います") && !existsSync(newCfg));
  res = await setup({ key: "my-secret-setup-key-123456", password: "short", password2: "short" }); txt = await res.text(); ok("短いパスワードは拒否", txt.includes("10文字以上") && !existsSync(newCfg));
  res = await setup({ key: "my-secret-setup-key-123456", password: "longenoughpassword", password2: "different-password" }); txt = await res.text(); ok("確認が一致しないと拒否", txt.includes("一致しません") && !existsSync(newCfg));
  res = await setup({ key: "my-secret-setup-key-123456", password: "longenoughpassword", password2: "longenoughpassword" }); txt = await res.text();
  ok("正しく設定でき、config.phpができて setup.key が消える", res.status === 200 && existsSync(newCfg) && !existsSync(join(tmp, "new", "setup.key")), txt.slice(0, 300));
  ok("config.php にパスワードの平文は入らない(ハッシュのみ)", !readFileSync(newCfg, "utf8").includes("longenoughpassword") && readFileSync(newCfg, "utf8").includes("$2y$") || readFileSync(newCfg, "utf8").includes("$argon"));
  res = await setup(); ok("設定後はこのページは使えない(403)", res.status === 403);
  r = await api(S, "login", { body: { password: "longenoughpassword" } }); ok("設定したパスワードでログインできる", r.ok === true, JSON.stringify(r));
  r = await api(S, "login", { body: { password: PASSWORD } }); ok("別のパスワードではログインできない", r.status === 401);
} finally { servers.forEach(s => s.kill()); rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} 件成功 / ${fail} 件失敗`); process.exit(fail ? 1 : 0);
