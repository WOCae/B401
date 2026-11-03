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

## 画面の構成(エディタ風UI)
- **ツールバー**: ゲーム選択/新規、リスタート、元に戻す、2D/3D切替、ヒットボックス表示、テーマ(ダーク/ライト)。
- **ヒエラルキー**(左): ワールド / カメラ・表示 / プレイヤー / 敵 / タイル(# ^ o G)。選ぶと右のインスペクタがその対象の設定に切り替わる。
- **インスペクタ**(右): 設定項目は `schema/game.schema.json` のフィールドから自動生成(`js/editor.js` の `SECTIONS` で対象に振り分け)。項目を足すとそのまま画面に出る。
- **ビューポート**(中央): ゲーム画面そのもの。比率(640:384)を保って枠いっぱいに表示。
- **ドック**(中央下): アセット管理 / AI提案 / JSON / 診断のタブ。
- 選択中の対象・タブ・テーマはブラウザに保存。1000px未満(スマホ等)では縦に積み、操作パッドを表示。
- テスト用に URL に `?debug&showall` を付けると全パネルを同時に表示する。

## ステージ編集
ツールバーの「✎ ステージ編集」(または下のパレットの操作)で、ビューポート上でタイルを直接配置できる(Esc で終了)。
- 編集中はゲームを止めて2D表示(グリッド・外枠・カーソル付き)。ブラシ: 消しゴム/ブロック/トゲ/コイン/敵/ゴール/開始位置(キー 1〜7)。
- 道具: 鉛筆(B・ドラッグで連続配置)/長方形(R)/塗りつぶし(F)。右クリック=消しゴム。ホイール/Alt+ドラッグ/スライダーで移動、拡大 50〜100%。
- 外周に行・列を追加/削除(上限 60行×400列)。開始位置(P)は1個だけで、消せず、別の場所に置くと移動。Pが消えるリサイズは適用前に止める。
- **1回の操作(押してから離すまで)が1つの履歴**になり、既存の検証→サーバー保存→「元に戻す」の経路をそのまま使う。
- 純粋関数は `js/level.js`(Nodeでテスト可)、画面は `js/stageeditor.js`。

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

## アセット管理とアップロード(段階4)
`uploads/<game_id>/<名前>.glb` に保存し、静的ファイルとして配信する(JSONの `model` は `uploads/<game_id>/…glb` を指す)。
- 受け付けるのは **自己完結のGLB(.glb、glTF 2.0)だけ**、1ファイル5MBまで・1ゲーム30ファイル/40MBまで(`schema/game.schema.json` の `uploads`)。
- サーバーの検証(`api/lib/assets.php`): 拡張子・申告MIME・`finfo`によるMIME・サイズ・GLB構造(ヘッダ/チャンク長/JSON/BIN範囲)・外部ファイル参照の禁止・
  未対応の圧縮拡張(Draco/Meshopt/Basis)が必須のものを拒否・頂点数上限・PHPコード断片の混入拒否。
- ファイル名はサニタイズ(小文字英数と`-_`のみ+乱数)。元の名前は使わない。差し替えは同名のまま中身を入れ替える(JSONの参照が切れない)。
- `uploads/.htaccess` でスクリプト実行を禁止し、`.glb` 以外は配信しない。アップロードAPIは独自ヘッダ `X-Requested-With` を必須にしてCSRFを防ぐ。
- 使用中のファイルは削除できない。ゲームが参照するGLBの有無・ヘッダは `validate_game` / `save_game` / `apply_patch` の警告(`asset_*`)で分かる。
- ツール: `list_assets`(AIに公開可)、`upload_asset` / `delete_asset`(人のみ)。
- 画面: 「アセット管理」でアップロード・一覧(アニメ名・頂点数・使用箇所)・割り当て(プレイヤー/敵/タイル)・差し替え・削除。差し替え後は更新時刻でキャッシュが切り替わる。

## 認証の設定(公開前に必須)
**閲覧(プレイ)は公開、編集(保存・アップロード・削除・提案など書き込み系すべて)は管理者パスワードでログインした人だけ**です。
パスワード未設定の間は、書き込みはすべて拒否されます(閲覧のみ)。

**方法A(シェルなし・FTPだけでOK)**
1. `api/` フォルダに **`setup.key`** というファイルをアップロードする(中身は推測されにくい16文字以上の文字列)。
2. ブラウザで `…/api/setup.php` を開き、setup.key の中身と、管理者パスワード(10文字以上)を入力。
3. `api/config.php` ができ、`setup.key` は自動で削除される(以後 setup.php は使えない)。書き込めない環境では、表示された内容を `api/config.php` として自分でアップロードする。

**方法B(シェルあり)**: `php tools/setup_auth.php`

- パスワードはハッシュ(`password_hash`)のみ保存。ログインは署名つきCookie(HttpOnly・SameSite=Strict・HTTPSならSecure、既定12時間)で、DB・PHPセッションは不要。
- パスワードを変えると(config.php を作り直すと)既存のログインはすべて無効になる。
- ログイン試行は IP ごとに10分で5回まで。`api/config.php` / `setup.key` は `.htaccess` でHTTP取得を拒否。
- 開発用: `PM_DEV_OPEN=1` を環境変数に付けて起動すると、**ループバック(127.0.0.1)からのときだけ**認証を省略できる(本番サーバーでは効かない)。
- 履歴は版ごとに保存し、古いものは自動で整理する(元に戻せる範囲は最新の200版。`schema/game.schema.json` の `history`)。処理済みの提案は14日、未処理は3日で削除。

### 公開後の確認
`tools/check_deploy.mjs https://example.com/path/` を実行すると、データフォルダや設定ファイルがHTTPから見えないこと、
アップロード先でスクリプトが動かないこと、未ログインで書き込めないことを確認できる。

### 公開時の設定
- **Apache系**: `uploads/.htaccess` と `games/.htaccess` が効くよう `AllowOverride All`(少なくとも FileInfo, Options, AuthConfig, Limit)が必要。
- **nginx**: `.htaccess` は効かない。`location ^~ /uploads/ { location ~ \.php$ { return 403; } }` と `location ^~ /games/ { deny all; }` を設定する。
- **PHP**: `upload_max_filesize` と `post_max_size`(目安 6M / 8M)。`api/.user.ini` / `api/.htaccess` に例がある(レンタルサーバーによっては管理画面で設定)。
- `games/` と `uploads/` は書き込み可にする。認証は上の「認証の設定」を参照。

## タイルのモデルとAI提案(段階5)
`assets.tiles` に `#` `^` `o` `G` ごとの設定(`model` / `color` / `scale` / `yaw` / `offsetX,Y,Z`)。未指定ならプリミティブ。
```json
{ "assets": { "tiles": { "#": { "model": "uploads/demo/block-1a2b3c.glb", "color": null, "scale": 1 },
                         "^": { "model": null, "color": "#4a4f57" } } } }
```
- タイル用GLBの原点は「タイルの下端中央」(1タイル=1単位)。GLBのメッシュも種類ごとに InstancedMesh にまとめる(スキン付きのみのモデルは不可→プリミティブ)。
- 見た目だけが変わる。当たり判定(`#` は1タイルの壁)は変わらない。
- AI(規則ベースのデモ)の提案は、ゲーム性・カメラ・アセットのどれも **JSON差分(ops)として `propose_patch` に保存 → 人が「適用」したときだけ `apply_patch`** で反映される:
  「3Dで見下ろし気味に」「カメラを寄せる/引く」「モデルを自動で割り当て」「アニメ名を自動割り当て」「ヒットボックスをモデルに合わせる」など。
- 外部のAI API は未接続(今回は規則ベース)。接続するときはブラウザにキーを出さず、PHPの中継から `propose_patch` に差分を渡す設計。

## 画面テスト(Playwright が必要)
```bash
tests/run_all.sh        # 上のテストと画面テストを一括実行(NO_E2E=1 でブラウザのテストを省略)
# 個別: node tests/e2e_dashboard.cjs / e2e_3d / e2e_no_webgl / e2e_models / e2e_broken_glb / e2e_assets   (BASE=http://... OUT=出力先)
```

## 現状の制限
- 管理者1人用(ユーザー別のゲーム所有・権限分けは未対応)。ログアウトしても、すでに発行された Cookie は期限(既定12時間)まで有効(パスワード変更で全て無効化できる)。
- 外部のAI API は未接続(提案は規則ベース)。MCPサーバー本体も未実装(ツール関数は `api/lib/tools.php` に分離済み)。
- 履歴の間引きで、200版より前には「元に戻す」で戻れなくなる。
