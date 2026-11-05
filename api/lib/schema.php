<?php
declare(strict_types=1);
// ゲーム定義の検証・診断・差分適用。js/schema.js / js/diagnose.js / js/patch.js と同じ規則。
// ルールは schema/server.schema.json を読む(サーバー保存モード用に凍結した v1。ブラウザ保存の新機能 v2 は schema/game.schema.json)。

namespace PM;

final class ToolError extends \RuntimeException
{
    public function __construct(string $message, public string $errCode = 'bad_request', public int $status = 400, public array $details = [])
    {
        parent::__construct($message);
    }
}

function schema_load(): array
{
    static $s = null;
    if ($s === null) {
        $s = json_decode((string)file_get_contents(PM_ROOT . '/schema/server.schema.json'), true, 512, JSON_THROW_ON_ERROR);
    }
    return $s;
}

function is_obj(mixed $v): bool { return is_array($v) && ($v === [] || !array_is_list($v)); }

/** @return string[] UTF-8 のコードポイント配列 */
function cps(string $s): array
{
    $a = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
    return $a === false ? [] : $a;
}

function get_path(array $o, string $path): array
{
    $cur = $o;
    foreach (explode('.', $path) as $k) {
        if (!is_array($cur) || !array_key_exists($k, $cur)) return [false, null];
        $cur = $cur[$k];
    }
    return [true, $cur];
}

function set_path(array &$o, string $path, mixed $v): void
{
    $ks = explode('.', $path);
    $last = array_pop($ks);
    $cur = &$o;
    foreach ($ks as $k) {
        if (!isset($cur[$k]) || !is_array($cur[$k])) $cur[$k] = [];
        $cur = &$cur[$k];
    }
    $cur[$last] = $v;
}

function issue(string $path, string $code, string $message): array
{
    return ['path' => $path, 'code' => $code, 'message' => $message];
}

function num_str(int|float $n): string { return (string)json_encode($n); }

function find_unknown(array $obj, string $prefix, array $leaf, array $branch, array &$out): void
{
    foreach ($obj as $k => $v) {
        $k = (string)$k;
        $p = $prefix === '' ? $k : $prefix . '.' . $k;
        if (isset($leaf[$p])) continue;
        if (isset($branch[$p]) && is_obj($v)) find_unknown($v, $p, $leaf, $branch, $out);
        else $out[] = $p;
    }
}

