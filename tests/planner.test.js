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
  assert.deepEqual(P.daySummary(day), { planMin: 110, actualMin: 115, extraMin: 0, doneCount: 1, planCount: 2 });
  assert.deepEqual(P.daySummary(undefined), { planMin: 0, actualMin: 0, extraMin: 0, doneCount: 0, planCount: 0 });
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
    { id: "new_1", name: "Threads", unit: "投稿", target: 93, minimum: null, stretch: null, source: "weekly", categoryId: null, entries: [] },
    { id: "new_2", name: "売上", unit: "円", target: 50000, minimum: null, stretch: 100000, source: "manual", categoryId: null, entries: [] },
  ]);
  assert.equal(salesGoal.entries.length, 2); // 元の月の実績は残る
});

test("4.5 最低目標がある行は、最低・目標・挑戦の3つの達成率を出す。判定は目標に対して出す", () => {
  const g = { ...salesGoal, minimum: 20000, entries: [{ id: "e", date: "2026-10-10", qty: 30000 }] };
  const pr = P.monthProgress({ month: "2026-10", goals: [g, weeklyGoal] }, {}, "2026-10-29");
  assert.deepEqual([pr.goals[0].minimumPct, pr.goals[0].pct, pr.goals[0].stretchPct], [150, 60, 30]);
  assert.equal(pr.goals[0].status.label, "遅れ"); // 30000 / (50000×28/31) = 66%
  assert.equal(pr.goals[1].minimumPct, null);
  const copied = P.copyMonthGoals([g], () => "x");
  assert.equal(copied[0].minimum, 20000);
});

// ---------- 4.6 文章からまとめて登録 ----------
test("4.6 週の項目の初期値: 登録先の週 → 前の週の同じ名前 → 30分・優先度3", () => {
  const weeks = {
    a: { id: "a", start: "2026-10-19", end: "2026-10-25", items: [{ id: "1", name: "出品", minutes: 45, priority: 2 }] },
    b: { id: "b", start: "2026-10-26", end: "2026-11-01", items: [{ id: "2", name: "出品", minutes: 60, priority: 1 }] },
    c: { id: "c", start: "2026-11-09", end: "2026-11-15", items: [{ id: "3", name: "出品", minutes: 99, priority: 5 }] },
  };
  const pick = (x) => ({ minutes: x.minutes, priority: x.priority });
  assert.deepEqual(pick(P.itemDefaults(weeks, "出品", "2026-11-02")), { minutes: 60, priority: 1 }); // 後ろの週は見ない
  assert.deepEqual(pick(P.itemDefaults(weeks, "出品", "2026-11-02", [{ name: "出品", minutes: 15, priority: 4 }])), { minutes: 15, priority: 4 });
  assert.deepEqual(P.itemDefaults(weeks, "学習", "2026-11-02"), { minutes: 30, priority: 3, categoryId: null, daily: false, dailyQty: null, dailyMin: null, weekdays: [], minDailyMin: null });
});

test("4.6 月の目標の集め方の初期値: 今の目標 → その月の週に同じ名前があれば週の項目から → 手で入力", () => {
  const weeks = { a: { id: "a", start: "2026-10-26", end: "2026-11-01", items: [{ id: "1", name: "Threads" }] } };
  assert.equal(P.goalSourceDefault(weeks, "2026-11", "Threads"), "weekly");
  assert.equal(P.goalSourceDefault(weeks, "2026-12", "Threads"), "manual");
  assert.equal(P.goalSourceDefault(weeks, "2026-11", "売上"), "manual");
  assert.equal(P.goalSourceDefault(weeks, "2026-11", "Threads", [{ name: "Threads", source: "manual" }]), "manual");
});

test("4.6 確認画面の行の確認", () => {
  const ok = P.normalizeImportRows([
    { include: true, name: " 売上 ", target: "30000", unit: "円", minimum: "10000", stretch: "", source: "manual" },
    { include: false, name: "note", target: "" },
  ], "month");
  assert.deepEqual(ok, { ok: true, rows: [{ name: "売上", unit: "円", target: 30000, minimum: 10000, stretch: null, source: "manual", categoryId: null }] });
  const w = P.normalizeImportRows([{ include: true, name: "出品", target: 3, unit: "件", minutes: "60", priority: "1", minimum: 9 }], "week");
  // 週では最低・挑戦を使わない
  assert.deepEqual(w.rows, [{ name: "出品", unit: "件", target: 3, minutes: 60, priority: 1, categoryId: null, daily: false, dailyQty: null, dailyMin: null, weekdays: [], minDailyMin: null }]);
  assert.match(P.normalizeImportRows([{ include: true, name: "", target: 1 }], "month").error, /名前/);
  assert.match(P.normalizeImportRows([{ include: true, name: "a", target: "" }], "month").error, /目標量/);
  assert.match(P.normalizeImportRows([{ include: true, name: "a", target: -1 }], "month").error, /目標量/);
  assert.match(P.normalizeImportRows([{ include: true, name: "a", target: 1, stretch: -5 }], "month").error, /挑戦目標/);
  assert.match(P.normalizeImportRows([{ include: true, name: "a", target: 1 }, { include: true, name: "a", target: 2 }], "month").error, /2回/);
  assert.match(P.normalizeImportRows([{ include: true, name: "a", target: 1, minutes: 30, priority: 6 }], "week").error, /優先度/);
  assert.match(P.normalizeImportRows([{ include: false, name: "a", target: 1 }], "month").error, /登録する行がありません/);
});

