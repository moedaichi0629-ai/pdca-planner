const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/planner.js");

// docs/requirements.md 4.4 の例: 週 10/26〜11/1、11/1 は休み（稼働日6日）
function exampleWeek(days = {}) {
  return {
    id: "w_test",
    start: "2026-10-26",
    end: "2026-11-01",
    offDays: ["2026-11-01"],
    items: [
      { id: "sell", name: "出品", unit: "件", target: 3, minutes: 60, priority: 1 },
      { id: "threads", name: "Threads", unit: "投稿", target: 21, minutes: 10, priority: 2 },
      { id: "study", name: "学習", unit: "講義", target: 2, minutes: 60, priority: 3 },
    ],
    days,
  };
}

test("4.4 稼働日は6日", () => {
  assert.equal(P.workdays(exampleWeek()).length, 6);
});

test("4.4 使える時間2時間: 出品1件・Threads 5投稿が入り、学習1講義は入らない", () => {
  const r = P.planDay(exampleWeek(), "2026-10-27", 2);
  assert.deepEqual(r.plan, [
    { itemId: "sell", qty: 1, min: 60 },
    { itemId: "threads", qty: 5, min: 50 },
  ]);
  assert.deepEqual(r.skipped, [{ itemId: "study", qty: 1, min: 60 }]);
});

test("4.4 使える時間5時間: 3項目すべて入る", () => {
  const r = P.planDay(exampleWeek(), "2026-10-27", 5);
  assert.deepEqual(r.plan, [
    { itemId: "sell", qty: 1, min: 60 },
    { itemId: "threads", qty: 5, min: 50 },
    { itemId: "study", qty: 1, min: 60 },
  ]);
  assert.deepEqual(r.skipped, []);
});

test("4.4 10/26 締め済み・実績「出品1・Threads 2」、今日 10/27 の判定", () => {
  const w = exampleWeek({
    "2026-10-26": {
      log: { sell: { qty: 1, min: 60, done: true }, threads: { qty: 2, min: 20, done: true } },
      closed: true,
    },
  });
  assert.equal(P.elapsedDays(w, "2026-10-27"), 1);

  const prog = P.weekProgress(w, "2026-10-27");
  const label = (id) => prog.items.find((i) => i.itemId === id).status.label;
  assert.equal(label("sell"), "予定通り");
  assert.equal(label("threads"), "遅れ");
  assert.equal(label("study"), "遅れ");
});

test("F-06 実績の平均: 全週の同じ名前の項目を集計し、量・時間が0の実績は除く", () => {
  const w1 = exampleWeek({
    "2026-10-26": { log: { sell: { qty: 1, min: 75 }, threads: { qty: 3, min: 0 } } },
    "2026-10-27": { log: { sell: { qty: 2, min: 90 }, threads: { qty: 0, min: 15 } } },
  });
  const w2 = {
    id: "w_next",
    start: "2026-11-02",
    end: "2026-11-08",
    items: [{ id: "x", name: "出品", unit: "件", target: 3, minutes: 60, priority: 1 }],
    days: { "2026-11-02": { log: { x: { qty: 1, min: 75 } } } },
  };
  const weeks = { w_test: w1, w_next: w2 };
  // (75 + 90 + 75) ÷ (1 + 2 + 1) = 60
  assert.equal(P.avgMinutesPerUnit(weeks, "出品"), 60);
  assert.equal(P.avgMinutesPerUnit(weeks, "Threads"), null);
  assert.equal(P.avgMinutesPerUnit(weeks, "学習"), null);
  assert.equal(P.avgMinutesPerUnit(weeks, "存在しない項目"), null);
});

test("F-01 週の期間: 終了日 < 開始日、31日を超える期間は作れない", () => {
  assert.equal(P.validateWeekRange("2026-10-26", "2026-11-01"), null);
  assert.equal(P.validateWeekRange("2026-10-26", "2026-10-26"), null);
  assert.equal(P.validateWeekRange("2026-10-01", "2026-10-31"), null); // 31日
  assert.match(P.validateWeekRange("2026-10-01", "2026-11-01"), /31日まで/); // 32日
  assert.match(P.validateWeekRange("2026-10-27", "2026-10-26"), /終了日/);
  assert.match(P.validateWeekRange("", "2026-10-26"), /入れてください/);
});

