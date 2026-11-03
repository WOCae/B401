<?php
// 履歴の間引きのテスト: php tests/prune_test.php
require __DIR__ . '/../api/lib/bootstrap.php';
use function PM\{tool_create_game, tool_save_game, tool_undo_game, tool_list_history, schema_load, game_dir, read_json};
$tmp = sys_get_temp_dir() . '/pm-prune-' . bin2hex(random_bytes(3));
putenv("PM_DATA_DIR=$tmp");
$pass = 0; $fail = 0;
$ok = function (string $n, bool $c, string $x = '') use (&$pass, &$fail) { $c ? $pass++ : $fail++; echo ($c ? '  ok  ' : '  NG  ') . $n . ($c ? '' : "  $x") . "\n"; };
$H = schema_load()['history'];
tool_create_game(['game_id' => 'p1']);
$g = read_json(game_dir('p1') . '/game.json');
$ver = 1;
$N = 400;
for ($i = 0; $i < $N; $i++) {
    $g['physics']['gravity'] = 800 + ($i % 50) * 10;
    $ver = tool_save_game(['game_id' => 'p1', 'game' => $g, 'base_version' => $ver, 'label' => "s$i"])['version'];
    if ($i === 150) { // 途中で何度か戻って枝分かれ(放棄された枝)を作る
        for ($k = 0; $k < 5; $k++) $ver = tool_undo_game(['game_id' => 'p1', 'base_version' => $ver])['version'];
    }
}
$count = count(glob(game_dir('p1') . '/history/*.json'));
$ok("履歴ファイルが上限(keep+slack+recent)を超えない", $count <= $H['keep'] + $H['slack'] + $H['recent'], (string)$count);
$ok("元に戻れる分は残っている(keep以上)", $count >= $H['keep'], (string)$count);
$ok("ゲーム定義は壊れていない", read_json(game_dir('p1') . '/game.json')['physics']['gravity'] >= 800);
// 元に戻せる回数を数える
$undo = 0;
while (true) {
    try { $ver = tool_undo_game(['game_id' => 'p1', 'base_version' => $ver])['version']; $undo++; } catch (PM\ToolError $e) { $ok("最後は no_more_undo で止まる", $e->errCode === 'no_more_undo', $e->errCode); break; }
    if ($undo > 1000) { $ok("無限に戻れない", false); break; }
}
$ok("元に戻せる回数が keep 以上", $undo >= $H['keep'] - 1, (string)$undo);
$ok("元に戻せる回数が keep+slack 以下", $undo <= $H['keep'] + $H['slack'], (string)$undo);
$list = tool_list_history(['game_id' => 'p1', 'limit' => 200]);
$ok("履歴一覧が取得できる", count($list['history']) > 0);
// 提案の掃除
$d = game_dir('p1') . '/proposals'; @mkdir($d);
file_put_contents("$d/aaaaaaaaaaaaaaaa.json", json_encode(['id' => 'aaaaaaaaaaaaaaaa', 'status' => 'applied'])); touch("$d/aaaaaaaaaaaaaaaa.json", time() - 20 * 86400);
file_put_contents("$d/bbbbbbbbbbbbbbbb.json", json_encode(['id' => 'bbbbbbbbbbbbbbbb', 'status' => 'pending'])); touch("$d/bbbbbbbbbbbbbbbb.json", time() - 1 * 86400);
file_put_contents("$d/cccccccccccccccc.json", json_encode(['id' => 'cccccccccccccccc', 'status' => 'pending'])); touch("$d/cccccccccccccccc.json", time() - 5 * 86400);
$g['physics']['gravity'] = 999; $ver = read_json(game_dir('p1') . '/state.json')['version'];
tool_save_game(['game_id' => 'p1', 'game' => $g, 'base_version' => $ver]);
$ok("古い処理済みの提案は削除される", !is_file("$d/aaaaaaaaaaaaaaaa.json"));
$ok("新しい未処理の提案は残る", is_file("$d/bbbbbbbbbbbbbbbb.json"));
$ok("3日を過ぎた未処理の提案は削除される", !is_file("$d/cccccccccccccccc.json"));
exec('rm -rf ' . escapeshellarg($tmp));
echo "\n$pass 件成功 / $fail 件失敗\n"; exit($fail ? 1 : 0);
