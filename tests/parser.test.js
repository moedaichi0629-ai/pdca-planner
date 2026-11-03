const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/parser.js");

const NOVEMBER = `━━━━━━━━━━━━━
💰 11月 収益化PDCA
━━━━━━━━━━━━━
【Plan】
・売上：30,000円以上
→ 最低目標：10,000円
→ 挑戦目標：50,000円
・ココナラ受注：2件以上
・ココナラサービス分析：30日間
・ココナラ競合調査：12サービス
・ココナラサービス改善：6商品
・ココナラ新商品出品：1商品
・ココナラブログ投稿：12記事
・Threads（AI・業務自動化）：80投稿
・Threads（バドミントン×メンタル）：80投稿
・Threads（バドミントン×メンタル）：フォロワー100人
・Threads投稿分析・改善：各アカウント4回
・note：バドミントンアカウントのフォロワー50人達成後、記事制作開始`;

const pick = (r) => [r.name, r.target, r.unit, r.minimum, r.stretch, r.include];

test("F-11 11月の文章: 12目標と最低・挑戦をすべて読み取る", () => {
  const r = R.parsePdcaText(NOVEMBER, "2026-11-03");
  assert.deepEqual(r.period, { kind: "month", month: "2026-11" });
  assert.deepEqual(r.rows.map(pick), [
    ["売上", 30000, "円", 10000, 50000, true],
    ["ココナラ受注", 2, "件", null, null, true],
    ["ココナラサービス分析", 30, "日間", null, null, true],
    ["ココナラ競合調査", 12, "サービス", null, null, true],
    ["ココナラサービス改善", 6, "商品", null, null, true],
    ["ココナラ新商品出品", 1, "商品", null, null, true],
    ["ココナラブログ投稿", 12, "記事", null, null, true],
    ["Threads（AI・業務自動化）", 80, "投稿", null, null, true],
    ["Threads（バドミントン×メンタル）", 80, "投稿", null, null, true],
    ["Threads（バドミントン×メンタル）フォロワー", 100, "人", null, null, true],
    ["Threads投稿分析・改善（各アカウント）", 4, "回", null, null, true],
    ["note", null, "", null, null, false],
  ]);
  assert.equal(r.rows[11].error, "数値が読み取れません");
  assert.ok(r.rows.slice(0, 11).every((x) => x.error === null));
  assert.equal(r.rows[0].line, "・売上：30,000円以上");
  assert.deepEqual(r.skipped, []);
});

test("F-11 【Do】などの次の見出しが来たら読むのをやめる", () => {
  const text = `${NOVEMBER}\n\n【Do】\n・売上：12,000円\n・ココナラ受注：1件\n【Check】\n・メモ：3件`;
  const r = R.parsePdcaText(text, "2026-11-03");
  assert.equal(r.rows.length, 12);
  assert.equal(r.rows[0].target, 30000);
});

test("F-11 【Plan】がなければ全体を読む。━ と空行は無視し、読めない行は skipped に入る", () => {
  const r = R.parsePdcaText("━━━\n📅 11/2〜11/8 第2週PDCA\n\n・Threads：21投稿\nメモ書き\n・出品:3件", "2026-11-03");
  assert.deepEqual(r.period, { kind: "week", start: "2026-11-02", end: "2026-11-08" });
  assert.deepEqual(r.rows.map((x) => [x.name, x.target, x.unit]), [["Threads", 21, "投稿"], ["出品", 3, "件"]]);
  assert.deepEqual(r.skipped, ["メモ書き"]);
});

test("F-11 週の見出し: 期間を読み、年をまたぐ週は終わりを翌年にする", () => {
  assert.deepEqual(R.parsePeriod("📅 11/2〜11/8 第2週PDCA", "2026-11-03"), { kind: "week", start: "2026-11-02", end: "2026-11-08" });
  assert.deepEqual(R.parsePeriod("📅 12/28〜1/3 第1週PDCA", "2026-12-20"), { kind: "week", start: "2026-12-28", end: "2027-01-03" });
  assert.deepEqual(R.parsePeriod("📅 １１／２～１１／８", "2026-11-03"), { kind: "week", start: "2026-11-02", end: "2026-11-08" });
  assert.equal(R.parsePeriod("2/30〜3/5", "2026-02-10"), null); // ない日付
  assert.equal(R.parsePeriod("収益化PDCA", "2026-11-03"), null);
});

test("F-11 年は今日にいちばん近い年（前後6か月以内）にする", () => {
  const month = (line, today) => R.parsePeriod(line, today).month;
  assert.equal(month("10月", "2026-11-03"), "2026-10");
  assert.equal(month("1月", "2026-11-03"), "2027-01");
  assert.equal(month("5月", "2026-11-03"), "2026-05");
  assert.equal(month("12月", "2027-01-10"), "2026-12");
  // 週の日付も同じ決め方
  assert.equal(R.parsePeriod("12/28〜1/3", "2027-01-02").start, "2026-12-28");
});

test("F-11 1行の読み取り: カンマ・以上・各〜・コロンの全角半角", () => {
  assert.deepEqual(pick(R.parseGoalLine("・売上:1,500円 以上")), ["売上", 1500, "円", null, null, true]);
  assert.deepEqual(pick(R.parseGoalLine("・分析：各アカウント４回")), ["分析（各アカウント）", 4, "回", null, null, true]);
  assert.deepEqual(pick(R.parseGoalLine("・学習：2")), ["学習", 2, "", null, null, true]);
  assert.equal(R.parseGoalLine("・学習：毎日").include, false); // 数字がない
  assert.equal(R.parseGoalLine("・学習 3講義").include, false); // コロンがない
  assert.equal(R.parseGoalLine("・学習：3講義 以上を目指して頑張る").include, false); // 単位の後ろに文が続く
});