test("4.6 月の目標への反映: 上書き・追加と、すべて置き換え（同じ名前は id と実績を引き継ぐ）", () => {
  const goals = [
    { id: "g1", name: "売上", unit: "円", target: 50000, minimum: null, stretch: 100000, source: "manual", entries: [{ id: "e", date: "2026-11-01", qty: 1 }] },
    { id: "g2", name: "受注", unit: "件", target: 1, minimum: null, stretch: null, source: "manual", entries: [{ id: "e2", date: "2026-11-01", qty: 1 }] },
    { id: "g3", name: "学習", unit: "講義", target: 4, minimum: null, stretch: null, source: "weekly", entries: [] },
  ];
  const rows = [
    { name: "売上", unit: "円", target: 30000, minimum: 10000, stretch: null, source: "manual" },
    { name: "ブログ", unit: "記事", target: 12, minimum: null, stretch: null, source: "manual" },
  ];
  let n = 0;
  const m = P.mergeMonthGoals(goals, rows, "merge", () => `new${++n}`);
  assert.deepEqual(m.goals.map((g) => [g.id, g.name, g.target, g.stretch]), [["g1", "売上", 30000, null], ["g2", "受注", 1, null], ["g3", "学習", 4, null], ["new1", "ブログ", 12, null]]);
  assert.equal(m.goals[0].entries.length, 1);
  assert.deepEqual([m.added, m.updated, m.removed], [1, 1, []]);

  const r = P.mergeMonthGoals(goals, rows, "replace", () => "new");
  assert.deepEqual(r.goals.map((g) => [g.id, g.name]), [["g1", "売上"], ["new", "ブログ"]]);
  assert.equal(r.goals[0].entries.length, 1);
  assert.deepEqual(r.removed, [{ name: "受注", hasRecord: true }, { name: "学習", hasRecord: false }]);
  assert.equal(goals[0].target, 50000); // 元の配列は変えない
});

test("4.6 週の項目への反映: 消える項目に週の中の実績があるかを返す", () => {
  const week = {
    id: "w", start: "2026-11-02", end: "2026-11-08",
    items: [{ id: "i1", name: "出品", unit: "件", target: 3, minutes: 60, priority: 1 }, { id: "i2", name: "学習", unit: "講義", target: 2, minutes: 60, priority: 3 }],
    days: { "2026-11-02": { log: { i2: { qty: 1, min: 60 } } } },
  };
  const rows = [{ name: "出品", unit: "件", target: 5, minutes: 45, priority: 2 }];
  const m = P.mergeWeekItems(week, rows, "merge", () => "x");
  assert.deepEqual(m.items.map((i) => [i.id, i.target, i.minutes]), [["i1", 5, 45], ["i2", 2, 60]]);
  const r = P.mergeWeekItems(week, rows, "replace", () => "x");
  assert.deepEqual(r.items.map((i) => i.id), ["i1"]);
  assert.deepEqual(r.removed, [{ name: "学習", hasRecord: true }]);
  // 新しい週（week なし）
  assert.deepEqual(P.mergeWeekItems(null, rows, "replace", () => "n").items, [{ id: "n", ...rows[0] }]);
});

test("4.6 開始日・終了日が同じ週を探す", () => {
  const weeks = { a: { id: "a", start: "2026-11-02", end: "2026-11-08" } };
  assert.equal(P.findWeekByRange(weeks, "2026-11-02", "2026-11-08").id, "a");
  assert.equal(P.findWeekByRange(weeks, "2026-11-02", "2026-11-07"), null);
});

// ---------- F-12 毎日すること・F-13 カテゴリー ----------
const CATS = [
  { id: "c_coco", name: "ココナラ", ratio: 50 },
  { id: "c_th", name: "Threads", ratio: 30 },
  { id: "c_study", name: "学習", ratio: 20 },
];

// 週 11/2〜11/8（休みなし）。11/2 の予定を作る（残り日数7）
function catWeek(items, offDays = []) {
  return { id: "w_cat", start: "2026-11-02", end: "2026-11-08", offDays, items, days: {} };
}

test("4.2 必須の例: 3時間・毎日すること30分（カテゴリーなし）・50/30/20% → 75・45・30分。学習の余り10分がほかのカテゴリーに回る", () => {
  const w = catWeek([
    { id: "daily", name: "Threads（AI・業務自動化）", unit: "投稿", target: 21, minutes: 10, priority: 1, daily: true, dailyQty: 3, dailyMin: 30 },
    { id: "coco", name: "ココナラ競合調査", unit: "サービス", target: 70, minutes: 10, priority: 1, categoryId: "c_coco" }, // 必要量10 = 100分
    { id: "th", name: "Threads分析", unit: "回", target: 70, minutes: 15, priority: 2, categoryId: "c_th" }, // 必要量10 = 150分
    { id: "study", name: "学習", unit: "講義", target: 7, minutes: 20, priority: 3, categoryId: "c_study" }, // 必要量1 = 20分
  ]);
  const r = P.planDay(w, "2026-11-02", 3, CATS);
  assert.equal(r.alloc.dailyMin, 30);
  assert.deepEqual(r.alloc.budgets, [
    { categoryId: "c_coco", min: 75 },
    { categoryId: "c_th", min: 45 },
    { categoryId: "c_study", min: 30 },
  ]);
  // ココナラ 75分 → 7件(70分)・余り5。Threads 45分 → 3回(45分)。学習 20分・余り10。
  // 余り 5 + 10 = 15分を割合の大きい順に回す: ココナラにもう1件(10分)、残り5分は Threads(15分)に足りない
  assert.deepEqual(r.plan, [
    { itemId: "daily", qty: 3, min: 30, daily: true },
    { itemId: "coco", qty: 8, min: 80, categoryId: "c_coco" },
    { itemId: "th", qty: 3, min: 45, categoryId: "c_th" },
    { itemId: "study", qty: 1, min: 20, categoryId: "c_study" },
  ]);
  assert.deepEqual(r.skipped, [
    { itemId: "coco", qty: 2, min: 20, categoryId: "c_coco" },
    { itemId: "th", qty: 7, min: 105, categoryId: "c_th" },
  ]);
});

