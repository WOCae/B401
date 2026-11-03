<?php
declare(strict_types=1);
// 初回設定ページ: 管理者パスワードを決めて api/config.php を作る(シェルが無くても設定できる)。
//  1. api/ フォルダに setup.key という名前のファイルをFTP等で置く(中身は推測されにくい16文字以上の文字列)
//  2. このページを開き、setup.key の中身とパスワードを入力
//  3. 完了すると config.php ができ、setup.key は削除される。以後このページは使えない。
// FTPでファイルを置ける人だけが設定できる(=サイトの持ち主であることの証明)。
require __DIR__ . '/lib/bootstrap.php';

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
header('Cache-Control: no-store');
header('X-Frame-Options: DENY');

$e = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$page = function (string $body, int $status = 200) use ($e): never {
    http_response_code($status);
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>初回設定</title>'
        . '<style>body{font:15px/1.7 system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#16202c}input{font:inherit;padding:6px;width:100%;box-sizing:border-box;margin:2px 0 10px}'
        . 'button{font:inherit;padding:8px 16px}code,pre{background:#eef1f5;padding:2px 6px;border-radius:4px}pre{padding:10px;overflow:auto}.err{color:#b84a12;font-weight:600}</style>'
        . '<h1>初回設定</h1>' . $body;
    exit;
};

$cfg = PM\config_path();
$keyFile = dirname($cfg) . '/setup.key';

if (is_file($cfg)) $page('<p>すでに設定済みです。パスワードを変更するには、<code>api/config.php</code> を削除してから、もう一度 <code>setup.key</code> を置いてください。</p>', 403);

$key = is_file($keyFile) ? trim((string)file_get_contents($keyFile)) : '';
if (strlen($key) < 16) {
    $page('<p>まず <code>api/</code> フォルダに <b>setup.key</b> というファイルを置いてください(中身は推測されにくい16文字以上の文字列。例: ランダムな英数字)。</p>'
        . '<p>置いたらこのページを再読み込みします。設定が終わると setup.key は自動で削除されます。</p>', 403);
}

$err = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $k = (string)($_POST['key'] ?? '');
    $p1 = (string)($_POST['password'] ?? '');
    $p2 = (string)($_POST['password2'] ?? '');
    if (!hash_equals($key, $k)) { usleep(700000); $err = 'setup.key の内容が違います'; }
    elseif (strlen($p1) < 10) $err = 'パスワードは10文字以上にしてください';
    elseif (strlen($p1) > 200) $err = 'パスワードが長すぎます';
    elseif ($p1 !== $p2) $err = '確認用のパスワードが一致しません';
    else {
        $conf = ['password_hash' => password_hash($p1, PASSWORD_DEFAULT), 'secret' => bin2hex(random_bytes(32)), 'session_hours' => 12];
        $php = "<?php\n// 自動生成(api/setup.php)。HTTPから直接開いても何も表示されない。\nreturn " . var_export($conf, true) . ";\n";
        if (@file_put_contents($cfg, $php, LOCK_EX) !== false) {
            @chmod($cfg, 0600);
            @unlink($keyFile);
            $page('<p>設定しました。<code>api/config.php</code> を作成し、<code>setup.key</code> を削除しました。</p><p><a href="../index.html">エディタを開いてログイン</a></p>');
        }
        $page('<p class="err">config.php を自動で書き込めませんでした(フォルダの書き込み権限がありません)。</p>'
            . '<p>次の内容で <code>api/config.php</code> を作成してアップロードしてください(このページを閉じると再表示されません)。</p><pre>' . $e($php) . '</pre>');
    }
}
$page(($err !== '' ? '<p class="err">' . $e($err) . '</p>' : '')
    . '<form method="post"><label>setup.key の中身<input name="key" type="password" autocomplete="off" required></label>'
    . '<label>管理者パスワード(10文字以上)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>'
    . '<label>パスワード(確認)<input name="password2" type="password" autocomplete="new-password" minlength="10" required></label>'
    . '<button type="submit">設定する</button></form>');
