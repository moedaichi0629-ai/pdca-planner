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
  // 予定外にやったこと（週の項目にないこと）の時間の合計
  const extrasMin = (day) => (day?.extras || []).reduce((s, e) => s + num(e.min), 0);

  function daySummary(day) {
    const plan = day?.plan || [];
    const log = day?.log || {};
    return {
      planMin: plan.reduce((s, x) => s + num(x.min), 0),
      // 実際の時間には、予定外にやったこと（セミナーなど）の時間も入れる
      actualMin: Object.values(log).reduce((s, l) => s + num(l.min), 0) + extrasMin(day),
      extraMin: extrasMin(day),
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

  // ---------- カテゴリー・毎日すること（F-12・F-13） ----------
  // 毎日やる項目か（「1日にやる量」が0より大きいときだけ毎日やる項目として扱う）
  const isDaily = (it) => !!it.daily && num(it.dailyQty) > 0;

  // F-14 曜日指定。曜日は 0（日）〜6（土）。毎日やる項目には使わない
  const dayOfWeek = (date) => parseDate(date).getDay();
  const weekdaysOf = (it) =>
    isDaily(it) || !Array.isArray(it.weekdays) ? [] : [...new Set(it.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  const hasWeekdays = (it) => weekdaysOf(it).length > 0;
  // 週の稼働日のうち、指定した曜日の日
  function weekdayDays(week, it) {
    const wds = weekdaysOf(it);
    return workdays(week).filter((d) => wds.includes(dayOfWeek(d)));
  }

  // F-15 1日の最低時間（分）。毎日やる項目・1回の時間が0の項目には使わない（0 を返す）
  const minDailyOf = (it) => (isDaily(it) || num(it.minutes) <= 0 ? 0 : Math.max(0, num(it.minDailyMin)));
  // 1日の最低時間のある項目は、時間（分）で割り振り、量は「分 ÷ 1回の時間」の小数第2位まで（1単位の途中まで）にする
  const round2 = (v) => Math.round(v * 100) / 100;

  // 1単位あたりの時間（分）。毎日やる項目は「今かかっている時間 ÷ 1日にやる量」、それ以外は1回の時間
  const perUnitMin = (it) => (isDaily(it) ? Math.max(0, num(it.dailyMin)) / num(it.dailyQty) : Math.max(0, num(it.minutes)));

  // 項目・目標のカテゴリー id。未選択や削除済みのカテゴリーは null（その他）
  function categoryOf(x, categories) {
    const id = x?.categoryId;
    return id && (categories || []).some((c) => c.id === id) ? id : null;
  }

  // F-04 予定外にやったことの確認。問題があれば理由、なければ null。min は分
  function validateExtra(name, min) {
    if (!String(name ?? "").trim()) return "やったことの名前を入れてください（例 セミナー）。";
    const m = Number(min);
    if (min === "" || min === null || min === undefined || !Number.isFinite(m) || m <= 0) return "かかった時間を0より大きい数で入れてください。";
    if (m > 24 * 60) return "かかった時間は24時間までにしてください。";
    return null;
  }

  // 割合の合計（%）
  const ratioTotal = (categories) => (categories || []).reduce((s, c) => s + Math.max(0, num(c.ratio)), 0);

  // カテゴリーの名前と割合の確認。問題があれば理由、なければ null（exceptId は編集中のカテゴリー）
  function validateCategory(name, ratio, categories, exceptId) {
    const n = String(name ?? "").trim();
    if (!n) return "カテゴリーの名前を入れてください。";
    if (n === "その他") return "「その他」は未選択の項目に使う名前なので、別の名前にしてください。";
    if ((categories || []).some((c) => c.id !== exceptId && c.name === n)) return `「${n}」はもうあります。別の名前にしてください。`;
    const r = Number(ratio);
    if (ratio === "" || ratio === null || ratio === undefined || !Number.isFinite(r) || r < 0 || r > 100) return "割合を0〜100の数で入れてください。";
    return null;
  }

  // 名前に入っているカテゴリー名のうち、いちばん長いもの（英字の大文字・小文字は区別しない）。なければ null
  function guessCategory(name, categories) {
    const n = String(name ?? "").toLowerCase();
    let best = null;
    for (const c of categories || []) {
      const cn = String(c.name ?? "").trim().toLowerCase();
      if (cn && n.includes(cn) && (!best || cn.length > best.name.trim().length)) best = c;
    }
    return best ? best.id : null;
  }

  // ---------- 4.1 / 4.2 今日の予定 ----------
  // 1. 毎日すること（稼働日のみ）→ 2. カテゴリーの持ち時間を割合で出し、そのカテゴリーの毎日することを含める
  // → 3. 持ち時間の残りでカテゴリーの中を優先度順 → 4. 余った時間を割合の大きい順・その他の順に回す → 5. 入らない分は skipped へ。
  // カテゴリーがなければ、毎日することのあとは優先度順に詰める（今までの割り振り）。
  // 予定の行は { itemId, qty, min }。毎日やる項目は daily: true、カテゴリーがあれば categoryId を足す
  function planDay(week, date, hours, categories) {
    const cats = categories || [];
    const remDays = workdays(week).filter((d) => d > date).length + 1;
    const isOff = (week.offDays || []).includes(date);
    let avail = Math.max(0, Math.round(num(hours) * 60));
    const row = (it, qty, min, daily) => {
      const r = { itemId: it.id, qty, min };
      if (daily) r.daily = true;
      const c = categoryOf(it, cats);
      if (c) r.categoryId = c;
      return r;
    };
    const dailyPlan = [];
    const skipped = [];
    const entries = []; // 毎日やる項目以外 { it, need, qty }
    const reservedOf = {}; // F-15 1日の最低時間として先に取った分（カテゴリー id → 分。カテゴリーなしは ""）
    let dailyMin = 0;
    let dailyShort = false;

    for (const it of sortByPriority(week.items || [])) {
      const minD = minDailyOf(it);
      let remaining = Math.max(0, num(it.target) - sumLog(week, it.id, (d) => d < date));
      if (minD > 0) remaining = round2(remaining);
      if (remaining <= 0) continue;
      if (isDaily(it)) {
        if (isOff) continue; // 休みの日は毎日やる項目を入れない
        const need = Math.min(num(it.dailyQty), remaining);
        const per = perUnitMin(it);
        let qty = need;
        if (Math.round(per * need) > avail) {
          qty = per > 0 ? Math.min(need, Math.floor(avail / per)) : need;
          dailyShort = true;
        }
        if (qty > 0) {
          const min = Math.round(per * qty);
          dailyPlan.push(row(it, qty, min, true));
          avail -= min;
          dailyMin += min;
        }
        if (qty < need) skipped.push(row(it, need - qty, Math.round(per * (need - qty)), true));
        continue;
      }
      let need = Math.ceil(remaining / remDays);
      if (hasWeekdays(it)) {
        // 指定した曜日の日だけ、残りを残りの指定曜日の数で分ける。指定曜日がまだ先なら今日は入れない。
        // 指定曜日がもうない（過ぎた・休みの日に当たった）ときは、残りを今日まとめて入れる
        const future = weekdayDays(week, it).filter((d) => d >= date);
        if (future.includes(date)) need = Math.ceil(remaining / future.length);
        else if (future.length) continue;
        else need = remaining;
      }
      const e = { it, need, qty: 0 };
      if (minD > 0) {
        // F-15 必要な時間 = max(必要量 × 1回の時間, 1日の最低時間)。ただし残りの量の時間まで
        const remMin = Math.round(remaining * num(it.minutes));
        e.remaining = remaining;
        e.needMin = Math.min(remMin, Math.max(Math.round(Math.min(need, remaining) * num(it.minutes)), isOff ? 0 : minD));
        e.min = 0;
        // 1日の最低時間は、作業する日に毎日することと同じように先に取る
        if (!isOff) {
          const m = Math.min(minD, remMin, avail);
          e.min = m;
          avail -= m;
          const c = categoryOf(it, cats) || "";
          reservedOf[c] = (reservedOf[c] || 0) + m;
        }
      }
      entries.push(e);
    }

    // budget 分の中で、entry の残りの必要量をできるだけ入れる。使った分を返す
    const fill = (e, budget) => {
      const per = Math.max(0, num(e.it.minutes));
      if (e.needMin !== undefined) {
        // 1日の最低時間のある項目は、分で入れる（1単位の途中まででも入れる）
        const m = Math.max(0, Math.min(e.needMin - e.min, budget));
        e.min += m;
        return m;
      }
      const left = e.need - e.qty;
      const q = per > 0 ? Math.min(left, Math.floor(budget / per)) : left;
      e.qty += q;
      return q * per;
    };

    let budgets = [];
    if (!cats.length) {
      for (const e of entries) avail -= fill(e, avail);
    } else {
      // 2. カテゴリーの毎日することは、そのカテゴリーの持ち時間に含める
      const dailyOf = {};
      for (const r of dailyPlan) if (r.categoryId) dailyOf[r.categoryId] = (dailyOf[r.categoryId] || 0) + r.min;
      // 1日の最低時間として先に取った分も、そのカテゴリーの持ち時間に含める（カテゴリーなしの分は含めない）
      for (const [c, m] of Object.entries(reservedOf)) if (c) dailyOf[c] = (dailyOf[c] || 0) + m;
      const catDaily = Object.values(dailyOf).reduce((s, v) => s + v, 0);
      const base = avail + catDaily; // 使える時間 − カテゴリーなしの毎日すること
      budgets = splitBudgets(cats, base, dailyOf);
      let pool = base - budgets.reduce((s, b) => s + b.min, 0); // 切り捨ての端数
      // 3. 持ち時間から毎日することを引いた残りで、カテゴリーの中を優先度順。使い切らなかった分は pool へ
      for (const b of budgets) {
        let left = b.min - (dailyOf[b.categoryId] || 0);
        for (const e of entries.filter((x) => categoryOf(x.it, cats) === b.categoryId)) left -= fill(e, left);
        pool += left;
      }
      // 4. 割合の大きい順（同じなら登録順）→ その他。各カテゴリーの中は優先度順
      const order = [...cats].sort((a, b) => Math.max(0, num(b.ratio)) - Math.max(0, num(a.ratio))).map((c) => c.id);
      for (const id of [...order, null]) {
        for (const e of entries.filter((x) => categoryOf(x.it, cats) === id)) pool -= fill(e, pool);
      }
    }

    const plan = [...dailyPlan];
    for (const e of entries) {
      const per = Math.max(0, num(e.it.minutes));
      if (e.needMin !== undefined) {
        // 量は分から出す。残りの量の時間をすべて入れたときは、残りの量そのもの
        const remMin = Math.round(e.remaining * per);
        const qtyOf = (m) => (m >= remMin ? e.remaining : Math.min(e.remaining, round2(m / per)));
        if (e.min > 0) plan.push(row(e.it, qtyOf(e.min), e.min));
        const leftMin = e.needMin - e.min;
        if (leftMin > 0) skipped.push(row(e.it, round2(qtyOf(e.needMin) - qtyOf(e.min)), leftMin));
        continue;
      }
      if (e.qty > 0) plan.push(row(e.it, e.qty, e.qty * per));
      if (e.qty < e.need) skipped.push(row(e.it, e.need - e.qty, (e.need - e.qty) * per));
    }
    return { plan, skipped, alloc: { dailyMin, budgets, dailyShort } };
  }

  // 4.2 手順2 カテゴリーの持ち時間。base を割合で分ける（切り捨て）。
  // 毎日することだけで割合の分を超えるカテゴリーは毎日することの時間だけにし、残りをほかのカテゴリーで割合どおりに分け直す
  function splitBudgets(cats, base, dailyOf) {
    const ratio = (c) => Math.max(0, num(c.ratio));
    const fixed = {}; // 毎日することの時間だけにしたカテゴリー
    for (;;) {
      const rest = cats.filter((c) => !(c.id in fixed));
      const left = base - Object.values(fixed).reduce((s, v) => s + v, 0);
      const total = rest.reduce((s, c) => s + ratio(c), 0);
      const share = (c) => (total > 0 ? Math.floor((left * ratio(c)) / total) : 0);
      const over = rest.filter((c) => (dailyOf[c.id] || 0) > share(c));
      if (!over.length) return cats.map((c) => ({ categoryId: c.id, min: c.id in fixed ? fixed[c.id] : share(c) }));
      for (const c of over) fixed[c.id] = dailyOf[c.id];
    }
  }

  // 4.7 今日の内訳。毎日すること・各カテゴリー・その他・余りの、持ち時間・予定・実際（分）
  // 予定は作った時点の区分（予定の行の daily・categoryId）で数え、予定外にやった項目は今の区分で数える。
  // 毎日やる項目はそのカテゴリーに数え、カテゴリーなしのものだけ「毎日すること」に数える。
  // 各区分の items には、その中の毎日やる項目を並べる（予定の順、そのあとに予定外にやった毎日やる項目）
  function dayBreakdown(day, items, categories) {
    const cats = categories || [];
    const im = Object.fromEntries((items || []).map((i) => [i.id, i]));
    const keyOf = (daily, categoryId) => categoryOf({ categoryId }, cats) || (daily ? "daily" : "other");
    const plannedKey = {};
    const planMin = {};
    const dailyItems = {}; // 区分 → 毎日やる項目の一覧
    const dailyRow = (k, id) => {
      const list = (dailyItems[k] = dailyItems[k] || []);
      let r = list.find((x) => x.itemId === id);
      if (!r) list.push((r = { itemId: id, name: im[id]?.name ?? "", unit: im[id]?.unit ?? "", qty: 0, planMin: 0, actualMin: 0 }));
      return r;
    };
    const dailyPlanned = new Set();
    for (const p of day?.plan || []) {
      const k = keyOf(p.daily, p.categoryId);
      plannedKey[p.itemId] = k;
      planMin[k] = (planMin[k] || 0) + num(p.min);
      if (p.daily) {
        dailyPlanned.add(p.itemId);
        const r = dailyRow(k, p.itemId);
        r.qty += num(p.qty);
        r.planMin += num(p.min);
      }
    }
    const actualMin = {};
    for (const [id, l] of Object.entries(day?.log || {})) {
      const it = im[id];
      if (!it && !plannedKey[id]) continue;
      const k = plannedKey[id] || keyOf(isDaily(it), it.categoryId);
      actualMin[k] = (actualMin[k] || 0) + num(l.min);
      if (dailyPlanned.has(id) || (!plannedKey[id] && isDaily(it))) dailyRow(k, id).actualMin += num(l.min);
    }
    // 予定外にやったことは、選んだカテゴリー（未選択は「その他」）の実際の時間に入れる
    for (const e of day?.extras || []) {
      const k = categoryOf(e, cats) || "other";
      actualMin[k] = (actualMin[k] || 0) + num(e.min);
    }
    const budgetOf = Object.fromEntries((day?.alloc?.budgets || []).map((b) => [b.categoryId, num(b.min)]));
    const seg = (key, kind, name, index, budget) => ({
      key, kind, name, index, budget, planMin: planMin[key] || 0, actualMin: actualMin[key] || 0, items: dailyItems[key] || [],
    });
    const segments = [];
    if (planMin.daily || actualMin.daily || dailyItems.daily) segments.push(seg("daily", "daily", cats.length ? "毎日すること（カテゴリーなし）" : "毎日すること", -1, null));
    cats.forEach((c, i) => segments.push(seg(c.id, "category", c.name, i, budgetOf[c.id] ?? null)));
    if (planMin.other || actualMin.other) segments.push(seg("other", "other", "その他", -1, null));
    const total = Math.max(0, Math.round(num(day?.hours) * 60));
    const planned = segments.reduce((s, x) => s + x.planMin, 0);
    return {
      total,
      segments,
      free: Math.max(0, total - planned),
      hasActual: segments.some((x) => x.actualMin > 0),
      dailyShort: !!day?.alloc?.dailyShort,
    };
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
    let expectedMin = 0; // 曜日指定の項目があるときの全体の判定に使う
    let anyWeekdays = false;
    const items = sortByPriority(week.items || []).map((it) => {
      const target = num(it.target);
      const actual = sumLog(week, it.id, () => true);
      const per = perUnitMin(it);
      const remaining = Math.max(0, target - actual);
      targetMin += target * per;
      actualMin += Math.min(actual, target) * per;
      remainingMin += remaining * per;
      // F-14 曜日指定の項目は、経過した日数ではなく、経過した指定曜日の数で判定する
      let el = elapsed;
      let tot = wd.length;
      let perDay = remDays ? Math.ceil(remaining / remDays) : remaining;
      let weekdayRest = null; // 残りの指定曜日の数（曜日指定がないときは null）
      const wdd = hasWeekdays(it) ? weekdayDays(week, it) : [];
      if (wdd.length) {
        anyWeekdays = true;
        tot = wdd.length;
        el = today > week.end ? tot : wdd.filter((d) => d < today).length + (wdd.includes(today) && closedToday ? 1 : 0);
        weekdayRest = wdd.filter((d) => d > today || (d === today && !closedToday)).length;
        perDay = weekdayRest ? Math.ceil(remaining / weekdayRest) : remaining;
      }
      expectedMin += tot ? (target * per * el) / tot : 0;
      return {
        itemId: it.id,
        target,
        actual,
        remaining,
        pct: target ? Math.round((actual / target) * 100) : 0,
        perDay,
        weekdayRest,
        expectedPct: tot ? Math.min(100, (el / tot) * 100) : 0,
        status: judge(actual, target, el, tot),
      };
    });
    return {
      items,
      // 曜日指定の項目があるときは、項目ごとの「終わっているはずの時間」を合わせて判定する
      overall: anyWeekdays ? judge(actualMin, targetMin, expectedMin, targetMin) : judge(actualMin, targetMin, elapsed, wd.length),
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

  // 前の月の目標を引き継ぐ。名前・単位・目標量・最低目標・挑戦目標・集め方・カテゴリーだけを写し、手入力の実績は写さない
  function copyMonthGoals(goals, makeId) {
    return (goals || []).map((g) => ({
      id: makeId(),
      name: g.name,
      unit: g.unit,
      target: g.target,
      minimum: minimumOf(g),
      stretch: stretchOf(g),
      source: g.source === "manual" ? "manual" : "weekly",
      categoryId: g.categoryId ?? null,
      entries: [],
    }));
  }

  // ---------- 4.6 文章からまとめて登録（F-11） ----------
  const DEFAULT_ITEM = { minutes: 30, priority: 3 };

  // 週の項目の「1回の時間・優先度・カテゴリー・毎日やる」の初期値。
  // 登録先の週（currentItems）に同じ名前があればその値、なければ start より前の週でいちばん新しい同じ名前の項目の値。
  // どちらもなければ 30分・優先度3・毎日やるなし。カテゴリーは名前に入っているカテゴリー名（guessCategory）
  function itemDefaults(weeks, name, start, currentItems, categories) {
    const pickOf = (it) => ({
      minutes: num(it.minutes),
      priority: num(it.priority) || DEFAULT_ITEM.priority,
      categoryId: categoryOf(it, categories),
      daily: !!it.daily,
      dailyQty: optNum(it.dailyQty),
      dailyMin: optNum(it.dailyMin),
      weekdays: weekdaysOf(it).sort(),
      minDailyMin: it.daily ? null : optNum(it.minDailyMin),
    });
    const cur = (currentItems || []).find((i) => i.name === name);
    if (cur) return pickOf(cur);
    const prev = Object.values(weeks || {})
      .filter((w) => w.start < start)
      .sort((a, b) => (a.start < b.start ? 1 : -1))
      .map((w) => (w.items || []).find((i) => i.name === name))
      .find(Boolean);
    if (prev) return pickOf(prev);
    return { ...DEFAULT_ITEM, categoryId: guessCategory(name, categories), daily: false, dailyQty: null, dailyMin: null, weekdays: [], minDailyMin: null };
  }

  // 月の目標のカテゴリーの初期値。今の目標に同じ名前があればそのカテゴリー、なければ名前に入っているカテゴリー名
  function goalCategoryDefault(name, currentGoals, categories) {
    const cur = (currentGoals || []).find((g) => g.name === name);
    return cur ? categoryOf(cur, categories) : guessCategory(name, categories);
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
  function normalizeImportRows(rows, kind, categories) {
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
        row.categoryId = categoryOf(r, categories);
      } else {
        if (!isNum(r.minutes)) return { ok: false, error: `${at}（${name}）: 1回の時間を0以上の数で入れてください。` };
        const p = Number(r.priority);
        if (!Number.isInteger(p) || p < 1 || p > 5) return { ok: false, error: `${at}（${name}）: 優先度は1〜5で選んでください。` };
        row.minutes = Number(r.minutes);
        row.priority = p;
        row.categoryId = categoryOf(r, categories);
        row.daily = !!r.daily;
        if (row.daily) {
          if (!isNum(r.dailyQty) || Number(r.dailyQty) <= 0) return { ok: false, error: `${at}（${name}）: 1日にやる量を0より大きい数で入れてください。` };
          if (!isNum(r.dailyMin)) return { ok: false, error: `${at}（${name}）: 今かかっている時間を0以上の数で入れてください。` };
        }
        row.dailyQty = isNum(r.dailyQty) ? Number(r.dailyQty) : null;
        row.dailyMin = isNum(r.dailyMin) ? Number(r.dailyMin) : null;
        row.weekdays = row.daily ? [] : weekdaysOf({ weekdays: r.weekdays }).sort();
        row.minDailyMin = row.daily || !isNum(r.minDailyMin) || Number(r.minDailyMin) <= 0 ? null : Number(r.minDailyMin);
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
    isDaily, perUnitMin, categoryOf, ratioTotal, validateCategory, guessCategory, goalCategoryDefault, dayBreakdown,
    validateExtra, dayOfWeek, weekdaysOf, hasWeekdays, weekdayDays, minDailyOf,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Planner;
  } else {
    window.Planner = Planner;
  }
})();