test("F-03 日付の初期値: 今日、週の外なら初日か最終日、選んだ日があればその日", () => {
  const w = exampleWeek();
  assert.equal(P.defaultDate(w, "2026-10-28"), "2026-10-28");
  assert.equal(P.defaultDate(w, "2026-10-20"), "2026-10-26");
  assert.equal(P.defaultDate(w, "2026-11-05"), "2026-11-01");
  assert.equal(P.defaultDate(w, "2026-10-28", "2026-10-30"), "2026-10-30");
  assert.equal(P.defaultDate(w, "2026-10-28", "2026-12-01"), "2026-10-28");
});

test("その日の合計: 予定の時間・実績の時間・完了数", () => {
  const day = {
    plan: [{ itemId: "sell", qty: 1, min: 60 }, { itemId: "threads", qty: 5, min: 50 }],
    log: { sell: { qty: 1, min: 75, done: true }, study: { qty: 1, min: 40 }, threads: { qty: "", min: "" } },
  };
  assert.deepEqual(P.daySummary(day), { planMin: 110, actualMin: 115, doneCount: 1, planCount: 2 });
  assert.deepEqual(P.daySummary(undefined), { planMin: 0, actualMin: 0, doneCount: 0, planCount: 0 });
});

// 週 10/26〜11/1 を 10/27〜10/30 に短くした。10/26 と 10/31 の実績はデータに残るが数えない
function shrunkWeek() {
  const w = exampleWeek({
    "2026-10-26": { log: { sell: { qty: 1, min: 60, done: true }, threads: { qty: 2, min: 40, done: true } }, closed: true },
    "2026-10-27": { log: { threads: { qty: 3, min: 30, done: true } }, closed: true },
    "2026-10-31": { log: { sell: { qty: 1, min: 90 } } },
  });
  w.start = "2026-10-27";
  w.end = "2026-10-30";
  return w;
}

test("期間外の実績: 合計に入れない", () => {
  const w = shrunkWeek();
  assert.equal(P.sumLog(w, "sell", () => true), 0);
  assert.equal(P.sumLog(w, "threads", () => true), 3);
});

test("期間外の実績: 今日の必要量に入れない", () => {
  // 10/28 の残り日数 = 10/29・10/30 の2日 + 1 = 3。Threads の残り量 = 21 − 3 = 18 → 1日6投稿
  const r = P.planDay(shrunkWeek(), "2026-10-28", 5);
  assert.deepEqual(r.plan.find((x) => x.itemId === "threads"), { itemId: "threads", qty: 6, min: 60 });
  assert.deepEqual(r.plan.find((x) => x.itemId === "sell"), { itemId: "sell", qty: 1, min: 60 });
});

test("期間外の実績: 進捗（weekProgress）に入れない", () => {
  const pr = P.weekProgress(shrunkWeek(), "2026-10-28");
  const row = (id) => pr.items.find((i) => i.itemId === id);
  assert.equal(pr.totalDays, 4);
  assert.equal(pr.elapsed, 1); // 10/27 のみ。期間外の 10/26 の締めは数えない
  assert.equal(row("sell").actual, 0);
  assert.equal(row("threads").actual, 3);
  assert.equal(row("sell").status.label, "遅れ");
});

test("期間外の実績: 実績の平均に入れない", () => {
  const weeks = { w: shrunkWeek() };
  assert.equal(P.avgMinutesPerUnit(weeks, "Threads"), 10); // 10/27 の 30分 ÷ 3投稿のみ
  assert.equal(P.avgMinutesPerUnit(weeks, "出品"), null);
});

test("期間外の実績: 計算してもデータは消えない", () => {
  const w = shrunkWeek();
  const before = JSON.stringify(w);
  P.planDay(w, "2026-10-28", 5);
  P.weekProgress(w, "2026-10-28");
  P.avgMinutesPerUnit({ w }, "出品");
  assert.equal(JSON.stringify(w), before);
  // 期間を元に戻すと、また数えられる
  w.start = "2026-10-26";
  w.end = "2026-11-01";
  assert.equal(P.sumLog(w, "sell", () => true), 2);
});

