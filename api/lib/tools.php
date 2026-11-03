<?php
declare(strict_types=1);
// UIから独立したツール関数。将来MCPツールにそのまま包める。
// 各関数は連想配列の引数を受け取り、JSON化できる配列を返す。失敗は ToolError。
// registry() の ai フラグ: MCP化するときAIに公開してよいか(適用系は false = 人だけ)。
namespace PM;

function registry(): array
{
    return [
        'get_schema'    => ['fn' => 'tool_get_schema',    'write' => false, 'ai' => true],
        'list_games'    => ['fn' => 'tool_list_games',    'write' => false, 'ai' => true],
        'get_game'      => ['fn' => 'tool_get_game',      'write' => false, 'ai' => true],
        'list_history'  => ['fn' => 'tool_list_history',  'write' => false, 'ai' => true],
        'validate_game' => ['fn' => 'tool_validate_game', 'write' => false, 'ai' => true],
        'propose_patch' => ['fn' => 'tool_propose_patch', 'write' => true,  'ai' => true],
        'create_game'   => ['fn' => 'tool_create_game',   'write' => true,  'ai' => false],
        'save_game'     => ['fn' => 'tool_save_game',     'write' => true,  'ai' => false],
        'apply_patch'   => ['fn' => 'tool_apply_patch',   'write' => true,  'ai' => false],
        'discard_patch' => ['fn' => 'tool_discard_patch', 'write' => true,  'ai' => false],
        'undo_game'     => ['fn' => 'tool_undo_game',     'write' => true,  'ai' => false],
    ];
}

function tool_get_schema(array $a): array { return schema_load(); }

function tool_list_games(array $a): array
{
    $out = [];
    $base = data_dir();
    foreach (is_dir($base) ? scandir($base) : [] as $id) {
        if (preg_match(ID_RE, $id) !== 1 || !is_file("{$base}/{$id}/game.json")) continue;
        $g = read_json("{$base}/{$id}/game.json");
        $st = read_json("{$base}/{$id}/state.json");
        $out[] = ['game_id' => $id, 'title' => $g['meta']['title'] ?? $id, 'version' => $st['version'], 'updated' => $st['updated'] ?? null];
    }
    return ['games' => $out];
}

function load_game(string $id): array
{
    $dir = game_dir($id);
    if (!is_file($dir . '/game.json')) throw new ToolError("ゲーム {$id} が見つかりません", 'not_found', 404);
    $st = game_state($id);
    return ['game_id' => $id, 'version' => $st['version'], 'updated' => $st['updated'] ?? null, 'game' => read_json($dir . '/game.json')];
}

function tool_get_game(array $a): array { return load_game(check_id($a['game_id'] ?? null)); }

function checked(mixed $game): array
{
    $r = validate_game_def($game, schema_load());
    if (!$r['ok']) throw new ToolError('ゲーム定義が不正です: ' . implode(' / ', array_column($r['errors'], 'message')), 'invalid_game', 422, ['errors' => $r['errors'], 'warnings' => $r['warnings']]);
    return $r;
}

/** スキーマ検証 + 診断(ジャンプ到達性)。アセット参照の存在確認は段階4で asset_issues に追加する */
function tool_validate_game(array $a): array
{
    if (array_key_exists('game', $a)) $input = $a['game'];
    elseif (isset($a['game_id'])) $input = load_game(check_id($a['game_id']))['game'];
    else throw new ToolError('game か game_id を指定してください');
    $schema = schema_load();
    $r = validate_game_def($input, $schema);
    $diag = null;
    $assetIssues = [];
    if ($r['ok']) {
        $diag = diagnose_game($r['game'], $schema);
        if (!$diag['gapsClearable']) {
            $r['warnings'][] = issue('level', 'gap_too_wide', '穴がジャンプ距離を超えています。クリアできない可能性があります');
        }
    }
    return ['ok' => $r['ok'], 'errors' => $r['errors'], 'warnings' => $r['warnings'], 'game' => $r['game'], 'diagnostics' => $diag, 'asset_issues' => $assetIssues];
}

function tool_create_game(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $schema = schema_load();
    $r = checked($a['game'] ?? $schema['defaultGame']);
    $dir = game_dir($id);
    if (!is_dir(data_dir())) @mkdir(data_dir(), 0755, true);
    if (!@mkdir($dir, 0755)) throw new ToolError("ゲーム {$id} は既に存在します", 'exists', 409);
    @mkdir($dir . '/history', 0755);
    @mkdir($dir . '/proposals', 0755);
    write_json($dir . '/state.json', ['version' => 0, 'max' => 0]);
    $c = with_lock($id, fn() => commit_locked($id, $r['game'], '作成', null));
    return ['game_id' => $id, 'version' => $c['version'], 'game' => $r['game'], 'warnings' => $r['warnings']];
}

