// 計算ロジック（純粋関数のみ。DOM・localStorage に触らない）
// 計算ルールは docs/requirements.md の「4. 計算ルール」（月は 4.5）が正。
(function () {
  "use strict";

  // ---------- 日付（YYYY-MM-DD 文字列・ローカル時刻） ----------
  const pad = (v) => String(v).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (s, days) => {
    const d = parseDate(s);
    d.setDate(d.getDate() + days);
    return ymd(d);
  };

  // 数値でないものは 0 として扱う
  const num = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };

  // ---------- 週 ----------
  function datesOf(week) {
    const out = [];
    for (let d = week.start; d <= week.end && out.length < 62; d = addDays(d, 1)) out.push(d);
    return out;
  }

  function workdays(week) {
    const off = week.offDays || [];
    return datesOf(week).filter((d) => !off.includes(d));
  }

  const MAX_WEEK_DAYS = 31;

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const shortDate = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

  // F-01 週の期間の確認。問題があれば画面に出す理由、なければ null
  // weeks を渡すと、ほかの週と1日でも重なっていないかも確かめる（exceptId はいま編集している週の id）
  function validateWeekRange(start, end, weeks, exceptId) {
    if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) return "開始日と終了日を入れてください。";
    if (end < start) return "終了日は開始日と同じ日か、それより後の日にしてください。";
    if (datesOf({ start, end }).length > MAX_WEEK_DAYS) return `1つの週は${MAX_WEEK_DAYS}日までにしてください。`;
    const other = Object.values(weeks || {}).find((w) => w.id !== exceptId && w.start <= end && start <= w.end);
    if (other) return `ほかの週（${shortDate(other.start)}〜${shortDate(other.end)}）と重なっています。週の期間は重ならないようにしてください。`;
    return null;
  }

  // F-03 日付の初期値。選んだ日が週の中ならその日、なければ今日、今日が週の外なら週の初日か最終日
  function defaultDate(week, today, picked) {
    const ds = datesOf(week);
    if (picked && ds.includes(picked)) return picked;
    if (ds.includes(today)) return today;
    return today > week.end ? week.end : week.start;
  }

  // その日の予定・実績の合計
  function daySummary(day) {
    const plan = day?.plan || [];
    const log = day?.log || {};
    return {
      planMin: plan.reduce((s, x) => s + num(x.min), 0),
      actualMin: Object.values(log).reduce((s, l) => s + num(l.min), 0),
      doneCount: plan.filter((x) => log[x.itemId]?.done).length,
      planCount: plan.length,
    };
  }

  // 週の開始日〜終了日の中の日か。期間を短くしても期間外の実績はデータに残すので、合計では必ずこれで絞る
  const inWeek = (week, d) => d >= week.start && d <= week.end;

  // 週の中の日の [日付, その日] の一覧
  const daysInWeek = (week) => Object.entries(week.days || {}).filter(([d]) => inWeek(week, d));

  // 項目の実績の合計。週の中の日のうち、pred(date) が true の日だけ数える
  function sumLog(week, itemId, pred) {
    let s = 0;
    for (const [d, day] of daysInWeek(week)) {
      if (pred(d)) s += num(day.log?.[itemId]?.qty);
    }
    return s;
  }

  // 優先度の小さい順。同じ優先度なら登録順（sort は安定）
  function sortByPriority(items) {
    return [...items].sort((a, b) => num(a.priority) - num(b.priority));
  }

  // ---------- 4.1 / 4.2 今日の予定 ----------
  // 必要量 = ceil(残り量 ÷ 残り日数)。優先度順に使える時間へ詰め、入らない分は skipped へ。
  function planDay(week, date, hours) {
    const remDays = workdays(week).filter((d) => d > date).length + 1;
    let avail = Math.max(0, Math.round(num(hours) * 60));
    const plan = [];
    const skipped = [];
    for (const it of sortByPriority(week.items || [])) {
      const remaining = Math.max(0, num(it.target) - sumLog(week, it.id, (d) => d < date));
      if (remaining <= 0) continue;
      const need = Math.ceil(remaining / remDays);
      const per = Math.max(0, num(it.minutes));
      const qty = per > 0 ? Math.min(need, Math.floor(avail / per)) : need;
      if (qty > 0) {
        plan.push({ itemId: it.id, qty, min: qty * per });
        avail -= qty * per;
      }
      if (qty < need) skipped.push({ itemId: it.id, qty: need - qty, min: (need - qty) * per });
    }
    return { plan, skipped };
  }

  // ---------- 4.3 進捗の判定 ----------
  function elapsedDays(week, today) {
    const wd = workdays(week);
    if (today > week.end) return wd.length;
    const closedToday = wd.includes(today) && week.days?.[today]?.closed ? 1 : 0;
    return wd.filter((d) => d < today).length + closedToday;
  }

  // k: 画面の色分け用のキー / label: 表示する判定
  function judge(actual, target, elapsed, total) {
    if (target <= 0) return { k: "none", label: "目標なし" };
    if (actual >= target) return { k: "done", label: "達成" };
    if (elapsed === 0 || total === 0) return { k: "wait", label: "これから" };
    const r = actual / ((target * elapsed) / total);
    if (r >= 1) return { k: "ok", label: "予定通り" };
    if (r >= 0.8) return { k: "warn", label: "遅れ気味" };
    return { k: "bad", label: "遅れ" };
  }

  // 週の進捗（F-05 の表示に必要な値をまとめて出す）
  function weekProgress(week, today) {
    const wd = workdays(week);
    const elapsed = elapsedDays(week, today);
    const closedToday = week.days?.[today]?.closed;
    // 今日を含めて、まだ作業できる稼働日の数
    const remDays = wd.filter((d) => d > today || (d === today && !closedToday)).length;
    const expectedPct = wd.length ? Math.min(100, (elapsed / wd.length) * 100) : 0;
    let targetMin = 0;
    let actualMin = 0;
    let remainingMin = 0;
    const items = sortByPriority(week.items || []).map((it) => {
      const target = num(it.target);
      const actual = sumLog(week, it.id, () => true);
      const per = num(it.minutes);
      const remaining = Math.max(0, target - actual);
      targetMin += target * per;
      actualMin += Math.min(actual, target) * per;
      remainingMin += remaining * per;
      return {
        itemId: it.id,
        target,
        actual,
        remaining,
        pct: target ? Math.round((actual / target) * 100) : 0,
        perDay: remDays ? Math.ceil(remaining / remDays) : remaining,
        status: judge(actual, target, elapsed, wd.length),
      };
    });
    return {
      items,
      overall: judge(actualMin, targetMin, elapsed, wd.length),
      elapsed,
      totalDays: wd.length,
      remDays,
      expectedPct,
      remainingMin,
      needMinPerDay: remDays ? remainingMin / remDays : remainingMin,
    };
  }

  // ---------- F-06 標準時間の見直し ----------
  // 全週の同じ名前の項目について、量と時間がどちらも0より大きい実績だけで「時間の合計 ÷ 量の合計」。
  // 各週の期間の外の日は数えない。実績がなければ null。weeks は { id: week } でも配列でもよい。
  function avgMinutesPerUnit(weeks, name) {
    let qty = 0;
    let min = 0;
    for (const w of Object.values(weeks || {})) {
      const it = (w.items || []).find((i) => i.name === name);
      if (!it) continue;
      for (const [, day] of daysInWeek(w)) {
        const l = day.log?.[it.id];
        if (l && num(l.qty) > 0 && num(l.min) > 0) {
          qty += num(l.qty);
          min += num(l.min);
        }
      }
    }
    return qty ? min / qty : null;
  }

  // ---------- 4.5 月（F-08〜F-10） ----------
  // 月は YYYY-MM の文字列。月への振り分けは週ではなく実績の日付で行う。
  const monthOf = (date) => date.slice(0, 7);

  function addMonths(month, n) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  function daysInMonth(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  function monthRange(month) {
    return { start: `${month}-01`, end: `${month}-${pad(daysInMonth(month))}` };
  }

  // その日を含むどれかの週で、その日が締め済みか
  function isDayClosed(weeks, date) {
    return Object.values(weeks || {}).some((w) => inWeek(w, date) && w.days?.[date]?.closed);
  }

  // 経過日数（暦の日数）= 今日より前の月内の日数 + （今日を締めていれば1）
  function monthElapsedDays(month, today, weeks) {
    const { start, end } = monthRange(month);
    if (today > end) return daysInMonth(month);
    if (today < start) return 0;
    return Number(today.slice(8, 10)) - 1 + (isDayClosed(weeks, today) ? 1 : 0);
  }

  // 月にかかる週（開始日の順）
  function weeksInMonth(weeks, month) {
    const { start, end } = monthRange(month);
    return Object.values(weeks || {})
      .filter((w) => w.start <= end && start <= w.end)
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  }

  // 月の目標の実績。月の初日〜upTo（省略時は月末）の日付の分だけ数える
  // weekly: 同じ名前の週の項目の実績（sumLog なので各週の期間の中の日だけ）/ manual: 手で入れた実績
  function goalActual(goal, weeks, month, upTo) {
    const { start, end } = monthRange(month);
    const last = upTo && upTo < end ? upTo : end;
    const inRange = (d) => d >= start && d <= last;
    if (goal.source === "manual") {
      return (goal.entries || []).filter((e) => inRange(e.date)).reduce((s, e) => s + num(e.qty), 0);
    }
    if (!goal.name) return 0;
    let s = 0;
    for (const w of Object.values(weeks || {})) {
      for (const it of (w.items || []).filter((i) => i.name === goal.name)) s += sumLog(w, it.id, inRange);
    }
    return s;
  }

  // 週の項目から集める目標で、この月にかかる週に同じ名前の項目があるか
  function goalLinked(goal, weeks, month) {
    if (goal.source === "manual") return true;
    return !!goal.name && weeksInMonth(weeks, month).some((w) => (w.items || []).some((i) => i.name === goal.name));
  }

  // 空（null・undefined・""）なら null、それ以外は数
  const optNum = (v) => (v === null || v === undefined || v === "" ? null : num(v));
  // 挑戦目標・最低目標。空なら null
  const stretchOf = (goal) => optNum(goal.stretch);
  const minimumOf = (goal) => optNum(goal.minimum);
  const rate = (actual, target) => (target > 0 ? Math.round((actual / target) * 100) : 0);

  // 月の進捗（F-08）。monthRec: { month, goals }
  function monthProgress(monthRec, weeks, today) {
    const month = monthRec.month;
    const totalDays = daysInMonth(month);
    const elapsed = monthElapsedDays(month, today, weeks);
    const goals = (monthRec.goals || []).map((g) => {
      const target = num(g.target);
      const stretch = stretchOf(g);
      const minimum = minimumOf(g);
      const actual = goalActual(g, weeks, month);
      return {
        goalId: g.id,
        target,
        minimum,
        stretch,
        actual,
        pct: rate(actual, target),
        minimumPct: minimum === null ? null : rate(actual, minimum),
        stretchPct: stretch === null ? null : rate(actual, stretch),
        status: judge(actual, target, elapsed, totalDays),
        linked: goalLinked(g, weeks, month),
      };
    });
    return { month, goals, elapsed, totalDays, expectedPct: Math.min(100, (elapsed / totalDays) * 100) };
  }

  // 週末ごとの進み具合（F-09）。月にかかる週ごとに、週を月の中に区切った最終日の時点での月の累計
  function monthCheckpoints(monthRec, weeks, today) {
    const month = monthRec.month;
    const range = monthRange(month);
    const totalDays = daysInMonth(month);
    return weeksInMonth(weeks, month).map((w) => {
      const start = w.start > range.start ? w.start : range.start;
      const end = w.end < range.end ? w.end : range.end;
      return {
        weekId: w.id,
        start,
        end,
        inProgress: end >= today, // 今日をまだ過ぎていない
        expectedPct: Math.round((Number(end.slice(8, 10)) / totalDays) * 100),
        goals: (monthRec.goals || []).map((g) => {
          const target = num(g.target);
          const stretch = stretchOf(g);
          const actual = goalActual(g, weeks, month, end);
          return { goalId: g.id, actual, pct: rate(actual, target), stretchPct: stretch === null ? null : rate(actual, stretch) };
        }),
      };
    });
  }

  // 手入力の実績の確認。問題があれば理由、なければ null
  function validateMonthEntry(date, qty, month) {
    if (!DATE_RE.test(date || "")) return "日付を入れてください。";
    if (monthOf(date) !== month) return `日付は${Number(month.slice(5, 7))}月の中の日にしてください。`;
    const q = Number(qty);
    if (qty === "" || qty === null || qty === undefined || !Number.isFinite(q) || q < 0) return "量を0以上の数で入れてください。";
    return null;
  }

  // 前の月の目標を引き継ぐ。名前・単位・目標量・最低目標・挑戦目標・集め方だけを写し、手入力の実績は写さない
  function copyMonthGoals(goals, makeId) {
    return (goals || []).map((g) => ({
      id: makeId(),
      name: g.name,
      unit: g.unit,
      target: g.target,
      minimum: minimumOf(g),
      stretch: stretchOf(g),
      source: g.source === "manual" ? "manual" : "weekly",
      entries: [],
    }));
  }

  // ---------- 4.6 文章からまとめて登録（F-11） ----------
  const DEFAULT_ITEM = { minutes: 30, priority: 3 };

  // 週の項目の「1回の時間・優先度」の初期値。
  // 登録先の週（currentItems）に同じ名前があればその値、なければ start より前の週でいちばん新しい同じ名前の項目、なければ 30分・優先度3
  function itemDefaults(weeks, name, start, currentItems) {
    const pickOf = (it) => ({ minutes: num(it.minutes), priority: num(it.priority) || DEFAULT_ITEM.priority });
    const cur = (currentItems || []).find((i) => i.name === name);
    if (cur) return pickOf(cur);
    const prev = Object.values(weeks || {})
      .filter((w) => w.start < start)
      .sort((a, b) => (a.start < b.start ? 1 : -1))
      .map((w) => (w.items || []).find((i) => i.name === name))
      .find(Boolean);
    return prev ? pickOf(prev) : { ...DEFAULT_ITEM };
  }

  // 月の目標の「集め方」の初期値。今の目標に同じ名前があればその値、
  // なければ、その月にかかる週に同じ名前の項目があれば weekly、なければ manual
  function goalSourceDefault(weeks, month, name, currentGoals) {
    const cur = (currentGoals || []).find((g) => g.name === name);
    if (cur) return cur.source === "manual" ? "manual" : "weekly";
    return goalLinked({ name, source: "weekly" }, weeks, month) ? "weekly" : "manual";
  }

  // 開始日・終了日がまったく同じ週。なければ null
  function findWeekByRange(weeks, start, end) {
    return Object.values(weeks || {}).find((w) => w.start === start && w.end === end) || null;
  }

  // 確認画面の行を確かめて、保存する形にする。kind: "month" | "week"
  // 戻り値: { ok: true, rows } / { ok: false, error }。rows は登録する行だけ
  function normalizeImportRows(rows, kind) {
    const isNum = (v) => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0;
    const out = [];
    const names = new Set();
    for (const [i, r] of (rows || []).entries()) {
      if (!r.include) continue;
      const at = `${i + 1}行目`;
      const name = String(r.name ?? "").trim();
      if (!name) return { ok: false, error: `${at}: 名前を入れてください。` };
      if (names.has(name)) return { ok: false, error: `${at}: 「${name}」が2回あります。名前を変えるか、片方のチェックを外してください。` };
      names.add(name);
      if (!isNum(r.target)) return { ok: false, error: `${at}（${name}）: 目標量を0以上の数で入れてください。` };
      const row = { name, unit: String(r.unit ?? "").trim(), target: Number(r.target) };
      if (kind === "month") {
        for (const [f, label] of [["minimum", "最低目標"], ["stretch", "挑戦目標"]]) {
          if (r[f] !== "" && r[f] !== null && r[f] !== undefined && !isNum(r[f])) return { ok: false, error: `${at}（${name}）: ${label}は空にするか、0以上の数で入れてください。` };
          row[f] = optNum(r[f]);
        }
        row.source = r.source === "manual" ? "manual" : "weekly";
      } else {
        if (!isNum(r.minutes)) return { ok: false, error: `${at}（${name}）: 1回の時間を0以上の数で入れてください。` };
        const p = Number(r.priority);
        if (!Number.isInteger(p) || p < 1 || p > 5) return { ok: false, error: `${at}（${name}）: 優先度は1〜5で選んでください。` };
        row.minutes = Number(r.minutes);
        row.priority = p;
      }
      out.push(row);
    }
    if (!out.length) return { ok: false, error: "登録する行がありません。登録したい行にチェックを入れてください。" };
    return { ok: true, rows: out };
  }

  // 名前で突き合わせて反映する。mode: "merge"（同じ名前は上書き、ない名前は追加）/ "replace"（すべて置き換え）
  // どちらでも同じ名前のものは id を引き継ぐので、実績は残る。hasRecord(x) は消えると実績も見えなくなるか
  function mergeByName(list, rows, mode, makeId, build, hasRecord) {
    const byName = new Map((list || []).map((x) => [x.name, x]));
    const names = new Set(rows.map((r) => r.name));
    let added = 0;
    let updated = 0;
    const merged = rows.map((r) => {
      const cur = byName.get(r.name);
      if (cur) updated++;
      else added++;
      return cur ? { ...cur, ...r } : build(r, makeId());
    });
    if (mode === "replace") {
      const removed = (list || []).filter((x) => !names.has(x.name)).map((x) => ({ name: x.name, hasRecord: hasRecord(x) }));
      return { list: merged, added, updated, removed };
    }
    // merge: 今の並びを保ち、上書きした行はその場所で置き換え、新しい行は後ろに足す
    const mergedByName = new Map(merged.map((x) => [x.name, x]));
    const kept = (list || []).map((x) => mergedByName.get(x.name) || x);
    const fresh = merged.filter((x) => !byName.has(x.name));
    return { list: [...kept, ...fresh], added, updated, removed: [] };
  }

  // 月の目標へ反映。rows は normalizeImportRows の結果
  function mergeMonthGoals(goals, rows, mode, makeId) {
    const r = mergeByName(goals, rows, mode, makeId,
      (row, id) => ({ id, ...row, entries: [] }),
      (g) => (g.entries || []).length > 0);
    return { goals: r.list, added: r.added, updated: r.updated, removed: r.removed };
  }

  // 週の項目へ反映。消える項目に、週の中の日の実績があるかも返す
  function mergeWeekItems(week, rows, mode, makeId) {
    const r = mergeByName(week?.items || [], rows, mode, makeId,
      (row, id) => ({ id, ...row }),
      (it) => daysInWeek(week).some(([, day]) => day.log?.[it.id]));
    return { items: r.list, added: r.added, updated: r.updated, removed: r.removed };
  }

  const Planner = {
    MAX_WEEK_DAYS, ymd, parseDate, addDays, num, datesOf, workdays, validateWeekRange, defaultDate, daySummary,
    sumLog, sortByPriority, planDay, elapsedDays, judge, weekProgress, avgMinutesPerUnit,
    monthOf, addMonths, daysInMonth, monthRange, isDayClosed, monthElapsedDays, weeksInMonth, goalActual, goalLinked,
    monthProgress, monthCheckpoints, validateMonthEntry, copyMonthGoals,
    itemDefaults, goalSourceDefault, findWeekByRange, normalizeImportRows, mergeMonthGoals, mergeWeekItems,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Planner;
  } else {
    window.Planner = Planner;
  }
})();
