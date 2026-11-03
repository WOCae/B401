<?php
declare(strict_types=1);
// GLBアセットの一覧・アップロード・差し替え・削除。
// 保存先: uploads/<game_id>/<名前>.glb (HTTPで静的配信。PHP実行は uploads/.htaccess で禁止)
// 検証: 拡張子・MIME・サイズ・GLB構造(ヘッダ/チャンク/JSON/外部参照/未対応圧縮)・ファイル名サニタイズ。
namespace PM;

const ASSET_NAME_RE = '/\A[a-z0-9][a-z0-9_-]{0,60}\.glb\z/';
const ASSET_MIMES = ['model/gltf-binary', 'application/octet-stream', 'application/x-glb', 'application/octet-stream; charset=binary', ''];
// GLTFLoader にデコーダを同梱していない圧縮拡張(必須指定されていると読めない)
const UNSUPPORTED_EXT = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];

function uploads_dir(string $gameId): string { return PM_ROOT . '/uploads/' . check_id($gameId); }

/** 元のファイル名から安全な名前(小文字英数・-・_)を作り、衝突しないよう乱数を付ける */
function sanitize_asset_name(string $orig): string
{
    $base = pathinfo(str_replace("\0", '', $orig), PATHINFO_FILENAME);
    $base = strtolower((string)preg_replace('/[^a-zA-Z0-9_-]+/', '-', $base)); // 日本語等は落とす
    $base = trim((string)preg_replace('/-{2,}/', '-', $base), '-_');
    if ($base === '') $base = 'model';
    return substr($base, 0, 40) . '-' . bin2hex(random_bytes(3)) . '.glb';
}

/**
 * GLBの構造を検証して概要を返す。
 * @return array{ok:bool, errors:string[], info:array}
 */
function inspect_glb(string $file): array
{
    $err = [];
    $info = ['animations' => [], 'meshes' => 0, 'nodes' => 0, 'materials' => 0, 'textures' => 0, 'vertices' => 0];
    $size = @filesize($file);
    $raw = $size === false ? false : file_get_contents($file);
    if ($raw === false || $size < 28) return ['ok' => false, 'errors' => ['ファイルを読み取れません(小さすぎます)'], 'info' => $info];
    if (substr($raw, 0, 4) !== 'glTF') return ['ok' => false, 'errors' => ['GLBファイルではありません(先頭が glTF ではありません)'], 'info' => $info];
    $h = unpack('Vversion/Vlength', substr($raw, 4, 8));
    if ($h['version'] !== 2) $err[] = 'glTF 2.0 のGLBのみ対応です';
    if ($h['length'] !== $size) $err[] = 'ファイルサイズがヘッダと一致しません(壊れているか途中で切れています)';
    if ($err) return ['ok' => false, 'errors' => $err, 'info' => $info];
    $c = unpack('Vlen/Vtype', substr($raw, 12, 8));
    if ($c['type'] !== 0x4E4F534A || 20 + $c['len'] > $size) return ['ok' => false, 'errors' => ['JSONチャンクが不正です'], 'info' => $info];
    $json = json_decode(substr($raw, 20, $c['len']), true, 64);
    if (!is_array($json) || !isset($json['asset']['version']) || !str_starts_with((string)$json['asset']['version'], '2')) {
        return ['ok' => false, 'errors' => ['glTFのJSONが読み取れません'], 'info' => $info];
    }
    // 2つ目のチャンク(BIN)が範囲内か
    $off = 20 + $c['len'];
    if ($off < $size) {
        if ($off + 8 > $size) return ['ok' => false, 'errors' => ['BINチャンクが不正です'], 'info' => $info];
        $b = unpack('Vlen/Vtype', substr($raw, $off, 8));
        if ($b['type'] !== 0x004E4942 || $off + 8 + $b['len'] > $size) return ['ok' => false, 'errors' => ['BINチャンクが不正です'], 'info' => $info];
    }
    // 外部ファイル参照は不可(自己完結したGLBのみ)
    foreach (['buffers', 'images'] as $k) {
        foreach ($json[$k] ?? [] as $e) {
            if (isset($e['uri']) && !str_starts_with((string)$e['uri'], 'data:')) $err[] = "外部ファイルを参照しています({$k}): 自己完結したGLBにしてください";
        }
    }
    foreach ($json['extensionsRequired'] ?? [] as $x) {
        if (in_array($x, UNSUPPORTED_EXT, true)) $err[] = "未対応の圧縮拡張 {$x} が必須です(圧縮なしで書き出してください)";
    }
    // 防御: PHPコードらしき文字列が含まれるファイルは受け付けない
    if (str_contains($raw, '<?php') || str_contains($raw, '<?=')) $err[] = '不正な内容が含まれています';
    $lim = schema_load()['uploads']['maxVertices'];
    $verts = 0;
    foreach ($json['meshes'] ?? [] as $m) foreach ($m['primitives'] ?? [] as $p) {
        $ai = $p['attributes']['POSITION'] ?? null;
        if (is_int($ai) && isset($json['accessors'][$ai]['count'])) $verts += (int)$json['accessors'][$ai]['count'];
    }
    if ($verts > $lim) $err[] = "頂点数が多すぎます({$verts} > {$lim})";
    $info = [
        'animations' => array_values(array_map(fn($a) => (string)($a['name'] ?? ''), $json['animations'] ?? [])),
        'meshes' => count($json['meshes'] ?? []), 'nodes' => count($json['nodes'] ?? []),
        'materials' => count($json['materials'] ?? []), 'textures' => count($json['textures'] ?? []), 'vertices' => $verts,
    ];
    return ['ok' => !$err, 'errors' => $err, 'info' => $info];
}