/** 人が直接編集した結果の保存(スライダー・JSON編集)。検証・丸めてから履歴に残す */
function tool_save_game(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $r = checked($a['game'] ?? null);
    $label = mb_substr((string)($a['label'] ?? '編集'), 0, 60);
    $base = isset($a['base_version']) ? (int)$a['base_version'] : null;
    $c = with_lock($id, fn() => commit_locked($id, $r['game'], $label, $base));
    return ['game_id' => $id, 'version' => $c['version'], 'game' => $r['game'], 'warnings' => $r['warnings']];
}

function tool_list_history(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $limit = max(1, min(200, (int)($a['limit'] ?? 50)));
    $st = game_state($id);
    $out = [];
    for ($v = $st['max']; $v >= 1 && count($out) < $limit; $v--) {
        $p = history_path($id, $v);
        if (!is_file($p)) continue;
        $h = read_json($p);
        $out[] = ['version' => $v, 'parent' => $h['parent'], 'ts' => $h['ts'], 'label' => $h['label']];
    }
    return ['current' => $st['version'], 'history' => $out];
}

/** 1つ前の版に戻す。履歴は消さず、現在位置(version)だけが親に移る */
function tool_undo_game(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $base = isset($a['base_version']) ? (int)$a['base_version'] : null;
    return with_lock($id, function () use ($id, $base) {
        $st = game_state($id);
        if ($base !== null && $base !== $st['version']) throw new ToolError('他の変更と競合しました', 'conflict', 409, ['current_version' => $st['version']]);
        $cur = read_json(history_path($id, $st['version']));
        $parent = (int)$cur['parent'];
        if ($parent < 1) throw new ToolError('これ以上戻れません', 'no_more_undo', 409);
        $prev = read_json(history_path($id, $parent));
        $ts = gmdate('c');
        write_json(game_dir($id) . '/game.json', $prev['game']);
        write_json(game_dir($id) . '/state.json', ['version' => $parent, 'max' => $st['max'], 'updated' => $ts]);
        return ['game_id' => $id, 'version' => $parent, 'game' => $prev['game']];
    });
}

function proposal_path(string $gid, string $pid): string
{
    if (preg_match('/\A[0-9a-f]{16}\z/', $pid) !== 1) throw new ToolError('proposal_id が不正です', 'bad_id');
    return game_dir($gid) . "/proposals/{$pid}.json";
}

/** 差分を「提案」として保存するだけ。ゲームは変更しない */
function tool_propose_patch(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $cur = load_game($id);
    $schema = schema_load();
    $ops = $a['ops'] ?? null;
    $patched = apply_patch_ops($cur['game'], $ops);
    $r = validate_game_def($patched, $schema);
    if (!$r['ok']) throw new ToolError('この差分を適用するとゲーム定義が不正になります: ' . implode(' / ', array_column($r['errors'], 'message')), 'invalid_patch', 422, ['errors' => $r['errors']]);
    $pid = bin2hex(random_bytes(8));
    $source = in_array($a['source'] ?? 'rule', ['rule', 'ai', 'human'], true) ? $a['source'] : 'rule';
    $title = mb_substr((string)($a['title'] ?? '変更提案'), 0, 60);
    write_json(proposal_path($id, $pid), [
        'id' => $pid, 'game_id' => $id, 'status' => 'pending', 'source' => $source, 'title' => $title,
        'base_version' => $cur['version'], 'ops' => $ops, 'created' => gmdate('c'),
    ]);
    return ['proposal_id' => $pid, 'game_id' => $id, 'title' => $title, 'base_version' => $cur['version'], 'ops' => $ops, 'warnings' => $r['warnings']];
}

/** 人が承認した提案IDだけを適用して履歴に残す */
function tool_apply_patch(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $pid = (string)($a['proposal_id'] ?? '');
    $path = proposal_path($id, $pid);
    return with_lock($id, function () use ($id, $path) {
        $p = read_json($path);
        if ($p['status'] !== 'pending') throw new ToolError('この提案は既に処理済みです', 'not_pending', 409);
        $cur = load_game($id);
        if ($p['base_version'] !== $cur['version']) throw new ToolError('提案の作成後にゲームが変更されました。提案をやり直してください', 'stale_proposal', 409, ['current_version' => $cur['version']]);
        $r = checked(apply_patch_ops($cur['game'], $p['ops']));
        $c = commit_locked($id, $r['game'], '提案: ' . $p['title'], $cur['version']);
        $p['status'] = 'applied';
        $p['applied_version'] = $c['version'];
        write_json($path, $p);
        return ['game_id' => $id, 'version' => $c['version'], 'game' => $r['game'], 'warnings' => $r['warnings']];
    });
}

function tool_discard_patch(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $path = proposal_path($id, (string)($a['proposal_id'] ?? ''));
    return with_lock($id, function () use ($path) {
        $p = read_json($path);
        if ($p['status'] === 'pending') { $p['status'] = 'discarded'; write_json($path, $p); }
        return ['proposal_id' => $p['id'], 'status' => $p['status']];
    });
}
