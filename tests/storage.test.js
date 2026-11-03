const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/storage.js");

// localStorage の代わり。failSet / failGet で例外を起こせる
function fakeStorage(init = {}, { failSet = false, failGet = false } = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem(k) {
      if (failGet) throw new Error("denied");
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (failSet) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
  };
}

const sampleMonth = {
  month: "2026-10",
  goals: [
    { id: "g_1", name: "Threads", unit: "投稿", target: 93, stretch: null, source: "weekly", entries: [] },
    { id: "g_2", name: "売上", unit: "円", target: 50000, stretch: 100000, source: "manual", entries: [{ id: "e_1", date: "2026-10-31", qty: 12000, memo: "1件" }] },
  ],
  review: { good: "", issues: "", act: "" },
};

const sampleWeek = {
  id: "w_a",
  start: "2026-10-26",
  end: "2026-11-01",
  offDays: ["2026-11-01"],
  items: [{ id: "i_x1", name: "出品", unit: "件", target: 3, minutes: 60, priority: 1 }],
  days: {},
};

test("保存データがなければ空のデータ", () => {
  const r = S.load(fakeStorage());
  assert.equal(r.error, null);
  assert.deepEqual(r.data, { schemaVersion: 4, settings: {}, categories: [], weeks: {}, months: {} });
});

test("保存して読み直すと同じデータ", () => {
  const st = fakeStorage();
  const month = { ...sampleMonth, goals: sampleMonth.goals.map((g, i) => ({ ...g, minimum: i ? 10000 : null, categoryId: i ? "c_1" : null })) };
  const week = { ...sampleWeek, items: sampleWeek.items.map((it) => ({ ...it, categoryId: "c_1", daily: true, dailyQty: 3, dailyMin: 30 })) };
  const data = {
    schemaVersion: 4,
    settings: { currentWeek: "w_a", lastHours: 3 },
    categories: [{ id: "c_1", name: "ココナラ", ratio: 50 }],
    weeks: { w_a: week },
    months: { "2026-10": month },
  };
  assert.equal(S.save(data, st), true);
  assert.deepEqual(S.load(st), { data, error: null, readOnly: false });
});

test("試作版のデータ（schemaVersion なし）は v4 まで移行され、中身は残る", () => {
  const st = fakeStorage({ [S.KEY]: JSON.stringify({ weeks: { w_a: sampleWeek }, settings: { lastHours: 2 } }) });
  const r = S.load(st);
  assert.equal(r.error, null);
  assert.equal(r.data.schemaVersion, 4);
  assert.deepEqual(r.data.months, {});
  assert.deepEqual(r.data.categories, []);
  assert.deepEqual(r.data.weeks.w_a, { ...sampleWeek, items: sampleWeek.items.map((it) => ({ categoryId: null, daily: false, dailyQty: null, dailyMin: null, ...it })) });
  assert.equal(r.data.settings.lastHours, 2);
});

test("壊れたデータは別のキーに退避し、空のデータで続ける", () => {
  const st = fakeStorage({ [S.KEY]: "{broken" });
  const r = S.load(st);
  assert.match(r.error, /読めませんでした/);
  assert.deepEqual(r.data.weeks, {});
  const backups = [...st.map.keys()].filter((k) => k.startsWith(`${S.KEY}.backup.`));
  assert.equal(backups.length, 1);
  assert.equal(st.map.get(backups[0]), "{broken");
  assert.ok(r.error.includes(backups[0]), "退避先のキーを理由に含める");
  assert.equal(r.readOnly, false);
});

test("退避もできないときは保存を止める（readOnly）", () => {
  const st = fakeStorage({ [S.KEY]: "{broken" }, { failSet: true });
  const r = S.load(st);
  assert.equal(r.readOnly, true);
  assert.match(r.error, /保存を止めています/);
});

test("新しい版のデータは読み込まずに退避する", () => {
  const st = fakeStorage({ [S.KEY]: JSON.stringify({ schemaVersion: 99, weeks: {}, settings: {} }) });
  const r = S.load(st);
  assert.match(r.error, /新しい版/);
  assert.equal([...st.map.keys()].some((k) => k.startsWith(`${S.KEY}.backup.`)), true);
});

