# 拡張ガイド: 新しい機能の足し方

設計の原則(変えないこと):
- ゲームは **データ(JSON)**。ユーザーのスクリプトは載せない。エンジンが持つ「決まった部品」を、データで組み合わせる。
- 設定項目は `schema/game.schema.json` に書く。**画面(インスペクタ・検証・AI提案・保存)は、スキーマから自動で対応する**。
- 形式を変えたら **形式バージョンと自動変換**(下記)。古いファイルが開けなくなってはいけない。

## 1. 設定を1つ足す(数値・選択・ON/OFF・色・文字)
1. `schema/game.schema.json` の `fields` に1行足す(`path`・`type`・`label`・`default`、数値は `min/max/step`、`group` で画面の置き場所を指定)。
2. `js/editor.js` の `SECTIONS` で、どの対象のインスペクタに出すかを決める(`match`)。既存の `group` を使えば変更不要なこともある。
3. エンジンや描画が値を読む(`def.player.hp` のように)。**値が無い古いゲームでも動くよう、既定値で動作が変わらないこと**。
4. テスト: `tests/engine_features.mjs` に動作テスト、`tests/schema_v2.mjs` に範囲丸めなどの検証。

## 2. アイテムの効果を足す(例: 「磁石」「重力を弱める」)
1. `js/engine/effects.js` の `EFFECTS` に `{ label, apply(engine, item) }` を足す。時間つきなら `setFx` を使う。
2. スキーマの `collections[items].itemFields` の `effect` の `values` / `valueLabels` に名前を足す。
3. 効果が物理に関わるなら、`Engine.step()` で `p.fx.<名前>` を読む(`jumpBoost` の読み方が見本)。
4. 表示したい残り時間の名前は `js/hud.js` の `FX_LABEL`。
5. テスト: `tests/engine_features.mjs`。

## 3. 敵の動きを足す(例: 追いかける、弾を撃つ)
1. `js/engine/enemies.js` の `BEHAVIORS` に `{ label, move(engine, enemy, dt) }` を足す(`walk` が元の挙動、`fly` が見本)。
2. スキーマの `enemyTypes.itemFields` の `behavior` の `values` に名前を足す。必要なら項目(`amp` のようなパラメータ)も足す。
3. 敵の初期値は `Engine.load()` で `S.en` に積む(新しいパラメータはここで取り込む)。

## 4. 新しい種類の一覧(コレクション)を足す(例: 「ブロックの種類」「乗り物」)
1. スキーマの `collections` に `{ path, kind, label, idPrefix, newLabel, max, itemFields, defaultValue }` を足す。
2. `js/legend.js` の `legendOf()` に、その `kind` を記号の対応表へ入れる処理を足す。
3. `js/engine.js` の `load()` で、記号(`lg.kind`)に応じて生成・扱いを足す。描画は `render2d.js` / `render3d.js`。
4. `js/editor.js` の `SECTIONS` に `{ id, group, title, collection: "<path>" }` を足す(一覧エディタは自動で出る)。
5. ステージエディタのブラシは `brushOrder()`(legend.js)に足せば自動で増える。

## 5. 形式を変える(破壊的な変更)
1. `schema/game.schema.json` の `formatVersion` を上げる。
2. `js/schema.js` の `migrate()` に「旧形式 → 新形式」の変換を足す(入力は書き換えない)。
3. `tests/golden/` に、**変更前のツールが書き出したファイル**をそのまま置く(既存のゴールデンファイルは書き換えない)。
   `tests/golden.mjs` がすべて開けることを確認する。
4. プロジェクトファイルの `version`(`js/project.js`)も上げ、古い版を読めるようにする。

## 6. 守ること
- 元のプロトタイプとの等価テスト(`tests/engine_equivalence.mjs`)は、**既定の設定では差0**のまま。
- サーバー保存モード(PHP)は `schema/server.schema.json`(v1)で凍結している。新機能は入れない(ブラウザ保存が本線)。
- 変更したら `tests/run_all.sh` を通す。