test("4.2 余った時間は、学習カテゴリーからほかのカテゴリーの入りきっていない項目に回る", () => {
  const w = catWeek([
    { id: "coco", name: "出品", unit: "件", target: 7, minutes: 80, priority: 1, categoryId: "c_coco" }, // 1件80分 > 75分
    { id: "th", name: "投稿", unit: "投稿", target: 70, minutes: 5, priority: 1, categoryId: "c_th" }, // 10投稿 = 50分 > 45分
    { id: "study", name: "学習", unit: "講義", target: 7, minutes: 20, priority: 1, categoryId: "c_study" },
  ]);
  const r = P.planDay(w, "2026-11-02", 2.5, CATS); // 150分 → 75・45・30
  // 余り: ココナラ75 + Threads 0 + 学習10 = 85分 → ココナラ（50%）が先に出品1件80分、残り5分で投稿1
  assert.deepEqual(r.plan.map((x) => [x.itemId, x.qty, x.min]), [["coco", 1, 80], ["th", 10, 50], ["study", 1, 20]]);
  assert.deepEqual(r.skipped, []);
});

test("4.2 割合の合計が100%でないときは合計に対する比で分ける（合計80%）", () => {
  const cats = [{ id: "a", name: "A", ratio: 40 }, { id: "b", name: "B", ratio: 40 }];
  const r = P.planDay(catWeek([]), "2026-11-02", 2, cats);
  assert.deepEqual(r.alloc.budgets, [{ categoryId: "a", min: 60 }, { categoryId: "b", min: 60 }]);
  assert.equal(P.ratioTotal(cats), 80);
});

test("4.2 その他（未選択・削除済みのカテゴリー）は、カテゴリーで余った時間だけを使う", () => {
  const w = catWeek([
    { id: "coco", name: "出品", unit: "件", target: 70, minutes: 10, priority: 1, categoryId: "c_coco" }, // 10件 = 100分
    { id: "free", name: "掃除", unit: "回", target: 7, minutes: 20, priority: 1 }, // その他
    { id: "gone", name: "旧", unit: "回", target: 7, minutes: 10, priority: 2, categoryId: "c_deleted" }, // その他
  ]);
  const cats = [{ id: "c_coco", name: "ココナラ", ratio: 100 }];
  const short = P.planDay(w, "2026-11-02", 1.5, cats); // 90分すべてココナラ
  assert.deepEqual(short.plan.map((x) => x.itemId), ["coco"]);
  assert.deepEqual(short.skipped.map((x) => x.itemId), ["coco", "free", "gone"]);
  assert.equal("categoryId" in short.skipped[2], false);
  const enough = P.planDay(w, "2026-11-02", 2.5, cats); // 150分 → ココナラ100分、余り50分をその他へ
  assert.deepEqual(enough.plan.map((x) => [x.itemId, x.min]), [["coco", 100], ["free", 20], ["gone", 10]]);
});

test("4.2 毎日すること: 1日の量と時間を使い、残り量が少なければ量の割合で時間を減らす。残り0なら入れない", () => {
  const items = [
    { id: "d1", name: "投稿", unit: "投稿", target: 21, minutes: 0, priority: 2, daily: true, dailyQty: 3, dailyMin: 30 },
    { id: "d2", name: "日記", unit: "回", target: 7, minutes: 0, priority: 1, daily: true, dailyQty: 1, dailyMin: 10 },
  ];
  const w = catWeek(items);
  w.days = {
    "2026-11-02": { log: { d1: { qty: 19 } } }, // 残り2投稿
    "2026-11-03": { log: { d2: { qty: 7 } } }, // 残り0
  };
  const r = P.planDay(w, "2026-11-04", 2);
  assert.deepEqual(r.plan, [{ itemId: "d1", qty: 2, min: 20, daily: true }]);
  assert.deepEqual(r.alloc, { dailyMin: 20, budgets: [], dailyShort: false });
});

test("4.2 毎日することだけで時間が足りないときは、入らない分を skipped に出して dailyShort", () => {
  const w = catWeek([
    { id: "d1", name: "投稿", unit: "投稿", target: 21, priority: 1, daily: true, dailyQty: 3, dailyMin: 30 },
    { id: "d2", name: "学習", unit: "講義", target: 7, priority: 2, daily: true, dailyQty: 1, dailyMin: 60 },
    { id: "n", name: "出品", unit: "件", target: 7, minutes: 10, priority: 1 },
  ]);
  const r = P.planDay(w, "2026-11-02", 0.5);
  assert.deepEqual(r.plan, [{ itemId: "d1", qty: 3, min: 30, daily: true }]);
  assert.deepEqual(r.skipped, [{ itemId: "d2", qty: 1, min: 60, daily: true }, { itemId: "n", qty: 1, min: 10 }]);
  assert.equal(r.alloc.dailyShort, true);
});

test("4.2 休みの日は毎日やる項目を入れない。カテゴリーがなければ今までどおり優先度順", () => {
  const w = catWeek([
    { id: "d1", name: "投稿", unit: "投稿", target: 21, minutes: 10, priority: 1, daily: true, dailyQty: 3, dailyMin: 30 },
    { id: "n", name: "出品", unit: "件", target: 7, minutes: 60, priority: 2 },
  ], ["2026-11-02"]);
  const r = P.planDay(w, "2026-11-02", 2);
  assert.deepEqual(r.plan, [{ itemId: "n", qty: 1, min: 60 }]);
  assert.deepEqual(r.skipped, []);
});

