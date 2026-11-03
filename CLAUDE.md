# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

- 月・週のPDCAで決めた「週の目標」を、1日単位の行動に落とし込む個人用ツール
- 作業開始時にその日に使える時間を入れると、今日やることと所要時間を計算して出す
- 終わったら実績をチェックし、週の進捗（予定通り／遅れ気味／遅れ）を表示する
- 使う人は本人1人。PC のブラウザで `index.html` を開いて使う

詳細は以下を参照すること。
- 要件・計算ルール・データ設計: `docs/requirements.md`
- 開発の手順（フェーズごと）: `docs/development_plan.md`
- 参考実装（claude.ai の Artifact 版の試作）: `docs/reference/artifact-prototype.html`

## 現在のプロジェクト状態

フェーズ①のステップ1〜3（計算ロジック・保存処理・画面）を実装済み。あわせて、月のPDCA欄（F-08〜F-10）、文章からまとめて登録（F-11）、毎日すること（F-12）、カテゴリーと時間の割合・今日の内訳（F-13）、曜日指定（F-14）、1日の最低時間（F-15）、犬のキャラクターと歌舞伎のデザイン（F-16）も実装済み。次はステップ4（1日使ってみての仕上げ）。

## 技術スタック

- HTML / CSS / JavaScript（ビルドなし・ライブラリなし）
- 保存先: ブラウザの localStorage（JSON の書き出し・読み込みでバックアップ）
- テスト: Node.js 標準の `node:test`（追加パッケージなし）

## コマンド

- `npm test` — 計算ロジックのテスト（`tests/*.test.js`）
- 動作確認: `index.html` をブラウザで直接開く（サーバー不要）

## アーキテクチャ

```
index.html        画面（タブ: 今日 / 週の進捗 / 月 / 週の設定）
src/style.css     スタイル（歌舞伎のデザイン・犬のキャラクターの動き）
src/mascot.svg    ブラウザのタブのアイコン（犬のキャラクターのふつうの顔）
personal/         自分だけの画像（hero.jpg）。.gitignore で除外。なくても動く
src/planner.js    計算ロジック（純粋関数のみ。DOM・localStorage に触らない）
src/parser.js     PDCA の文章の読み取り（純粋関数のみ。F-11）
src/storage.js    localStorage の読み書き、JSON 書き出し・読み込み
src/app.js        画面の描画とイベント処理
tests/            planner.js・parser.js・storage.js のテスト
```

### 不変条件

- `index.html` を `file://` で直接開いて動くこと。そのため `<script type="module">` は使わない（file:// では読み込めない）。通常の `<script src>` で `planner.js → parser.js → storage.js → app.js` の順に読み込む。
- `src/planner.js` はブラウザでは `window.Planner`、Node では `module.exports` で同じ関数を公開する（末尾で `typeof module !== "undefined"` を見て切り替える）。テストは `require("../src/planner.js")` で読み込む。`src/parser.js` も同じ形で、ブラウザでは `window.PlannerParser`。
- 計算ルール（必要量・割り振り・判定）と文章の読み取りのルール（4.6）は `docs/requirements.md` が正。変えるときはドキュメントとテストも同時に直す。
- localStorage のデータには `schemaVersion` を持たせ、形を変えるときは読み込み時に移行処理を書く（既存データを消さない）。
- 日付は `YYYY-MM-DD` の文字列で扱い、ローカル時刻で計算する（`toISOString()` は UTC になりずれるので使わない）。

## コーディングルール

- 重複コードを避ける。計算は必ず `planner.js` に置き、`app.js` に計算式を書かない
- ユーザー入力（数値・日付）は検証してから保存する。数値は 0 未満にしない
- 画面に出す文字列は必ずエスケープする（項目名に `<` などが入っても壊れないように）
- 既存の実装を確認してから変更する

## 命名規則

- 関数・変数: camelCase
- ファイル名: kebab-case（1語なら小文字のみ）

## UI

- スマホでも崩れないこと（幅 375px で横スクロールが出ない）。ただし主な利用は PC
- 迷わず使えるシンプルな画面。ボタンの文言は押した結果がわかる言葉にする（例「予定を作る」「この日を締める」）
- ライトモード・ダークモードの両方で読めること

## 開発ルール

- 大きな変更をする前に Plan を提示する
- 一度に複数の大きな機能を実装しない。`docs/development_plan.md` のフェーズ・ステップ単位で進める
- 1ステップごとに `npm test` とブラウザでの動作確認をする
- 「ツール作りに時間をかけすぎない」ことが本人の方針。フェーズ①を半日で使い始められる範囲に保ち、②③は使い始めてから着手する
