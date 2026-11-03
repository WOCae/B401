# プラットフォーマー作成ツール

ゲームを「コード」ではなく **ゲーム定義JSON** として持つ、横スクロールのプラットフォーマー作成サイト。
サーバーは PHP のみ(Node.js・常駐プロセス・ビルド工程は不要)。

## 構成
```
index.html / css/ / js/      フロント(素のES Modules)
  engine.js                  ゲームロジック(DOM非依存・固定タイムステップ)
  schema.js diagnose.js patch.js   検証・診断・JSON差分(PHP側と同じ規則)
  render2d.js render3d.js hud.js   描画(2D canvas / Three.js)とHUD。render.mode で切替
  main.js suggest.js api.js input.js   ダッシュボード/提案/APIクライアント/入力
schema/game.schema.json      検証ルールの唯一の定義(JSもPHPもこれを読む)
vendor/three/                Three.js r187 をローカル配置(CDN不使用。import mapで読み込み)
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

## 3D表示(段階2)
ゲームロジックは2Dのまま、`render.mode: "3d"` のときだけ Three.js で描く。`render` / `assets` が無い既存JSONは
既定値で補完され、そのまま動く(既定は `"2d"`)。WebGLが使えない環境では2Dに自動で戻る(JSONは変えない)。
```json
{ "render": { "mode": "3d", "depth": 1, "lighting": "default",
              "camera": { "type": "orthographic", "angle": 0, "distance": 12, "follow": "player" } },
  "assets": { "player": { "primitive": { "shape": "capsule", "color": null, "width": 22, "height": 28, "eyes": true } },
              "enemy":  { "primitive": { "shape": "capsule", "color": "#7a3fb0", "width": 24, "height": 24, "eyes": true } } } }
```
- `camera.distance`: 画面に映る高さ(タイル数)。正射・透視どちらも注視面で同じ見え方。`angle`: 上からの傾き(度)。
- `depth`: ステージの奥行きの厚み(見た目のみ)。`primitive.width/height` は見た目のサイズで、当たり判定とは独立(ヒットボックスは段階3で調整可能に)。
- `primitive.color` が `null` のときプレイヤーは `theme.player` の色。

## GLBモデル・アニメーション・ヒットボックス(段階3)
```json
{ "assets": {
  "player": { "model": "assets/samples/player.glb", "scale": 1, "yaw": 0, "offsetX": 0, "offsetY": 0, "offsetZ": 0,
              "anim": { "idle": "Idle", "run": "Run", "jump": "Jump", "fall": "Fall" },
              "hitbox": { "w": 22, "h": 28, "ox": 0, "oy": 0 }, "primitive": { } },
  "enemy":  { "model": "assets/samples/enemy.glb", "anim": { "walk": "Walk" }, "hitbox": { "w": 24, "h": 24 } } } }
```
- `model`: 読み込むGLBのパス(`assets/...` 等の相対パス・`..`不可・拡張子`.glb`のみ)。空/未指定/読み込み失敗ならプリミティブ表示で動く。
- `scale` 1 = 1 glTF単位 = 1タイル(32px)。`yaw` はモデルの向き補正(正面は+Z)。`offsetX/Y/Z` は足元の位置合わせ(px)。
- `anim`: クリップ名の対応。未指定(null)ならクリップ名 `idle/run/jump/fall/walk`(大小無視)で自動選択。指定名が無いと警告して自動選択。
- `hitbox`: **物理の当たり判定そのもの**(見た目と独立)。`w,h` はpx、`ox,oy` は「モデル原点から見たヒットボックス下端中央」(右・上が+)。既定は元の 22x28 / 24x24 で挙動は変わらない。
- ヒットボックスのワイヤーフレーム表示は表示用設定(JSONではなくブラウザに保存)。2D/3Dどちらでも出る。
- テスト用GLBは `node tools/make_sample_glbs.mjs` で生成(外部ライブラリ不要。`assets/samples/`)。
- サーバーの `validate_game` / `save_game` は参照GLBの存在と `glTF` ヘッダを確認して警告を返す(`asset_issues`)。

## 画面テスト(Playwright が必要)
```bash
node tests/e2e_dashboard.cjs; node tests/e2e_3d.cjs; node tests/e2e_no_webgl.cjs; node tests/e2e_models.cjs; node tests/e2e_broken_glb.cjs   # BASE=http://... OUT=出力先
```

## 現状の注意
- 認証は未実装。公開前に書き込み系ツールへアクセス制御(トークン等)を入れること。
- 履歴は無制限に増える(間引きは未実装)。