test("4.3 毎日やる項目の残りの作業時間は「今かかっている時間 ÷ 1日にやる量」で数える", () => {
  const w = catWeek([{ id: "d1", name: "投稿", unit: "投稿", target: 21, minutes: 99, priority: 1, daily: true, dailyQty: 3, dailyMin: 30 }]);
  assert.equal(P.weekProgress(w, "2026-11-02").remainingMin, 210);
  assert.equal(P.perUnitMin({ minutes: 15 }), 15);
});

test("4.7 今日の内訳: 予定は作った時点の区分、実績は予定の区分か今の区分で数える", () => {
  const items = [
    { id: "daily", name: "投稿", daily: true, dailyQty: 3, dailyMin: 30 },
    { id: "coco", name: "出品", categoryId: "c_coco" },
    { id: "extra", name: "掃除" }, // 予定外にやった（その他）
  ];
  const day = {
    hours: 3,
    plan: [
      { itemId: "daily", qty: 3, min: 30, daily: true },
      { itemId: "coco", qty: 7, min: 70, categoryId: "c_coco" },
      { itemId: "old", qty: 1, min: 10, categoryId: "c_deleted" }, // 削除済みのカテゴリー → その他
    ],
    alloc: { dailyMin: 30, budgets: [{ categoryId: "c_coco", min: 75 }, { categoryId: "c_th", min: 45 }, { categoryId: "c_study", min: 30 }], dailyShort: false },
    log: { daily: { qty: 3, min: 40 }, coco: { qty: 5, min: 60 }, extra: { qty: 1, min: 15 } },
  };
  const b = P.dayBreakdown(day, items, CATS);
  assert.deepEqual(b.segments.map((s) => [s.key, s.budget, s.planMin, s.actualMin]), [
    ["daily", null, 30, 40],
    ["c_coco", 75, 70, 60],
    ["c_th", 45, 0, 0],
    ["c_study", 30, 0, 0],
    ["other", null, 10, 15],
  ]);
  assert.deepEqual([b.total, b.free, b.hasActual, b.dailyShort], [180, 70, true, false]);
  // 毎日することは項目ごとにも出す
  assert.equal(b.segments[0].name, "毎日すること（カテゴリーなし）");
  assert.deepEqual(b.segments[0].items, [{ itemId: "daily", name: "投稿", unit: "", qty: 3, planMin: 30, actualMin: 40 }]);
  assert.deepEqual(b.segments[1].items, []);
});

test("F-13 カテゴリーの確認と、名前からカテゴリーを当てる（長い名前を優先）", () => {
  assert.equal(P.validateCategory("ココナラ", 50, CATS), "「ココナラ」はもうあります。別の名前にしてください。");
  assert.equal(P.validateCategory("ココナラ", 50, CATS, "c_coco"), null);
  assert.match(P.validateCategory("", 50, CATS), /名前/);
  assert.match(P.validateCategory("その他", 50, []), /その他/);
  assert.match(P.validateCategory("A", 120, []), /割合/);
  assert.match(P.validateCategory("A", "", []), /割合/);
  assert.equal(P.guessCategory("ココナラ競合調査", CATS), "c_coco");
  assert.equal(P.guessCategory("threads投稿分析", CATS), "c_th");
  assert.equal(P.guessCategory("掃除", CATS), null);
  const cats = [{ id: "s", name: "Threads", ratio: 10 }, { id: "l", name: "Threads（AI", ratio: 10 }];
  assert.equal(P.guessCategory("Threads（AI・業務自動化）", cats), "l");
});

test("4.6 まとめて登録: 前の週の同じ名前の項目からカテゴリーと毎日やるを引き継ぐ。なければ名前から当てる", () => {
  const weeks = {
    a: { id: "a", start: "2026-10-26", end: "2026-11-01", items: [
      { id: "1", name: "Threads（AI・業務自動化）", minutes: 10, priority: 1, categoryId: "c_th", daily: true, dailyQty: 3, dailyMin: 30 },
      { id: "2", name: "ココナラ出品", minutes: 60, priority: 2, categoryId: "c_deleted" },
    ] },
  };
  assert.deepEqual(P.itemDefaults(weeks, "Threads（AI・業務自動化）", "2026-11-02", [], CATS),
    { minutes: 10, priority: 1, categoryId: "c_th", daily: true, dailyQty: 3, dailyMin: 30, weekdays: [], minDailyMin: null });
  assert.equal(P.itemDefaults(weeks, "ココナラ出品", "2026-11-02", [], CATS).categoryId, null); // 削除済みはその他
  assert.equal(P.itemDefaults(weeks, "ココナラ競合調査", "2026-11-02", [], CATS).categoryId, "c_coco");
  assert.equal(P.goalCategoryDefault("ココナラ受注", [], CATS), "c_coco");
  assert.equal(P.goalCategoryDefault("ココナラ受注", [{ name: "ココナラ受注", categoryId: null }], CATS), null);

  const rows = P.normalizeImportRows([{ include: true, name: "投稿", target: 21, minutes: 10, priority: 1, categoryId: "c_th", daily: true, dailyQty: "3", dailyMin: "30" }], "week", CATS);
  assert.deepEqual(rows.rows[0], { name: "投稿", unit: "", target: 21, minutes: 10, priority: 1, categoryId: "c_th", daily: true, dailyQty: 3, dailyMin: 30, weekdays: [], minDailyMin: null });
  assert.match(P.normalizeImportRows([{ include: true, name: "投稿", target: 21, minutes: 10, priority: 1, daily: true, dailyQty: "0" }], "week", CATS).error, /1日にやる量/);
});