/** ゲームJSONが参照しているモデルパス => 使用箇所(assets.player.model 等) */
function model_refs(array $game): array
{
    $refs = [];
    $a = $game['assets'] ?? [];
    foreach (['player', 'enemy'] as $w) if (is_string($a[$w]['model'] ?? null)) $refs[$a[$w]['model']][] = "assets.{$w}.model";
    foreach ($a['tiles'] ?? [] as $sym => $t) if (is_string($t['model'] ?? null)) $refs[$t['model']][] = "assets.tiles.{$sym}.model";
    return $refs;
}

function asset_entry(string $file, string $path, bool $editable, array $refs, ?array &$meta = null): array
{
    $key = basename($file);
    $sig = filesize($file) . ':' . filemtime($file);
    if ($meta !== null && isset($meta[$key]) && $meta[$key]['sig'] === $sig) {
        $i = $meta[$key]['result'];
    } else {
        $i = inspect_glb($file);
        if ($meta !== null) $meta[$key] = ['sig' => $sig, 'result' => $i];
    }
    return ['name' => basename($file), 'path' => $path, 'size' => filesize($file), 'mtime' => filemtime($file), 'editable' => $editable,
        'valid' => $i['ok'], 'errors' => $i['errors'], 'info' => $i['info'], 'used_by' => $refs[$path] ?? []];
}

function tool_list_assets(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $refs = model_refs(load_game($id)['game']);
    $out = ['uploads' => [], 'samples' => [], 'limits' => schema_load()['uploads']];
    $metaFile = uploads_dir($id) . '/.meta.json';
    $meta = is_file($metaFile) ? (json_decode((string)file_get_contents($metaFile), true) ?: []) : [];
    $before = $meta;
    $seen = [];
    foreach (glob(uploads_dir($id) . '/*.glb') ?: [] as $f) {
        if (preg_match(ASSET_NAME_RE, basename($f)) !== 1) continue;
        $seen[basename($f)] = true;
        $out['uploads'][] = asset_entry($f, "uploads/{$id}/" . basename($f), true, $refs, $meta);
    }
    $meta = array_intersect_key($meta, $seen); // 削除済みの分を捨てる
    if ($meta !== $before && is_dir(uploads_dir($id))) { try { write_json($metaFile, $meta); } catch (\Throwable $e) { /* キャッシュなので失敗しても続行 */ } }
    foreach (glob(PM_ROOT . '/assets/samples/*.glb') ?: [] as $f) $out['samples'][] = asset_entry($f, 'assets/samples/' . basename($f), false, $refs);
    usort($out['uploads'], fn($x, $y) => $y['mtime'] <=> $x['mtime']);
    return $out;
}

