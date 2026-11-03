# プラットフォーマー作成ツール

ゲームを「コード」ではなく **ゲーム定義JSON** として持つ、横スクロールのプラットフォーマー作成サイト。
サーバーは PHP のみ(Node.js・常駐プロセス・ビルド工程は不要)。

## 構成
```
index.html / css/ / js/      フロント(素のES Modules)
  engine.js                  ゲームロジック(DOM非依存・固定タイムステップ)
  schema.js diagnose.js patch.js   検証・診断・JSON差分(PHP側と同じ規則)
  render2d.js                描画(段階2で3D版を追加)
  main.js suggest.js api.js input.js   ダッシュボード/提案/APIクライアント/入力
schema/game.schema.json      検証ルールの唯一の定義(JSもPHPもこれを読む)
api/index.php                HTTPの薄いラッパー
api/lib/tools.php            UI非依存のツール関数(将来MCPにそのまま包める)
api/lib/{schema,storage}.php 検証・差分適用 / JSONファイル保存(flockで排他)
games/<id>/                  game.json, state.json, history/, proposals/ (.htaccessで直接アクセス禁止)
reference/                   元の2Dプロトタイプ(挙動の基準)
tests/                       JS↔PHP一致テスト、元プロトタイプとのエンジン等価テスト
```

## 動かす
```bash
php -S 127.0.0.1:8080 -t .      # http://127.0.0.1:8080/ を開く
```
本番はドキュメントルートに置くだけ(`games/` は書き込み可にする)。

## ツール(api/lib/tools.php の registry)
`get_schema` `list_games` `get_game` `list_history` `validate_game` `propose_patch` /
`create_game` `save_game` `apply_patch` `discard_patch` `undo_game`。
`registry()` の `ai` フラグが false のもの(適用系)は、MCP化するときAIに公開しない。
AIは `propose_patch`(提案の保存のみ)までで、`apply_patch` は人の承認操作でのみ呼ぶ。

## テスト
```bash
tests/parity.sh                       # JSとPHPの検証・診断・差分適用が一致
node tests/engine_equivalence.mjs     # 新エンジン == reference のロジック(差0)
```

## 現状の注意
- 認証は未実装。公開前に書き込み系ツールへアクセス制御(トークン等)を入れること。
- 履歴は無制限に増える(間引きは未実装)。