test("F-04 予定外にやったこと: 実際の時間と内訳に入り、週の進み具合には入らない", () => {
  const day = {
    hours: 3,
    plan: [{ itemId: "coco", qty: 1, min: 60, categoryId: "c_coco" }],
    log: { coco: { qty: 1, min: 50, done: true } },
    extras: [
      { id: "x1", name: "セミナー", min: 120, categoryId: "c_study" },
      { id: "x2", name: "打ち合わせ", min: 30, categoryId: null },
    ],
  };
  const sum = P.daySummary(day);
  assert.deepEqual([sum.planMin, sum.actualMin, sum.extraMin], [60, 200, 150]);
  const b = P.dayBreakdown(day, [{ id: "coco", name: "出品", categoryId: "c_coco" }], CATS);
  const actual = Object.fromEntries(b.segments.map((s) => [s.key, s.actualMin]));
  assert.deepEqual(actual, { c_coco: 50, c_th: 0, c_study: 120, other: 30 });
  // 週の進み具合（項目の実績）には入らない
  const w = catWeek([{ id: "coco", name: "出品", unit: "件", target: 7, minutes: 60, priority: 1 }]);
  w.days = { "2026-11-02": day };
  assert.equal(P.weekProgress(w, "2026-11-03").items[0].actual, 1);
});

test("F-04 予定外にやったことの確認", () => {
  assert.equal(P.validateExtra("セミナー", 120), null);
  assert.match(P.validateExtra(" ", 120), /名前/);
  assert.match(P.validateExtra("セミナー", ""), /時間/);
  assert.match(P.validateExtra("セミナー", 0), /時間/);
  assert.match(P.validateExtra("セミナー", 24 * 60 + 1), /24時間/);
});

test("4.2 カテゴリーの毎日することは、そのカテゴリーの持ち時間に含める（3時間・Threads 30%・毎日30分 → Threads のほかの項目は24分）", () => {
  const w = catWeek([
    { id: "daily", name: "Threads投稿", unit: "投稿", target: 21, priority: 1, daily: true, dailyQty: 3, dailyMin: 30, categoryId: "c_th" },
    { id: "th", name: "Threads分析", unit: "回", target: 70, minutes: 8, priority: 2, categoryId: "c_th" }, // 必要量10 = 80分
    { id: "coco", name: "出品", unit: "件", target: 70, minutes: 10, priority: 1, categoryId: "c_coco" }, // 必要量10 = 100分
    { id: "study", name: "学習", unit: "講義", target: 70, minutes: 6, priority: 1, categoryId: "c_study" }, // 必要量10 = 60分
  ]);
  const r = P.planDay(w, "2026-11-02", 3, CATS);
  // 180分を 90・54・36分に分け、Threads の54分に毎日の30分を含める
  assert.deepEqual(r.alloc.budgets.map((b) => b.min), [90, 54, 36]);
  const plan = Object.fromEntries(r.plan.map((x) => [x.itemId, [x.qty, x.min]]));
  // ココナラ 90分 → 9件。Threads 54 − 30 = 24分 → 3回(24分)。学習 36分 → 6講義。余りなし
  assert.deepEqual(plan, { daily: [3, 30], th: [3, 24], coco: [9, 90], study: [6, 36] });

  const b = P.dayBreakdown({ hours: 3, plan: r.plan, alloc: r.alloc, log: { daily: { qty: 3, min: 35 } } }, w.items, CATS);
  const th = b.segments.find((s) => s.key === "c_th");
  assert.deepEqual([th.budget, th.planMin, th.actualMin], [54, 54, 35]);
  assert.deepEqual(th.items.map((x) => [x.itemId, x.planMin, x.actualMin]), [["daily", 30, 35]]);
  assert.equal(b.segments.some((s) => s.key === "daily"), false); // カテゴリーなしの毎日することはない
});

test("4.2 毎日することだけでカテゴリーの割合を超えたら、超えた分はほかのカテゴリーから割合で減らす", () => {
  const w = catWeek([
    { id: "daily", name: "学習（毎日）", unit: "講義", target: 7, priority: 1, daily: true, dailyQty: 1, dailyMin: 60, categoryId: "c_study" },
  ]);
  const r = P.planDay(w, "2026-11-02", 3, CATS);
  // 学習は 20% = 36分だが毎日60分なので60分。残り120分を 50:30 で 75・45分
  assert.deepEqual(r.alloc.budgets.map((b) => b.min), [75, 45, 60]);
});

test("4.2 カテゴリーなしの毎日することは先に引き、残りを割合で分ける。カテゴリーありと混ざっていてもよい", () => {
  const w = catWeek([
    { id: "d1", name: "日記", unit: "回", target: 7, priority: 1, daily: true, dailyQty: 1, dailyMin: 20 }, // カテゴリーなし
    { id: "d2", name: "投稿", unit: "投稿", target: 21, priority: 1, daily: true, dailyQty: 3, dailyMin: 30, categoryId: "c_th" },
  ]);
  const r = P.planDay(w, "2026-11-02", 3, CATS);
  // 180 − 20 = 160分を 80・48・32分。Threads の48分に毎日の30分を含める
  assert.deepEqual(r.alloc.budgets.map((b) => b.min), [80, 48, 32]);
  assert.equal(r.alloc.dailyMin, 50);
});

