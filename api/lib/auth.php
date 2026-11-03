<?php
declare(strict_types=1);
// 認証(管理者パスワード1つ)。DB・PHPセッション不要の「署名つきCookie」方式。
//  - 設定: api/config.php(password_hash と secret)。未設定の間は書き込み系ツールは全て拒否(閲覧は可)。
//  - Cookie: pm_auth = <期限>.<乱数>.<HMAC-SHA256>。HttpOnly / SameSite=Strict / HTTPSならSecure。
//    署名鍵は secret + password_hash から作るので、パスワードを変えると既存のログインは全て無効になる。
//  - ログイン試行は IP ごとに 10分で5回まで(失敗時は少し待たせる)。
//  - 開発用: 環境変数 PM_DEV_OPEN=1 かつ接続元がループバック(127.0.0.1/::1)のときだけ認証を省略(本番では効かない)。
namespace PM;

const AUTH_COOKIE = 'pm_auth';

function config_path(): string
{
    $p = getenv('PM_CONFIG_FILE');
    return ($p !== false && $p !== '') ? $p : PM_ROOT . '/api/config.php';
}

function config(): array
{
    static $c = null;
    if ($c === null) {
        $f = config_path();
        $v = is_file($f) ? (static function () use ($f) { return include $f; })() : [];
        $c = is_array($v) ? $v : [];
    }
    return $c;
}

function auth_configured(): bool
{
    $c = config();
    return is_string($c['password_hash'] ?? null) && $c['password_hash'] !== '' && is_string($c['secret'] ?? null) && strlen($c['secret']) >= 32;
}

function dev_open(): bool
{
    return getenv('PM_DEV_OPEN') === '1' && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
}

function session_seconds(): int { return max(1, (int)(config()['session_hours'] ?? 12)) * 3600; }

function auth_key(): string
{
    $c = config();
    return hash('sha256', $c['secret'] . '|' . $c['password_hash'], true);
}

function make_token(int $exp): string
{
    $p = $exp . '.' . bin2hex(random_bytes(8));
    return $p . '.' . hash_hmac('sha256', $p, auth_key());
}

function verify_token(string $t): bool
{
    if (!auth_configured()) return false;
    $parts = explode('.', $t);
    if (count($parts) !== 3 || !ctype_digit($parts[0])) return false;
    $p = $parts[0] . '.' . $parts[1];
    if (!hash_equals(hash_hmac('sha256', $p, auth_key()), $parts[2])) return false;
    return (int)$parts[0] > time();
}

function is_authenticated(): bool
{
    if (dev_open()) return true;
    $t = $_COOKIE[AUTH_COOKIE] ?? '';
    return is_string($t) && $t !== '' && verify_token($t);
}

function is_https(): bool
{
    return (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off') || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/** Cookieを有効にするパス(アプリのフォルダ。例 /gameGeneB401/)。同じドメインの他のページには送らない */
function cookie_path(): string
{
    $dir = dirname(dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api/index.php')));
    return ($dir === '/' || $dir === '\\' || $dir === '.') ? '/' : rtrim(str_replace('\\', '/', $dir), '/') . '/';
}

function set_auth_cookie(string $value, int $expires): void
{
    setcookie(AUTH_COOKIE, $value, ['expires' => $expires, 'path' => cookie_path(), 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Strict']);
}

/** 試行回数の制限。戻り値: 試行を続けてよいか */
function throttle(string $ip, ?bool $success): bool
{
    $dir = data_dir();
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $file = $dir . '/.auth-attempts.json';
    $fh = @fopen($file, 'c+');
    if (!$fh) return true; // 書けない環境でも認証自体は動かす
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $d = $raw ? (json_decode($raw, true) ?: []) : [];
    $now = time();
    foreach ($d as $k => $list) { $d[$k] = array_values(array_filter($list, fn($t) => $t > $now - 600)); if (!$d[$k]) unset($d[$k]); }
    $mine = $d[$ip] ?? [];
    $all = array_sum(array_map('count', $d));
    $allowed = count($mine) < 5 && $all < 40;
    if ($success === false) { $mine[] = $now; $d[$ip] = $mine; }
    if ($success === true) unset($d[$ip]);
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($d));
    flock($fh, LOCK_UN); fclose($fh);
    return $allowed;
}

function auth_status(): array
{
    return ['authenticated' => is_authenticated(), 'configured' => auth_configured(), 'dev_open' => dev_open()];
}

function auth_login(mixed $password): array
{
    if (!auth_configured()) throw new ToolError('管理者パスワードが未設定です。README の「認証の設定」を参照してください', 'auth_not_configured', 403);
    if (!is_string($password) || $password === '' || strlen($password) > 200) throw new ToolError('パスワードを入力してください', 'bad_request');
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if (!throttle($ip, null)) throw new ToolError('ログインの試行が多すぎます。しばらくしてからやり直してください', 'too_many_attempts', 429);
    if (!password_verify($password, config()['password_hash'])) {
        throttle($ip, false);
        usleep(700000);
        throw new ToolError('パスワードが違います', 'bad_password', 401);
    }
    throttle($ip, true);
    $exp = time() + session_seconds();
    set_auth_cookie(make_token($exp), $exp);
    return ['authenticated' => true, 'expires' => $exp];
}

function auth_logout(): array
{
    set_auth_cookie('', time() - 3600);
    return ['authenticated' => false];
}
