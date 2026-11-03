<?php
declare(strict_types=1);
// HTTPの薄いラッパー。ロジックは lib/tools.php にあり、UIにもMCPにも依存しない。
//   GET  api/index.php?tool=get_game&game_id=demo
//   POST api/index.php?tool=save_game   (Content-Type: application/json)
require __DIR__ . '/lib/bootstrap.php';

use PM\ToolError;

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function reply(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

try {
    $tools = PM\registry();
    $name = (string)($_GET['tool'] ?? '');
    if (!isset($tools[$name])) throw new ToolError('未知のツールです', 'unknown_tool', 404);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($tools[$name]['write'] && $method !== 'POST') throw new ToolError('POST で呼び出してください', 'method_not_allowed', 405);

    $args = $_GET;
    unset($args['tool']);
    $files = [];
    if ($method === 'POST' && ($tools[$name]['multipart'] ?? false)) {
        // ファイルアップロード(multipart)。クロスサイトのフォーム送信を防ぐため独自ヘッダを必須にする
        if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'platformer-maker') throw new ToolError('不正なリクエストです', 'bad_request', 403);
        $args = $_POST;
        $files = $_FILES;
    } elseif ($method === 'POST') {
        // CSRF対策: クロスサイトのフォームからは application/json を送れない
        if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) throw new ToolError('Content-Type は application/json にしてください', 'bad_content_type', 415);
        $raw = file_get_contents('php://input', false, null, 0, 4 * 1024 * 1024 + 1);
        if ($raw === false || strlen($raw) > 4 * 1024 * 1024) throw new ToolError('リクエストが大きすぎます', 'too_large', 413);
        $body = $raw === '' ? [] : json_decode($raw, true);
        if (!is_array($body)) throw new ToolError('JSONとして読み取れません', 'bad_json');
        $args = $body;
    }
    $fn = 'PM\\' . $tools[$name]['fn'];
    reply(200, ['ok' => true, 'result' => ($tools[$name]['multipart'] ?? false) ? $fn($args, $files) : $fn($args)]);
} catch (ToolError $e) {
    reply($e->status, ['ok' => false, 'error' => ['code' => $e->errCode, 'message' => $e->getMessage(), 'details' => $e->details]]);
} catch (Throwable $e) {
    error_log('[platformer-maker] ' . $e);
    reply(500, ['ok' => false, 'error' => ['code' => 'internal', 'message' => 'サーバー内部エラーです']]);
}