// ---------- F-14 曜日指定 ----------
// 週 11/2(月)〜11/8(日)。日曜 = 0、水曜 = 3
function weekdayWeek(weekdays, { offDays = [], days = {} } = {}) {
  return {
    id: "w_wd", start: "2026-11-02", end: "2026-11-08", offDays, days,
    items: [
      { id: "make", name: "Threads投稿作成", unit: "投稿", target: 21, minutes: 5, priority: 1, weekdays },
      { id: "sell", name: "出品", unit: "件", target: 7, minutes: 30, priority: 2 },
    ],
  };
}
const planOf = (r) => Object.fromEntries(r.plan.map((x) => [x.itemId, x.qty]));

test("4.1 曜日指定: 指定した曜日だけ予定に入れ、1曜日ならその日に残りをまとめて入れる", () => {
  const w = weekdayWeek([0]);
  assert.deepEqual(planOf(P.planDay(w, "2026-11-02", 5)), { sell: 1 }); // 月曜は入れない（入らなかったにも出さない）
  assert.deepEqual(P.planDay(w, "2026-11-02", 5).skipped, []);
  assert.deepEqual(planOf(P.planDay(w, "2026-11-08", 6)), { make: 21, sell: 7 }); // 日曜に21投稿
});

test("4.1 曜日指定: 2つ以上なら残りを残りの指定曜日で分ける", () => {
  const w = weekdayWeek([3, 0], { days: { "2026-11-04": { log: { make: { qty: 10 } } } } });
  assert.equal(planOf(P.planDay(w, "2026-11-04", 5)).make, 11); // 水曜: ceil(21 ÷ 2)
  assert.equal(planOf(P.planDay(w, "2026-11-08", 5)).make, 11); // 日曜: 残り 21 − 10
});

test("4.1 曜日指定: 指定した曜日を過ぎて残っていたら、次の稼働日にまとめて入れる。指定曜日が休みの日の週も同じ", () => {
  const w = weekdayWeek([3], { days: { "2026-11-04": { log: { make: { qty: 5 } } } } });
  assert.equal(planOf(P.planDay(w, "2026-11-05", 5)).make, 16);
  const off = weekdayWeek([3], { offDays: ["2026-11-04"] });
  assert.deepEqual(P.weekdayDays(off, off.items[0]), []);
  assert.equal(planOf(P.planDay(off, "2026-11-02", 5)).make, 21);
  // 指定曜日の日でも休みの日なら、その曜日の分としては入れない（ほかに指定曜日がないので、まとめて入れる）
  assert.equal(planOf(P.planDay(off, "2026-11-04", 5)).make, 21);
});

test("4.1 曜日指定: 毎日やる項目では使わない", () => {
  const it = { daily: true, dailyQty: 3, dailyMin: 30, weekdays: [0] };
  assert.deepEqual(P.weekdaysOf(it), []);
  assert.deepEqual(P.weekdaysOf({ weekdays: [0, "3", 9, 3] }), [0, 3]);
});

test("4.3 曜日指定の判定: 指定した曜日を締めるまでは「これから」、締めたら実績で判定する", () => {
  const w = weekdayWeek([0]);
  const row = (wk, today) => P.weekProgress(wk, today).items.find((x) => x.itemId === "make");
  const before = row(w, "2026-11-06");
  assert.equal(before.status.label, "これから"); // 金曜。出品は遅れでも、投稿作成は遅れにしない
  assert.deepEqual([before.weekdayRest, before.perDay, before.expectedPct], [1, 21, 0]);
  w.days = { "2026-11-08": { closed: true, log: { make: { qty: 21 } } } };
  assert.equal(row(w, "2026-11-08").status.label, "達成");
  w.days = { "2026-11-08": { closed: true, log: { make: { qty: 10 } } } };
  const late = row(w, "2026-11-08");
  assert.equal(late.status.label, "遅れ"); // 10 ÷ 21 = 48%
  assert.deepEqual([late.weekdayRest, late.expectedPct], [0, 100]);
  // 曜日指定のない項目は weekdayRest が null
  assert.equal(P.weekProgress(w, "2026-11-06").items.find((x) => x.itemId === "sell").weekdayRest, null);
});

test("4.3 曜日指定の項目があるときの全体の判定は、項目ごとの終わっているはずの時間を合わせる", () => {
  // 金曜まで締め済み（経過4日 / 稼働7日）。出品は4件で予定通り、投稿作成はまだ（日曜）
  const days = {};
  for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) days[d] = { closed: true, log: { sell: { qty: 1 } } };
  const pr = P.weekProgress(weekdayWeek([0], { days }), "2026-11-06");
  assert.equal(pr.items.find((x) => x.itemId === "sell").status.label, "予定通り");
  assert.equal(pr.overall.label, "予定通り"); // 投稿作成が全体を遅れにしない
});

test("4.6 まとめて登録: 前の週の同じ名前の項目から曜日を引き継ぐ", () => {
  const weeks = { a: { id: "a", start: "2026-10-26", end: "2026-11-01", items: [{ id: "1", name: "Threads投稿作成", minutes: 5, priority: 1, weekdays: [0, 3] }] } };
  assert.deepEqual(P.itemDefaults(weeks, "Threads投稿作成", "2026-11-02", [], []).weekdays, [0, 3]);
  const rows = P.normalizeImportRows([{ include: true, name: "作成", target: 21, minutes: 5, priority: 1, weekdays: [3, 0] }], "week", []);
  assert.deepEqual(rows.rows[0].weekdays, [0, 3]);
  const daily = P.normalizeImportRows([{ include: true, name: "作成", target: 21, minutes: 5, priority: 1, daily: true, dailyQty: 3, dailyMin: 15, weekdays: [0] }], "week", []);
  assert.deepEqual(daily.rows[0].weekdays, []); // 毎日やる項目では使わない
});

