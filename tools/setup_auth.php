<?php
// シェルがある環境用: php tools/setup_auth.php  → パスワードを入力して api/config.php を作る
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$cfg = getenv('PM_CONFIG_FILE') ?: dirname(__DIR__) . '/api/config.php';
if (is_file($cfg)) { fwrite(STDERR, "既に存在します: $cfg(変更するなら削除してから)\n"); exit(1); }
fwrite(STDOUT, "管理者パスワード(10文字以上): ");
system('stty -echo 2>/dev/null'); $p = trim((string)fgets(STDIN)); system('stty echo 2>/dev/null'); fwrite(STDOUT, "\n");
if (strlen($p) < 10) { fwrite(STDERR, "10文字以上にしてください\n"); exit(1); }
$conf = ['password_hash' => password_hash($p, PASSWORD_DEFAULT), 'secret' => bin2hex(random_bytes(32)), 'session_hours' => 12];
file_put_contents($cfg, "<?php\nreturn " . var_export($conf, true) . ";\n", LOCK_EX); chmod($cfg, 0600);
fwrite(STDOUT, "作成しました: $cfg\n");