/** @return array{ok:bool,errors:array,warnings:array,game:?array} */
function validate_game_def(mixed $input, array $schema): array
{
    $errors = [];
    $warnings = [];
    if (!is_obj($input)) {
        return ['ok' => false, 'errors' => [issue('', 'not_object', 'ゲーム定義はJSONオブジェクトにしてください')], 'warnings' => [], 'game' => null];
    }
    $game = [];
    foreach ($schema['fields'] as $f) {
        [$found, $raw] = get_path($input, $f['path']);
        if (!$found) {
            $v = $f['default'];
        } elseif ($raw === null && ($f['nullable'] ?? false)) {
            $v = null;
        } elseif ($f['type'] === 'enum') {
            if (is_string($raw) && in_array($raw, $f['values'], true)) {
                $v = $raw;
            } else {
                $warnings[] = issue($f['path'], 'type', "{$f['path']}: " . implode(' / ', $f['values']) . " のいずれかにしてください。既定値 {$f['default']} を使います");
                $v = $f['default'];
            }
        } elseif ($f['type'] === 'bool') {
            if (is_bool($raw)) {
                $v = $raw;
            } else {
                $warnings[] = issue($f['path'], 'type', "{$f['path']}: true / false にしてください。既定値 " . json_encode($f['default']) . ' を使います');
                $v = $f['default'];
            }
        } elseif ($f['type'] === 'number') {
            if (!(is_int($raw) || is_float($raw)) || !is_finite((float)$raw)) {
                $warnings[] = issue($f['path'], 'type', "{$f['path']}: 数値ではないため既定値 " . num_str($f['default']) . ' を使います');
                $v = $f['default'];
            } else {
                $v = min($f['max'], max($f['min'], $raw));
                if ($v != $raw) {
                    $warnings[] = issue($f['path'], 'clamped', "{$f['path']}: " . num_str($raw) . ' は範囲外のため ' . num_str($v) . " に丸めました({$f['min']}〜{$f['max']})");
                }
            }
        } elseif ($f['type'] === 'color') {
            if (is_string($raw) && preg_match('/^#[0-9a-fA-F]{6}$/D', $raw) === 1) {
                $v = $raw;
            } else {
                $warnings[] = issue($f['path'], 'type', "{$f['path']}: #rrggbb 形式ではないため既定値 {$f['default']} を使います");
                $v = $f['default'];
            }
        } else { // string
            if (!is_string($raw)) {
                $warnings[] = issue($f['path'], 'type', "{$f['path']}: 文字列ではないため既定値を使います");
                $v = $f['default'];
            } elseif ($raw === '') {
                $v = $f['default'];
            } elseif (isset($f['pattern'])) {
                if (count(cps($raw)) <= $f['maxLength'] && preg_match('~' . $f['pattern'] . '~D', $raw) === 1) {
                    $v = $raw;
                } else {
                    $warnings[] = issue($f['path'], 'bad_format', "{$f['path']}: 使えない形式です(例: assets/samples/player.glb)。既定値に戻します");
                    $v = $f['default'];
                }
            } else {
                $chars = cps($raw);
                if (count($chars) > $f['maxLength']) {
                    $v = implode('', array_slice($chars, 0, $f['maxLength']));
                    $warnings[] = issue($f['path'], 'too_long', "{$f['path']}: {$f['maxLength']}文字に切り詰めました");
                } else {
                    $v = $raw;
                }
            }
        }
        set_path($game, $f['path'], $v);
    }

    $L = $schema['level'];
    $lv = $input['level'] ?? null;
    $okShape = is_array($lv) && array_is_list($lv) && count($lv) > 0;
    if ($okShape) foreach ($lv as $r) { if (!is_string($r)) { $okShape = false; break; } }
    if (!$okShape) {
        $errors[] = issue('level', 'level_shape', 'level は1行以上の文字列の配列にしてください');
    } elseif (count($lv) > $L['maxRows']) {
        $errors[] = issue('level', 'level_rows', "level の行数が上限({$L['maxRows']})を超えています");
    } else {
        $replaced = 0;
        $rows = [];
        foreach ($lv as $r) {
            $row = [];
            foreach (cps($r) as $c) {
                if (array_key_exists($c, $schema['tiles'])) { $row[] = $c; } else { $replaced++; $row[] = '.'; }
            }
            $rows[] = $row;
        }
        $maxLen = max(array_map('count', $rows));
        if ($maxLen > $L['maxCols']) {
            $errors[] = issue('level', 'level_cols', "level の1行の長さが上限({$L['maxCols']})を超えています");
        } elseif ($maxLen === 0) {
            $errors[] = issue('level', 'level_empty', 'level が空です');
        } else {
            $joined = array_map(fn($r) => implode('', $r), $rows);
            $all = implode('', $joined);
            foreach ($L['requiredTiles'] as $t) {
                if (!str_contains($all, $t)) $errors[] = issue('level', 'level_missing_tile', "{$schema['tiles'][$t]['name']}({$t})がありません");
            }
            if ($replaced) $warnings[] = issue('level', 'level_unknown_tile', "未知の記号 {$replaced} 個を \".\" に置き換えました");
            $pCount = substr_count($all, 'P');
            if ($pCount > 1) $warnings[] = issue('level', 'level_multi_start', "開始位置 P が {$pCount} 個あります(最後のものを使います)");
            $game['level'] = $joined;
        }
    }

    $leaf = ['level' => true];
    $branch = [];
    foreach ($schema['fields'] as $f) {
        $leaf[$f['path']] = true;
        $ks = explode('.', $f['path']);
        for ($i = 1; $i < count($ks); $i++) $branch[implode('.', array_slice($ks, 0, $i))] = true;
    }
    $unknown = [];
    find_unknown($input, '', $leaf, $branch, $unknown);
    foreach ($unknown as $p) $warnings[] = issue($p, 'unknown_key', "{$p}: 未対応の項目なので無視しました");

    $ok = count($errors) === 0;
    return ['ok' => $ok, 'errors' => $errors, 'warnings' => $warnings, 'game' => $ok ? $game : null];
}

