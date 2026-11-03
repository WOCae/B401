<?php
// PHP側: dump.mjs と同じ形式で出力
require __DIR__ . '/../api/lib/bootstrap.php';
use function PM\{schema_load, validate_game_def, diagnose_game, apply_patch_ops};
use PM\ToolError;
$schema = schema_load();
$cases = json_decode(file_get_contents(__DIR__ . '/cases.json'), true);
$gen = function (array $c) {
    if (($c['gen'] ?? '') === 'rows61') { $l = array_fill(0, 61, '.'); $l[0] = 'P'; return ['level' => $l]; }
    if (($c['gen'] ?? '') === 'cols401') return ['level' => ['P' . str_repeat('.', 400)]];
    return $c['input'];
};
$out = ['validate' => new stdClass, 'patch' => new stdClass];
$v = []; $p = [];
foreach ($cases['validate'] as $c) {
    $r = validate_game_def($gen($c), $schema);
    $pairs = fn($l) => array_map(fn($i) => [$i['path'], $i['code']], $l);
    $v[$c['name']] = ['ok' => $r['ok'], 'game' => $r['game'], 'errors' => $pairs($r['errors']), 'warnings' => $pairs($r['warnings']), 'diag' => $r['ok'] ? diagnose_game($r['game'], $schema) : null];
}
$base = validate_game_def($schema['defaultGame'], $schema)['game'];
foreach ($cases['patch'] as $c) {
    try { $p[$c['name']] = ['ok' => true, 'game' => apply_patch_ops($base, $c['ops'])]; }
    catch (ToolError $e) { $p[$c['name']] = ['ok' => false, 'error' => 'PatchError']; }
}
echo json_encode(['validate' => $v, 'patch' => $p], JSON_UNESCAPED_UNICODE);