test("期間外の休みの日: 稼働日の計算に使わず、期間を戻すとまた使う", () => {
  // 10/26〜11/1（11/1 休み）に 10/26 も休みを足してから、10/27〜10/31 に短くした
  const w = exampleWeek();
  w.offDays = ["2026-10-26", "2026-10-31", "2026-11-01"];
  w.start = "2026-10-27";
  w.end = "2026-10-31";
  assert.deepEqual(P.workdays(w), ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.equal(P.weekProgress(w, "2026-10-28").totalDays, 4);
  // 10/27 の残り日数 = 10/28〜10/30 の3日 + 1 = 4。Threads は ceil(21 ÷ 4) = 6
  assert.equal(P.planDay(w, "2026-10-27", 5).plan.find((x) => x.itemId === "threads").qty, 6);
  assert.deepEqual(w.offDays, ["2026-10-26", "2026-10-31", "2026-11-01"]);

  w.start = "2026-10-26";
  w.end = "2026-11-01";
  assert.deepEqual(P.workdays(w), ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
});

// ---------- 週の重なり（F-01） ----------

test("F-01 ほかの週と1日でも重なる期間は作れない・変えられない", () => {
  const weeks = { w_test: exampleWeek() }; // 10/26〜11/1
  assert.equal(P.validateWeekRange("2026-10-19", "2026-10-25", weeks), null);
  assert.equal(P.validateWeekRange("2026-11-02", "2026-11-08", weeks), null);
  assert.match(P.validateWeekRange("2026-10-20", "2026-10-26", weeks), /ほかの週（10\/26〜11\/1）と重なっています/);
  assert.match(P.validateWeekRange("2026-11-01", "2026-11-07", weeks), /重なっています/);
  assert.match(P.validateWeekRange("2026-10-28", "2026-10-29", weeks), /重なっています/); // 中に入る
  assert.match(P.validateWeekRange("2026-10-01", "2026-10-31", weeks), /重なっています/); // 外から包む
  // 編集中の週自身とは比べない
  assert.equal(P.validateWeekRange("2026-10-25", "2026-10-31", weeks, "w_test"), null);
});

// ---------- 月（4.5） ----------

// 週 10/19〜10/25 と 10/26〜11/1。Threads の実績は 10/20 に5、10/31 に3、11/1 に4
function monthWeeks() {
  const wA = {
    id: "w_a",
    start: "2026-10-19",
    end: "2026-10-25",
    offDays: [],
    items: [{ id: "th_a", name: "Threads", unit: "投稿", target: 21, minutes: 10, priority: 1 }],
    days: { "2026-10-20": { log: { th_a: { qty: 5, min: 50 } }, closed: true } },
  };
  const wB = exampleWeek({
    "2026-10-31": { log: { threads: { qty: 3, min: 30 } } },
    "2026-11-01": { log: { threads: { qty: 4, min: 40 } } },
  });
  return { w_a: wA, w_test: wB };
}

const weeklyGoal = { id: "g_th", name: "Threads", unit: "投稿", target: 93, stretch: null, source: "weekly", entries: [] };
const salesGoal = {
  id: "g_sales",
  name: "売上",
  unit: "円",
  target: 50000,
  stretch: 100000,
  source: "manual",
  entries: [
    { id: "e1", date: "2026-10-31", qty: 30000, memo: "10月分" },
    { id: "e2", date: "2026-11-01", qty: 8000, memo: "11月分" },
  ],
};

test("4.5 必須の例: 週 10/26〜11/1 の 10/31 の実績は10月、11/1 の実績は11月に入る", () => {
  const weeks = { w_test: monthWeeks().w_test };
  const oct = P.monthProgress({ month: "2026-10", goals: [weeklyGoal, salesGoal] }, weeks, "2026-11-05");
  const nov = P.monthProgress({ month: "2026-11", goals: [weeklyGoal, salesGoal] }, weeks, "2026-11-05");
  assert.equal(oct.goals[0].actual, 3);
  assert.equal(nov.goals[0].actual, 4);
  assert.equal(oct.goals[1].actual, 30000);
  assert.equal(nov.goals[1].actual, 8000);

  const octCp = P.monthCheckpoints({ month: "2026-10", goals: [weeklyGoal] }, weeks, "2026-11-05");
  const novCp = P.monthCheckpoints({ month: "2026-11", goals: [weeklyGoal] }, weeks, "2026-11-05");
  assert.deepEqual([octCp[0].start, octCp[0].end, octCp[0].goals[0].actual], ["2026-10-26", "2026-10-31", 3]);
  assert.deepEqual([novCp[0].start, novCp[0].end, novCp[0].goals[0].actual], ["2026-11-01", "2026-11-01", 4]);
});

test("4.5 週の項目から集めるとき、週の期間の外の実績は月にも入らない", () => {
  const weeks = monthWeeks();
  weeks.w_test.end = "2026-10-30"; // 10/31・11/1 の実績は期間の外になる
  assert.equal(P.goalActual(weeklyGoal, weeks, "2026-10"), 5);
  assert.equal(P.goalActual(weeklyGoal, weeks, "2026-11"), 0);
});

test("4.5 同じ名前の項目がなければ実績0で、つながっていないと分かる", () => {
  const g = { ...weeklyGoal, name: "存在しない項目" };
  assert.equal(P.goalActual(g, monthWeeks(), "2026-10"), 0);
  assert.equal(P.goalLinked(g, monthWeeks(), "2026-10"), false);
  assert.equal(P.goalLinked(weeklyGoal, monthWeeks(), "2026-10"), true);
  assert.equal(P.goalLinked(weeklyGoal, monthWeeks(), "2026-12"), false); // 12月にかかる週はない
  assert.equal(P.goalLinked(salesGoal, {}, "2026-10"), true); // 手入力はつながりを問わない
});

test("4.5 経過日数: 暦の日数で、今日を締めていれば1を足す", () => {
  const weeks = monthWeeks();
  assert.equal(P.monthElapsedDays("2026-10", "2026-10-29", weeks), 28);
  weeks.w_test.days["2026-10-29"] = { closed: true };
  assert.equal(P.monthElapsedDays("2026-10", "2026-10-29", weeks), 29);
  assert.equal(P.monthElapsedDays("2026-10", "2026-11-05", weeks), 31); // 月が終わった
  assert.equal(P.monthElapsedDays("2026-11", "2026-10-29", weeks), 0); // まだ始まっていない
  assert.equal(P.monthElapsedDays("2026-10", "2026-10-01", weeks), 0);
});

test("4.5 判定は週と同じ表（終わっているはずの量 = 目標 × 経過日数 ÷ 月の日数）", () => {
  // 10/29（締めていない）→ 経過28日。93 × 28 ÷ 31 = 84
  const status = (qty) => {
    const g = { ...weeklyGoal, source: "manual", entries: [{ id: "e", date: "2026-10-05", qty }] };
    return P.monthProgress({ month: "2026-10", goals: [g] }, {}, "2026-10-29").goals[0].status.label;
  };
  assert.equal(status(84), "予定通り");
  assert.equal(status(70), "遅れ気味"); // 83%
  assert.equal(status(60), "遅れ"); // 71%
  assert.equal(status(93), "達成");
  const before = P.monthProgress({ month: "2026-11", goals: [weeklyGoal] }, {}, "2026-10-29");
  assert.equal(before.goals[0].status.label, "これから");
  const none = P.monthProgress({ month: "2026-10", goals: [{ ...salesGoal, target: 0 }] }, {}, "2026-10-29");
  assert.equal(none.goals[0].status.label, "目標なし");
});

test("4.5 挑戦目標がある行は、目標と挑戦目標の両方の達成率を出す", () => {
  const g = { ...salesGoal, entries: [{ id: "e", date: "2026-10-10", qty: 60000 }] };
  const pr = P.monthProgress({ month: "2026-10", goals: [g, weeklyGoal] }, {}, "2026-10-29");
  assert.deepEqual([pr.goals[0].pct, pr.goals[0].stretchPct, pr.goals[0].status.label], [120, 60, "達成"]);
  assert.equal(pr.goals[1].stretchPct, null);
  assert.equal(pr.totalDays, 31);
  assert.equal(pr.elapsed, 28);
});

test("4.5 週末ごとの進み具合: 月の中に区切り、月の初日からの累計を出し、途中の週が分かる", () => {
  const cp = P.monthCheckpoints({ month: "2026-10", goals: [weeklyGoal, salesGoal] }, monthWeeks(), "2026-10-29");
  assert.equal(cp.length, 2);
  // 10/19〜10/25: 累計5投稿（5/93 = 5%）、売上0。終わっている週
  assert.deepEqual(
    { start: cp[0].start, end: cp[0].end, inProgress: cp[0].inProgress, expectedPct: cp[0].expectedPct },
    { start: "2026-10-19", end: "2026-10-25", inProgress: false, expectedPct: 81 }
  );
  assert.deepEqual(cp[0].goals, [
    { goalId: "g_th", actual: 5, pct: 5, stretchPct: null },
    { goalId: "g_sales", actual: 0, pct: 0, stretchPct: 0 },
  ]);
  // 10/26〜10/31（11/1 は区切る）: 累計 5 + 3 = 8、売上 30000。今日 10/29 はまだ過ぎていない → 途中
  assert.deepEqual([cp[1].start, cp[1].end, cp[1].inProgress, cp[1].expectedPct], ["2026-10-26", "2026-10-31", true, 100]);
  assert.deepEqual(cp[1].goals, [
    { goalId: "g_th", actual: 8, pct: 9, stretchPct: null },
    { goalId: "g_sales", actual: 30000, pct: 60, stretchPct: 30 },
  ]);
  // 週の最終日（区切った日）が今日なら、まだ途中
  assert.equal(P.monthCheckpoints({ month: "2026-10", goals: [] }, monthWeeks(), "2026-10-25")[0].inProgress, true);
  assert.equal(P.monthCheckpoints({ month: "2026-10", goals: [] }, monthWeeks(), "2026-10-26")[0].inProgress, false);
});

test("4.5 月の日付: 年をまたぐ切り替え・月の日数", () => {
  assert.equal(P.addMonths("2026-12", 1), "2027-01");
  assert.equal(P.addMonths("2027-01", -1), "2026-12");
  assert.equal(P.monthOf("2026-10-31"), "2026-10");
  assert.equal(P.daysInMonth("2026-11"), 30);
  assert.equal(P.daysInMonth("2028-02"), 29);
  assert.deepEqual(P.monthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
});

test("F-08 手入力の実績の確認", () => {
  assert.equal(P.validateMonthEntry("2026-10-31", "12000", "2026-10"), null);
  assert.equal(P.validateMonthEntry("2026-10-31", 0, "2026-10"), null);
  assert.match(P.validateMonthEntry("2026-11-01", "1", "2026-10"), /10月の中の日/);
  assert.match(P.validateMonthEntry("", "1", "2026-10"), /日付を入れて/);
  assert.match(P.validateMonthEntry("2026-10-31", "", "2026-10"), /0以上/);
  assert.match(P.validateMonthEntry("2026-10-31", "-1", "2026-10"), /0以上/);
});

test("F-08 前の月の目標を引き継ぐ: 名前・単位・目標量・挑戦目標・集め方だけを写す", () => {
  let n = 0;
  const copied = P.copyMonthGoals([weeklyGoal, salesGoal], () => `new_${++n}`);
  assert.deepEqual(copied, [
    { id: "new_1", name: "Threads", unit: "投稿", target: 93, stretch: null, source: "weekly", entries: [] },
    { id: "new_2", name: "売上", unit: "円", target: 50000, stretch: 100000, source: "manual", entries: [] },
  ]);
  assert.equal(salesGoal.entries.length, 2); // 元の月の実績は残る
});