/** 検証済みゲームの難易度診断(js/diagnose.js と同じ式) */
function diagnose_game(array $game, array $schema): array
{
    $T = $schema['tileSize'];
    $ph = $game['physics'];
    $jh = ($ph['jumpVelocity'] * $ph['jumpVelocity']) / (2 * $ph['gravity']) / $T;
    $jd = $ph['moveSpeed'] * (2 * $ph['jumpVelocity'] / $ph['gravity']) / $T;
    $rows = array_map(fn($r) => cps($r), $game['level']);
    $H = count($rows);
    $W = max(array_map('count', $rows));
    $max = 0;
    $run = 0;
    for ($x = 0; $x < $W; $x++) {
        $has = false;
        for ($y = max(0, $H - 2); $y < $H; $y++) if (($rows[$y][$x] ?? null) === '#') $has = true;
        $run = $has ? 0 : $run + 1;
        $max = max($max, $run);
    }
    return [
        'jumpHeightTiles' => $jh,
        'jumpDistanceTiles' => $jd,
        'widestGapTiles' => $max,
        'gapsClearable' => $max * $T <= $jd * $T - 8,
    ];
}

/** JSON差分(replace/add/remove)を適用した新しい配列を返す。js/patch.js と同じ規則 */
function apply_patch_ops(array $game, mixed $ops): array
{
    if (!is_array($ops) || !array_is_list($ops) || count($ops) < 1 || count($ops) > 200) {
        throw new ToolError('ops は1〜200個の配列にしてください', 'bad_patch');
    }
    $doc = $game;
    foreach ($ops as $i => $op) {
        $at = "ops[{$i}]";
        $fail = fn(string $m) => new ToolError("{$at}: {$m}", 'bad_patch');
        if (!is_obj($op) || !in_array($op['op'] ?? null, ['replace', 'add', 'remove'], true)) throw $fail('op は replace / add / remove のいずれかです');
        $path = $op['path'] ?? null;
        if (!is_string($path) || !str_starts_with($path, '/') || strlen($path) < 2) throw $fail('path は "/physics/gravity" の形式にしてください');
        if ($op['op'] !== 'remove' && !array_key_exists('value', $op)) throw $fail('value が必要です');
        $toks = array_map(fn($t) => str_replace(['~1', '~0'], ['/', '~'], $t), explode('/', substr($path, 1)));
        foreach ($toks as $t) if (in_array($t, ['__proto__', 'constructor', 'prototype'], true)) throw $fail('使えない path です');
        $cur = &$doc;
        for ($n = 0; $n < count($toks) - 1; $n++) {
            $t = (string)$toks[$n];
            if (!is_array($cur)) throw $fail('path が存在しません');
            if (array_is_list($cur) && $cur !== []) {
                if (preg_match('/^(0|[1-9]\d*)$/D', $t) !== 1 || (int)$t >= count($cur)) throw $fail('path が存在しません');
                $cur = &$cur[(int)$t];
            } else {
                if (!array_key_exists($t, $cur)) throw $fail('path が存在しません');
                $cur = &$cur[$t];
            }
        }
        $last = (string)$toks[count($toks) - 1];
        $val = $op['op'] === 'remove' ? null : $op['value'];
        if (!is_array($cur)) throw $fail('path が存在しません');
        if (array_is_list($cur) && $cur !== []) {
            $idx = ($last === '-' && $op['op'] === 'add') ? count($cur) : (preg_match('/^(0|[1-9]\d*)$/D', $last) === 1 ? (int)$last : -1);
            if ($idx < 0) throw $fail('配列の添字が不正です');
            if ($op['op'] === 'add') {
                if ($idx > count($cur)) throw $fail('添字が範囲外です');
                array_splice($cur, $idx, 0, [$val]);
            } else {
                if ($idx >= count($cur)) throw $fail('添字が範囲外です');
                if ($op['op'] === 'replace') $cur[$idx] = $val; else array_splice($cur, $idx, 1);
            }
        } else {
            if ($op['op'] !== 'add' && !array_key_exists($last, $cur)) throw $fail('path が存在しません');
            if ($op['op'] === 'remove') unset($cur[$last]); else $cur[$last] = $val;
        }
        unset($cur);
    }
    return $doc;
}
