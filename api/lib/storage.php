<?php
declare(strict_types=1);
// ゲームごとのフォルダにJSONファイルで保存する。
//   games/<id>/game.json          現在のゲーム定義(JSONのみ)
//   games/<id>/state.json         {"version":現在, "max":最大版}
//   games/<id>/history/NNNNNN.json 履歴 {version,parent,ts,label,game}
//   games/<id>/proposals/<pid>.json AIや規則ベースの変更提案
namespace PM;

const ID_RE = '/\A[a-z0-9][a-z0-9_-]{0,39}\z/';

function data_dir(): string
{
    $d = getenv('PM_DATA_DIR');
    return ($d !== false && $d !== '') ? rtrim($d, '/') : PM_ROOT . '/games';
}

function check_id(mixed $id, string $what = 'game_id'): string
{
    if (!is_string($id) || preg_match(ID_RE, $id) !== 1) {
        throw new ToolError("{$what} は英小文字・数字・-・_ の40文字以内にしてください", 'bad_id');
    }
    return $id;
}

function game_dir(string $id): string { return data_dir() . '/' . check_id($id); }

function read_json(string $path): array
{
    $raw = @file_get_contents($path);
    if ($raw === false) throw new ToolError('データが見つかりません', 'not_found', 404);
    $d = json_decode($raw, true);
    if (!is_array($d)) throw new ToolError('保存データが壊れています', 'corrupt', 500);
    return $d;
}

function write_json(string $path, mixed $data): void
{
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
    if (file_put_contents($tmp, $json) === false || !rename($tmp, $path)) {
        @unlink($tmp);
        throw new ToolError('保存に失敗しました', 'write_failed', 500);
    }
}

/** ゲーム単位の排他ロック */
function with_lock(string $id, callable $fn): mixed
{
    $dir = game_dir($id);
    if (!is_dir($dir)) throw new ToolError("ゲーム {$id} が見つかりません", 'not_found', 404);
    $fh = fopen($dir . '/.lock', 'c');
    if ($fh === false || !flock($fh, LOCK_EX)) throw new ToolError('ロックに失敗しました', 'lock_failed', 500);
    try { return $fn(); } finally { flock($fh, LOCK_UN); fclose($fh); }
}

function game_state(string $id): array { return read_json(game_dir($id) . '/state.json'); }

function history_path(string $id, int $v): string { return sprintf('%s/history/%06d.json', game_dir($id), $v); }

/** 新しい版として保存する(呼び出し側でロックを取ること)。$game は検証済み */
function commit_locked(string $id, array $game, string $label, ?int $baseVersion): array
{
    $st = game_state($id);
    if ($baseVersion !== null && $baseVersion !== $st['version']) {
        throw new ToolError('他の変更と競合しました。再読み込みしてください', 'conflict', 409, ['current_version' => $st['version']]);
    }
    $v = $st['max'] + 1;
    $ts = gmdate('c');
    write_json(history_path($id, $v), ['version' => $v, 'parent' => $st['version'], 'ts' => $ts, 'label' => $label, 'game' => $game]);
    write_json(game_dir($id) . '/game.json', $game);
    write_json(game_dir($id) . '/state.json', ['version' => $v, 'max' => $v, 'updated' => $ts]);
    try { prune_history($id, $v, $v); } catch (\Throwable $e) { error_log('[platformer-maker] prune: ' . $e->getMessage()); } // 掃除の失敗で保存を失敗させない
    return ['version' => $v, 'updated' => $ts];
}

/**
 * 履歴の間引き(commit のたびに呼ぶが、上限を超えたときだけ動く)。
 * 残すもの: 現在の版から親をたどった経路(「元に戻す」で戻れる範囲)の新しい方から keep 個、
 *           と、番号が新しい recent 個。それ以外(古い版・放棄された枝)は削除する。
 * 経路の一番古い版は parent=0 にして、それより前へは戻れないことを明示する。
 * ついでに処理済み/古い提案ファイルも片付ける。
 */
function prune_history(string $id, int $current, int $max): void
{
    $H = schema_load()['history'];
    $dir = game_dir($id) . '/history';
    $files = glob($dir . '/*.json') ?: [];
    if (count($files) > $H['keep'] + $H['slack']) {
        $keep = [];
        $v = $current;
        $chain = [];
        while ($v > 0 && count($chain) < $H['keep']) {
            $p = history_path($id, $v);
            if (!is_file($p)) break;
            $chain[] = $v;
            $v = (int)read_json($p)['parent'];
        }
        foreach ($chain as $c) $keep[$c] = true;
        for ($r = $max; $r > $max - $H['recent'] && $r > 0; $r--) $keep[$r] = true;
        foreach ($files as $f) {
            $n = (int)basename($f, '.json');
            if (!isset($keep[$n])) @unlink($f);
        }
        $oldest = $chain ? end($chain) : null;
        if ($oldest !== null) {
            $p = history_path($id, $oldest);
            $h = read_json($p);
            if ((int)$h['parent'] !== 0 && !isset($keep[(int)$h['parent']])) { $h['parent'] = 0; write_json($p, $h); }
        }
    }
    // 提案ファイル: 処理済みは14日、未処理は3日で削除
    foreach (glob(game_dir($id) . '/proposals/*.json') ?: [] as $f) {
        $age = time() - (int)filemtime($f);
        $st = (read_json($f)['status'] ?? 'pending');
        if ($age > ($st === 'pending' ? $H['pendingProposalDays'] : $H['proposalDays']) * 86400) @unlink($f);
    }
}
