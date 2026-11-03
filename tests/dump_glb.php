<?php
// 与えられたファイル(引数)を inspect_glb で検査した結果をJSONで出力(tests/parity_glb.mjs が JS 版と比較する)
require __DIR__ . '/../api/lib/bootstrap.php';
$out = [];
foreach (array_slice($argv, 1) as $f) { $r = PM\inspect_glb($f); $out[basename($f)] = ['ok' => $r['ok'], 'errors' => $r['errors'], 'info' => $r['info']]; }
echo json_encode($out, JSON_UNESCAPED_UNICODE);
