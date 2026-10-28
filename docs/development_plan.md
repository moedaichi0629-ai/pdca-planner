# 開発計画 — 日次PDCAプランナー

各ステップは Cursor の Claude Code に、下の「依頼文」をそのまま貼って進める。
1ステップ終わるごとに `npm test` とブラウザでの確認をしてから次へ進む。

## フェーズ①：最小版（目安 3〜5時間）

### ステップ1：計算ロジックとテスト（目安 1時間）
依頼文:
> docs/requirements.md の「4. 計算ルール」を src/planner.js に実装してください。DOM や localStorage には触らない純粋関数だけにし、CLAUDE.md の不変条件どおりブラウザと Node の両方から使えるようにしてください。4.4 の例をそのまま tests/planner.test.js のテストにしてください。参考実装は docs/reference/artifact-prototype.html の planDay / judge / elapsedDays です。

確認: `npm test` がすべて通る

### ステップ2：保存処理（目安 30分）
依頼文:
> docs/requirements.md の「5. データ設計」と F-07 に沿って src/storage.js を作ってください。localStorage の読み書き（失敗しても画面が動くように try/catch）、schemaVersion の確認、JSON の書き出し（Blob とダウンロード用リンク）と読み込み（ファイル選択）を入れてください。

確認: ブラウザの開発者ツールで localStorage に `pdca-planner` が保存される

### ステップ3：画面（目安 2〜3時間）
依頼文:
> index.html・src/style.css・src/app.js で、F-01〜F-06 の画面を作ってください。タブは「今日 / 進捗 / 週の設定」。見た目と動きは docs/reference/artifact-prototype.html を参考にし、保存は src/storage.js、計算は src/planner.js だけを使ってください。週や項目がないときは、次に何をすればいいかがわかる空の画面を出してください。

確認（ブラウザで index.html を開く）:
- 週を作り、項目を3つ登録して、使える時間2時間と5時間で予定の中身が 4.4 の例と同じになる
- 実績を入れて締めると、進捗の判定が変わる
- ページを再読み込みしてもデータが残る
- 開発者ツールで幅375pxにして横スクロールが出ない

### ステップ4：仕上げ（目安 30分）
依頼文:
> 実際に1日使ってみて気になった点を直したいです。（気になった点を書く）

## フェーズ②：受注案件と納期（目安 2〜3時間）
フェーズ①を1週間ほど使ってから着手する。内容は docs/requirements.md の「6. 今後のフェーズ」。

## フェーズ③：PDCAとの連動（目安 2〜4時間）
フェーズ②のあと、必要になってから着手する。