// ---------- F-15 1日の最低時間 ----------
// 週 11/2(月)〜11/8(日)。ツール開発は 1件 = 180分、1日の最低時間 30分
function minDailyWeek({ days = {}, offDays = [], tool = {} } = {}) {
  return {
    id: "w_md", start: "2026-11-02", end: "2026-11-08", offDays, days,
    items: [
      { id: "sell", name: "出品", unit: "件", target: 7, minutes: 30, priority: 1, categoryId: "c_sell" },
      { id: "tool", name: "ツール開発", unit: "件", target: 1, minutes: 180, priority: 3, minDailyMin: 30, categoryId: "c_dev", ...tool },
    ],
  };
}
const rowOf = (rows, id) => rows.find((x) => x.itemId === id);

test("4.1 1日の最低時間: 優先度が低くても最低時間は先に取り、1件の途中まで（量は小数）を予定に入れる", () => {
  const r = P.planDay(minDailyWeek(), "2026-11-02", 1);
  assert.deepEqual(rowOf(r.plan, "sell"), { itemId: "sell", qty: 1, min: 30 });
  assert.deepEqual(rowOf(r.plan, "tool"), { itemId: "tool", qty: 0.167, min: 30 });
  assert.deepEqual(rowOf(r.skipped, "tool"), { itemId: "tool", qty: 0.833, min: 150 });
});

test("4.1 1日の最低時間: 時間が余れば、最低時間より多く（最大で残り全部）入れる", () => {
  const r = P.planDay(minDailyWeek(), "2026-11-02", 4);
  assert.deepEqual(rowOf(r.plan, "tool"), { itemId: "tool", qty: 1, min: 180 });
  assert.deepEqual(r.skipped, []);
  const r2 = P.planDay(minDailyWeek(), "2026-11-02", 2); // 120分: 最低30 + 出品30 + 余り60
  assert.deepEqual(rowOf(r2.plan, "tool"), { itemId: "tool", qty: 0.5, min: 90 });
});

test("4.1 1日の最低時間: 途中までの実績を積み上げ、残りが最低時間より少なければ残りの分だけ入れる", () => {
  const days = {};
  for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) days[d] = { closed: true, log: { tool: { qty: 0.17, min: 30 } } };
  const w = minDailyWeek({ days });
  const r = P.planDay(w, "2026-11-07", 1);
  assert.deepEqual(rowOf(r.plan, "tool"), { itemId: "tool", qty: 0.15, min: 27 });
  days["2026-11-07"] = { closed: true, log: { tool: { qty: 0.17, min: 30 } } };
  assert.equal(rowOf(P.planDay(w, "2026-11-08", 1).plan, "tool"), undefined); // 1.02件で終わり
});

test("4.2 1日の最低時間: カテゴリーがあれば、最低時間はそのカテゴリーの時間に含める", () => {
  const cats = [{ id: "c_dev", name: "開発", ratio: 50 }, { id: "c_sell", name: "出品", ratio: 50 }];
  // 120分 → 開発60（最低30を含む）・出品60。出品の余り30は割合の大きい順（同じなら登録順）で開発へ
  const r = P.planDay(minDailyWeek(), "2026-11-02", 2, cats);
  assert.deepEqual(rowOf(r.plan, "tool"), { itemId: "tool", qty: 0.5, min: 90, categoryId: "c_dev" });
  assert.deepEqual(rowOf(r.plan, "sell"), { itemId: "sell", qty: 1, min: 30, categoryId: "c_sell" });
});

test("4.1 1日の最低時間: 曜日指定があれば指定した曜日だけ。休みの日・毎日やる項目には使わない", () => {
  const w = minDailyWeek({ tool: { weekdays: [6] } });
  assert.equal(rowOf(P.planDay(w, "2026-11-02", 1).plan, "tool"), undefined);
  assert.deepEqual(rowOf(P.planDay(w, "2026-11-07", 1).plan, "tool"), { itemId: "tool", qty: 0.167, min: 30 });
  // 休みの日は先に取らない（優先度順のまま）
  const off = minDailyWeek({ offDays: ["2026-11-02"], tool: { target: 1 } });
  off.items[0].target = 14; // 出品 2件/日 = 60分
  assert.equal(rowOf(P.planDay(off, "2026-11-02", 1).plan, "tool"), undefined);
  assert.equal(P.minDailyOf({ daily: true, dailyQty: 1, dailyMin: 30, minutes: 30, minDailyMin: 30 }), 0);
  assert.equal(P.minDailyOf({ minutes: 0, minDailyMin: 30 }), 0);
  assert.equal(P.minDailyOf({ minutes: 180 }), 0);
});

test("4.6 まとめて登録: 1日の最低時間を引き継ぐ", () => {
  const weeks = { a: { id: "a", start: "2026-10-26", end: "2026-11-01", items: [{ id: "1", name: "ツール開発", minutes: 180, priority: 3, minDailyMin: 30 }] } };
  assert.equal(P.itemDefaults(weeks, "ツール開発", "2026-11-02", [], []).minDailyMin, 30);
  const rows = P.normalizeImportRows([{ include: true, name: "ツール開発", target: 1, minutes: 180, priority: 3, minDailyMin: 30 }], "week", []);
  assert.equal(rows.rows[0].minDailyMin, 30);
});