/** $_FILES['file'] をGLBとして検証して保存。replace に既存名を渡すと同名で差し替え(参照が切れない) */
function tool_upload_asset(array $a, array $files = []): array
{
    $id = check_id($a['game_id'] ?? null);
    load_game($id); // ゲームの存在確認
    $L = schema_load()['uploads'];
    $f = $files['file'] ?? null;
    if (!is_array($f) || !isset($f['error']) || is_array($f['error'])) throw new ToolError('ファイルが送信されていません', 'no_file');
    $msg = [UPLOAD_ERR_INI_SIZE => 'ファイルサイズがサーバーの上限を超えています(upload_max_filesize)', UPLOAD_ERR_FORM_SIZE => 'ファイルサイズが上限を超えています',
        UPLOAD_ERR_PARTIAL => 'アップロードが途中で切れました', UPLOAD_ERR_NO_FILE => 'ファイルが選択されていません',
        UPLOAD_ERR_NO_TMP_DIR => 'サーバーの一時フォルダがありません', UPLOAD_ERR_CANT_WRITE => 'サーバーに書き込めません', UPLOAD_ERR_EXTENSION => 'サーバーの拡張に拒否されました'];
    if ($f['error'] !== UPLOAD_ERR_OK) throw new ToolError($msg[$f['error']] ?? 'アップロードに失敗しました', 'upload_error', $f['error'] === UPLOAD_ERR_INI_SIZE ? 413 : 400);
    if (!is_uploaded_file($f['tmp_name'])) throw new ToolError('不正なアップロードです', 'upload_error');
    // 拡張子・サイズ・MIME(クライアント申告とサーバー判定の両方)
    if (strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION)) !== $L['extension']) throw new ToolError('拡張子は .glb のみ受け付けます', 'bad_extension', 415);
    $size = (int)$f['size'];
    if ($size <= 0 || $size > $L['maxBytes']) throw new ToolError('ファイルサイズは ' . round($L['maxBytes'] / 1048576, 1) . 'MB 以下にしてください', 'too_large', 413);
    if (!in_array(strtolower((string)($f['type'] ?? '')), ASSET_MIMES, true)) throw new ToolError('MIMEタイプが不正です(' . $f['type'] . ')', 'bad_mime', 415);
    if (function_exists('finfo_open')) {
        $fi = finfo_open(FILEINFO_MIME_TYPE);
        $real = $fi ? (string)finfo_file($fi, $f['tmp_name']) : '';
        if ($real !== '' && !in_array($real, ['model/gltf-binary', 'application/octet-stream', 'application/x-glb'], true)) throw new ToolError("ファイルの中身がGLBではありません({$real})", 'bad_mime', 415);
    }
    $ins = inspect_glb($f['tmp_name']);
    if (!$ins['ok']) throw new ToolError('GLBとして使えません: ' . implode(' / ', $ins['errors']), 'invalid_glb', 422, ['errors' => $ins['errors']]);

    $dir = uploads_dir($id);
    $replace = isset($a['replace']) && $a['replace'] !== '' ? (string)$a['replace'] : null;
    if ($replace !== null) {
        if (preg_match(ASSET_NAME_RE, $replace) !== 1 || !is_file("{$dir}/{$replace}")) throw new ToolError('差し替え対象が見つかりません', 'not_found', 404);
        $name = $replace;
    } else {
        $existing = glob($dir . '/*.glb') ?: [];
        $total = array_sum(array_map('filesize', $existing));
        if (count($existing) >= $L['maxFilesPerGame']) throw new ToolError("1ゲームあたり {$L['maxFilesPerGame']} ファイルまでです。不要なものを削除してください", 'quota', 409);
        if ($total + $size > $L['maxTotalBytesPerGame']) throw new ToolError('このゲームのアップロード容量の上限を超えます', 'quota', 409);
        $name = sanitize_asset_name((string)$f['name']);
    }
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) throw new ToolError('保存先を作成できません', 'write_failed', 500);
    $tmp = $dir . '/.up-' . bin2hex(random_bytes(4)) . '.tmp';
    if (!move_uploaded_file($f['tmp_name'], $tmp) || !rename($tmp, "{$dir}/{$name}")) { @unlink($tmp); throw new ToolError('保存に失敗しました', 'write_failed', 500); }
    @chmod("{$dir}/{$name}", 0644);
    $refs = model_refs(load_game($id)['game']);
    return ['asset' => asset_entry("{$dir}/{$name}", "uploads/{$id}/{$name}", true, $refs), 'replaced' => $replace !== null];
}

/** 使用中のモデルは削除できない(先にJSONの指定を外す) */
function tool_delete_asset(array $a): array
{
    $id = check_id($a['game_id'] ?? null);
    $name = (string)($a['name'] ?? '');
    if (preg_match(ASSET_NAME_RE, $name) !== 1) throw new ToolError('ファイル名が不正です', 'bad_name');
    $file = uploads_dir($id) . '/' . $name;
    if (!is_file($file)) throw new ToolError('ファイルが見つかりません', 'not_found', 404);
    $use = model_refs(load_game($id)['game'])["uploads/{$id}/{$name}"] ?? [];
    if ($use) throw new ToolError('使用中のため削除できません(' . implode(', ', $use) . ')。先にモデルの指定を外してください', 'in_use', 409, ['used_by' => $use]);
    if (!unlink($file)) throw new ToolError('削除に失敗しました', 'write_failed', 500);
    return ['deleted' => $name];
}