test("localStorage が例外を出しても止まらない", () => {
  assert.equal(S.save(S.emptyData(), fakeStorage({}, { failSet: true })), false);
  const r = S.load(fakeStorage({}, { failGet: true }));
  assert.ok(r.error);
  assert.deepEqual(r.data, S.emptyData());
  assert.equal(S.save(S.emptyData(), null), false);
});

test("読み込むファイルの確認: 形が違うものは理由を返す", () => {
  assert.equal(S.parseData("not json").ok, false);
  assert.equal(S.parseData("[]").ok, false);
  assert.equal(S.parseData(JSON.stringify({ weeks: [] })).ok, false);
  assert.equal(S.parseData(JSON.stringify({ weeks: { w: { start: "10/26", end: "2026-11-01" } } })).ok, false);
  const ok = S.parseData(S.toJson({ schemaVersion: 2, settings: {}, weeks: { w_a: sampleWeek }, months: { "2026-10": sampleMonth } }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.weeks.w_a, sampleWeek);
});

test("readImportFile は File の中身を確認して返す（保存はしない）", async () => {
  const file = { text: async () => JSON.stringify({ schemaVersion: 1, settings: {}, weeks: {} }) };
  assert.deepEqual(await S.readImportFile(file), { ok: true, data: S.emptyData() });
  const bad = { text: async () => { throw new Error("x"); } };
  assert.equal((await S.readImportFile(bad)).ok, false);
});

test("書き出しのファイル名", () => {
  assert.equal(S.exportFileName("2026-10-28"), "pdca-planner-2026-10-28.json");
});

test("v1 のデータは v4 に移行され、週と設定はそのまま残る", () => {
  const v1 = { schemaVersion: 1, settings: { currentWeek: "w_a", lastHours: 3 }, weeks: { w_a: { ...sampleWeek, items: [] } } };
  const st = fakeStorage({ [S.KEY]: JSON.stringify(v1) });
  const r = S.load(st);
  assert.equal(r.error, null);
  assert.deepEqual(r.data, { ...v1, schemaVersion: 4, months: {}, categories: [] });
  // 保存し直すと v4 になる
  S.save(r.data, st);
  assert.equal(JSON.parse(st.map.get(S.KEY)).schemaVersion, 4);
});

test("v2 のデータは v3 に移行され、月の目標に minimum: null が入る。ほかの値は消えない", () => {
  const v2 = { schemaVersion: 2, settings: { currentWeek: "w_a" }, weeks: { w_a: sampleWeek }, months: { "2026-10": sampleMonth } };
  const st = fakeStorage({ [S.KEY]: JSON.stringify(v2) });
  const r = S.load(st);
  assert.equal(r.error, null);
  assert.equal(r.data.schemaVersion, 4);
  assert.deepEqual(r.data.settings, v2.settings);
  assert.deepEqual(r.data.months["2026-10"], {
    ...sampleMonth,
    goals: sampleMonth.goals.map((g) => ({ ...g, minimum: null, categoryId: null })),
  });
  // すでに minimum がある目標はそのまま
  const keep = S.parseData(JSON.stringify({ ...v2, months: { "2026-10": { ...sampleMonth, goals: [{ ...sampleMonth.goals[0], minimum: 50 }] } } }));
  assert.equal(keep.data.months["2026-10"].goals[0].minimum, 50);
});

test("v3 のデータは v4 に移行され、カテゴリーなし・毎日やるなしになる。実績・ほかの値は消えない", () => {
  const week = { ...sampleWeek, days: { "2026-10-27": { hours: 3, plan: [{ itemId: "i_x1", qty: 1, min: 60 }], log: { i_x1: { qty: 1, min: 75, done: true } } } } };
  const v3 = {
    schemaVersion: 3,
    settings: { currentWeek: "w_a", lastHours: 3 },
    weeks: { w_a: week },
    months: { "2026-10": { ...sampleMonth, goals: sampleMonth.goals.map((g) => ({ ...g, minimum: 10 })) } },
  };
  const r = S.parseData(JSON.stringify(v3));
  assert.equal(r.ok, true);
  assert.equal(r.data.schemaVersion, 4);
  assert.deepEqual(r.data.categories, []);
  assert.deepEqual(r.data.settings, v3.settings);
  assert.deepEqual(r.data.weeks.w_a, {
    ...week,
    items: [{ ...sampleWeek.items[0], categoryId: null, daily: false, dailyQty: null, dailyMin: null }],
  });
  assert.deepEqual(r.data.months["2026-10"].goals, v3.months["2026-10"].goals.map((g) => ({ ...g, categoryId: null })));
});

test("v5 のデータは読み込まずに退避する", () => {
  const st = fakeStorage({ [S.KEY]: JSON.stringify({ schemaVersion: 5, weeks: {}, settings: {}, months: {} }) });
  const r = S.load(st);
  assert.match(r.error, /新しい版/);
  assert.equal([...st.map.keys()].some((k) => k.startsWith(`${S.KEY}.backup.`)), true);
});

test("予定外にやったこと（extras）の形が違うデータは読み込まない。なくてもよい", () => {
  const week = (days) => ({ schemaVersion: 4, settings: {}, categories: [], months: {}, weeks: { w_a: { ...sampleWeek, days } } });
  assert.equal(S.parseData(JSON.stringify(week({ "2026-10-27": { extras: "x" } }))).ok, false);
  assert.equal(S.parseData(JSON.stringify(week({ "2026-10-27": { extras: [{ id: "x1", name: "セミナー", min: 120, categoryId: null }] } }))).ok, true);
  assert.equal(S.parseData(JSON.stringify(week({ "2026-10-27": { hours: 3 } }))).ok, true);
});

test("今日のメモ（notes）は、なくてもよく、形が違えば読み込まない", () => {
  const week = (days) => ({ schemaVersion: 4, settings: {}, categories: [], months: {}, weeks: { w_a: { ...sampleWeek, days } } });
  const ok = S.parseData(JSON.stringify(week({ "2026-10-27": { notes: { done: "競合を3つ見た", review: "<b>明日</b>は投稿から" } } })));
  assert.equal(ok.ok, true);
  assert.equal(ok.data.weeks.w_a.days["2026-10-27"].notes.review, "<b>明日</b>は投稿から");
  assert.equal(S.parseData(JSON.stringify(week({ "2026-10-27": { notes: "x" } }))).ok, false);
});

test("1日の最低時間（minDailyMin）は、なくてもよく、数でなければ読み込まない", () => {
  const week = (it) => ({ schemaVersion: 4, settings: {}, categories: [], months: {}, weeks: { w_a: { ...sampleWeek, items: [{ ...sampleWeek.items[0], ...it }] } } });
  assert.equal(S.parseData(JSON.stringify(week({ minDailyMin: 30 }))).ok, true);
  assert.equal(S.parseData(JSON.stringify(week({ minDailyMin: null }))).ok, true);
  assert.equal(S.parseData(JSON.stringify(week({ minDailyMin: "30" }))).ok, false);
  assert.equal(S.parseData(JSON.stringify(week({ minDailyMin: -5 }))).ok, false);
});

test("months の形が違うデータは読み込まない", () => {
  assert.equal(S.parseData(JSON.stringify({ schemaVersion: 2, weeks: {}, months: [] })).ok, false);
  assert.equal(S.parseData(JSON.stringify({ schemaVersion: 2, weeks: {}, months: { "10月": {} } })).ok, false);
  assert.equal(S.parseData(JSON.stringify({ schemaVersion: 2, weeks: {}, months: { "2026-10": { goals: {} } } })).ok, false);
  assert.equal(S.parseData(JSON.stringify({ schemaVersion: 2, weeks: {}, months: { "2026-10": { goals: [{ entries: "x" }] } } })).ok, false);
});