test("4.3 1日の最低時間: 週の進捗は時間でも出し、1日あたりは最低時間を下回らない", () => {
  const days = { "2026-11-02": { closed: true, log: { tool: { qty: 0.167, min: 30 } } } };
  const x = P.weekProgress(minDailyWeek({ days }), "2026-11-03").items.find((i) => i.itemId === "tool");
  assert.equal(x.remaining, 0.833);
  assert.deepEqual(x.time, { targetMin: 180, doneMin: 30, remainingMin: 150, perDayMin: 30 }); // 150 ÷ 6日 = 25 → 最低30
  const late = P.weekProgress(minDailyWeek({ days }), "2026-11-07").items.find((i) => i.itemId === "tool");
  assert.equal(late.time.perDayMin, 75); // 残り2日: ceil(150 ÷ 2)
  assert.equal(P.weekProgress(minDailyWeek(), "2026-11-03").items.find((i) => i.itemId === "sell").time, null);
});

// ---------- F-16 犬のキャラクターの顔 ----------
test("F-16 顔: 全体の判定と進み具合（120%以上で予定より進んでいる）で選ぶ", () => {
  const mood = (k, pace = null) => P.mascotMood({ overall: { k }, pace });
  assert.equal(mood("done"), "sparkle");
  assert.equal(mood("ok", 1.2), "sparkle");
  assert.equal(mood("ok", 1.19), "relax");
  assert.equal(mood("warn", 0.9), "worry");
  assert.equal(mood("bad", 0.5), "mie");
  assert.equal(mood("wait"), "normal");
  assert.equal(mood("none"), "normal");
  assert.equal(P.mascotMood(null), "normal");
});

test("F-16 週の進捗の進み具合（pace）は、実績の時間 ÷ 終わっているはずの時間", () => {
  // 週 11/2〜11/8（稼働日7日）。2日締めて、出品だけ4件（終わっているはずの量の2倍）
  const w = minDailyWeek({ days: { "2026-11-02": { closed: true, log: { sell: { qty: 2 } } }, "2026-11-03": { closed: true, log: { sell: { qty: 2 } } } } });
  const pr = P.weekProgress(w, "2026-11-04");
  // 目標の時間 = 7×30 + 1×180 = 390分。終わっているはずの時間 = 390 × 2/7。実績 = 4×30 = 120分
  assert.ok(Math.abs(pr.pace - 120 / (390 * 2 / 7)) < 1e-9);
  assert.equal(P.weekProgress(minDailyWeek(), "2026-11-02").pace, null); // まだ1日も経っていない
});

// ---------- F-17 今日の売上 ----------
test("F-17 売上の目標: 単位が円の手で入れる目標のうち、名前に売上を含むもの → 円のもの", () => {
  const g = (id, name, unit, source = "manual") => ({ id, name, unit, source, entries: [] });
  assert.equal(P.salesGoalOf([g("a", "受注", "件"), g("b", "ココナラ収益", "円"), g("c", "売上", "円")]).id, "c");
  assert.equal(P.salesGoalOf([g("a", "受注", "件"), g("b", "ココナラ収益", "円")]).id, "b");
  assert.equal(P.salesGoalOf([g("a", "売上", "円", "weekly")]), null); // 週から集める目標は使わない
  assert.equal(P.salesGoalOf([]), null);
  assert.deepEqual(P.newSalesGoal("x"), { id: "x", name: "売上", unit: "円", target: 0, minimum: null, stretch: null, source: "manual", categoryId: null, entries: [] });
});

test("F-17 売上の合計: 月をまたぐ週でも、各月の売上の目標から日の範囲で集める", () => {
  const sales = (entries) => ({ goals: [{ id: "s", name: "売上", unit: "円", source: "manual", entries }] });
  const months = {
    "2026-10": sales([{ id: "1", date: "2026-10-30", qty: 3000, memo: "" }, { id: "2", date: "2026-10-01", qty: 9000, memo: "" }]),
    "2026-11": sales([{ id: "3", date: "2026-11-01", qty: 5000, memo: "ココナラ1件" }, { id: "4", date: "2026-11-02", qty: 1000, memo: "" }]),
  };
  assert.equal(P.salesTotal(months, "2026-10-26", "2026-11-01"), 8000);
  assert.deepEqual(P.salesEntries(months, "2026-11-01", "2026-11-01").map((e) => e.id), ["3"]);
  // 月の進捗（月タブ）にもそのまま入る
  assert.equal(P.goalActual(months["2026-11"].goals[0], {}, "2026-11"), 6000);
});

test("F-17 売上の金額の確認", () => {
  assert.equal(P.validateSale("5000"), null);
  assert.ok(P.validateSale(""));
  assert.ok(P.validateSale(0));
  assert.ok(P.validateSale(-1));
  assert.ok(P.validateSale(200000000));
});

test("F-16 日替わりの画像: 同じ日は同じ画像、次の日は次の画像。最後まで行ったら最初に戻る", () => {
  const list = ["a.jpg", "b.jpg", "c.jpg"];
  const first = P.pickDaily(list, "2026-11-04");
  const i = list.indexOf(first);
  assert.equal(P.pickDaily(list, "2026-11-04"), first);
  assert.equal(P.pickDaily(list, "2026-11-05"), list[(i + 1) % 3]);
  assert.equal(P.pickDaily(list, "2026-11-07"), first); // 3日後は同じ
  assert.equal(P.pickDaily(list, "2026-12-31") !== null, true);
  assert.equal(P.pickDaily(["only.jpg", "", 3], "2026-11-04"), "only.jpg"); // 空や文字でないものは使わない
  assert.equal(P.pickDaily([], "2026-11-04"), null);
  assert.equal(P.pickDaily(undefined, "2026-11-04"), null);
});
