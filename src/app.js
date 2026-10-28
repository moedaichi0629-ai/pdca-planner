// 画面の描画とイベント処理。計算は Planner（src/planner.js）、保存は PlannerStorage（src/storage.js）だけを使う。
(function () {
  "use strict";

  const P = window.Planner;
  const S = window.PlannerStorage;

  // ---------- 表示用の小さな関数 ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WD = "日月火水木金土";
  const dlabel = (s) => {
    const d = P.parseDate(s);
    return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
  };
  const todayStr = () => P.ymd(new Date());
  const fmtMin = (m) => {
    m = Math.max(0, Math.round(m));
    if (m < 60) return m + "分";
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}時間${r}分` : `${h}時間`;
  };
  const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  const fmtNum = (v) => P.num(v).toLocaleString("ja-JP");
  const monthLabel = (m) => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;

  // ---------- 状態 ----------
  const loaded = S.load();
  let data = loaded.data;
  let readOnly = loaded.readOnly; // 読めなかった元データを退避できなかったときは保存しない

  const ui = {
    tab: "today",
    date: null, // 今日タブで選んだ日
    armed: null, // 削除の1回目を押した項目
    notice: loaded.error, // 画面上部に出す理由
    createMsg: "",
    weekMsg: "",
    hoursMsg: "",
    dataMsg: null, // { kind: "ok" | "error", text }
    importPending: null, // { data, name }
    hoursValue: null, // 検証で弾いた「使える時間」の入力をそのまま残す
    month: P.monthOf(todayStr()), // 月タブで表示する月（YYYY-MM）
    entryMsg: {}, // 目標 id → 手入力の実績を弾いた理由
  };

  function setSave(state, text) {
    const el = $("#save");
    el.dataset.s = state;
    el.textContent = text;
  }

  function persist() {
    if (readOnly) {
      setSave("err", "保存を止めています");
      return;
    }
    if (S.save(data)) setSave("ok", "保存済み");
    else setSave("err", "保存できませんでした");
  }

  function sortedWeeks() {
    return Object.values(data.weeks).sort((a, b) => (a.start < b.start ? 1 : -1));
  }

  function curWeek() {
    const w = data.weeks[data.settings.currentWeek];
    if (w) return w;
    const t = todayStr();
    const list = sortedWeeks();
    return list.find((x) => x.start <= t && t <= x.end) || list[0] || null;
  }

  const items = (w) => w.items || (w.items = []);
  const offDays = (w) => w.offDays || [];
  const activeDate = (w) => P.defaultDate(w, todayStr(), ui.date);

  function touchDay(w, date) {
    w.days = w.days || {};
    w.days[date] = w.days[date] || {};
    return w.days[date];
  }

  // 表示中の月のデータ。まだなければ保存せずに空の形を返す
  const monthRec = (m) => data.months?.[m] || { month: m, goals: [], review: {} };

  // 月のデータを作って返す（目標やメモを書き込むとき）
  function ensureMonth(m) {
    data.months = data.months || {};
    const rec = (data.months[m] = data.months[m] || { month: m, goals: [], review: { good: "", issues: "", act: "" } });
    rec.goals = rec.goals || [];
    rec.review = rec.review || { good: "", issues: "", act: "" };
    return rec;
  }

  // ---------- 描画 ----------
  function render() {
    const fid = document.activeElement?.id;
    const w = curWeek();
    $("#weekLabel").textContent = w ? `${dlabel(w.start)}〜${dlabel(w.end)} の週` : "週がまだありません";
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === ui.tab)));

    const notice = $("#notice");
    notice.hidden = !ui.notice;
    notice.innerHTML = ui.notice
      ? `<span>${esc(ui.notice)}</span><button type="button" class="btn quiet" data-act="dismiss-notice">閉じる</button>`
      : "";

    const p = $("#panel");
    if (ui.tab === "setup") p.innerHTML = setupView(w);
    else if (ui.tab === "month") p.innerHTML = monthView();
    else if (!w) p.innerHTML = noWeekView();
    else if (!items(w).length) p.innerHTML = noItemsView();
    else p.innerHTML = ui.tab === "today" ? todayView(w) : progressView(w);

    if (fid) document.getElementById(fid)?.focus();
  }

  // change のあとは、フォーカスが次の入力欄に移ってから描画し直す
  const scheduleRender = () => setTimeout(render, 0);

  function noWeekView() {
    return `<div class="empty">
      <h2>まず1週間の期間を決めましょう</h2>
      <ol class="steps">
        <li>「週の設定」で開始日と終了日を入れて週を作る</li>
        <li>その週の目標（やること・量・1回の時間・優先度）を登録する</li>
        <li>「今日」でその日に使える時間を入れて「予定を作る」</li>
      </ol>
      <button type="button" class="btn" data-act="goto-setup">週を作る</button>
      <p class="small muted">書き出したバックアップがある場合は「週の設定」の下の「データを読み込む」から戻せます。</p>
    </div>`;
  }

  function noItemsView() {
    return `<div class="empty">
      <h2>この週の目標がまだありません</h2>
      <p class="muted">「週の設定」で、やること・週の目標量・1回あたりの時間・優先度を登録してください。登録すると、その日に使える時間から予定を計算します。</p>
      <button type="button" class="btn" data-act="goto-setup">目標を登録する</button>
    </div>`;
  }

  function todayView(w) {
    const date = activeDate(w);
    const t = todayStr();
    const day = w.days?.[date];
    const im = Object.fromEntries(items(w).map((i) => [i.id, i]));
    const off = offDays(w).includes(date);
    const chips = P.datesOf(w)
      .map((d) => `<button type="button" class="chip${offDays(w).includes(d) ? " off" : ""}${d === t ? " today" : ""}" aria-pressed="${d === date}" data-act="pick-date" data-date="${esc(d)}">${dlabel(d)}</button>`)
      .join("");

    if (!day || !day.plan) {
      const hours = ui.hoursValue ?? data.settings.lastHours ?? "";
      return `<div class="chips">${chips}</div>
        <div class="stack">
          <h2>${dlabel(date)}${off ? ' <span class="pill wait">休みの日</span>' : ""}</h2>
          <p class="muted small">この日に作業に使える時間を入れてください。週の残りの量を残りの日数で割り、優先度の高い順に時間内へ並べます。</p>
          <div class="row">
            <label class="f">使える時間（時間）<input id="hours" type="number" min="0.5" max="24" step="0.5" inputmode="decimal" value="${esc(hours)}" placeholder="例 3"></label>
            <button type="button" class="btn end" data-act="make-plan">予定を作る</button>
          </div>
          <p class="small error">${esc(ui.hoursMsg)}</p>
        </div>`;
    }

    const log = day.log || {};
    const sum = P.daySummary(day);
    const planned = day.plan.filter((x) => im[x.itemId]);
    const rows = planned.length
      ? planned.map((x) => taskRow(im[x.itemId], x, log[x.itemId])).join("")
      : `<p class="muted">この日にやる量は残っていません。週の目標はすべて達成済みか、0件です。</p>`;
    const skipped = (day.skipped || []).filter((x) => im[x.itemId]);
    const skipHtml = skipped.length
      ? `<div class="skip"><b>今日は入らなかった</b>${skipped
          .map((x) => `<span class="small">${esc(im[x.itemId].name)}：<span class="num">${esc(x.qty)}</span>${esc(im[x.itemId].unit)}（${fmtMin(x.min)}）</span>`)
          .join("")}<span class="small muted">残りの日の予定に自動で回ります。遅れが続く場合は目標量か使える時間を見直してください。</span></div>`
      : "";
    const plannedIds = new Set(day.plan.map((x) => x.itemId));
    const extra = items(w).filter((i) => !plannedIds.has(i.id));
    const extraHtml = extra.length
      ? `<details${extra.some((i) => log[i.id]) ? " open" : ""}><summary>予定外にやった分を記録する</summary><div>${extra.map((i) => taskRow(i, null, log[i.id])).join("")}</div></details>`
      : "";

    return `<div class="chips">${chips}</div>
      <div class="row between"><h2>${dlabel(date)} の予定</h2><button type="button" class="btn quiet" data-act="replan">時間を変えて作り直す</button></div>
      <div class="meter">
        <div><b>${fmtMin(P.num(day.hours) * 60)}</b><span>使える時間</span></div>
        <div><b>${fmtMin(sum.planMin)}</b><span>予定</span></div>
        <div><b>${fmtMin(sum.actualMin)}</b><span>実際にかかった時間</span></div>
      </div>
      <div>${rows}</div>
      ${skipHtml}
      ${extraHtml}
      <div class="row between">
        <span class="small muted">完了 <span class="num">${sum.doneCount}/${sum.planCount}</span> 項目</span>
        <button type="button" class="btn${day.closed ? " ghost" : ""}" data-act="close-day">${day.closed ? "締めを取り消す" : "この日を締める"}</button>
      </div>
      ${day.closed
        ? `<p class="note">この日は締め済みです。進捗の「予定通り／遅れ」の判定にこの日の実績が含まれます。</p>`
        : `<p class="note">作業が終わったら「この日を締める」を押すと、進捗の判定にこの日が加わります。</p>`}`;
  }

  function taskRow(it, plan, l) {
    const done = !!l?.done;
    const k = esc(it.id);
    const target = plan
      ? `予定 <span class="num">${esc(plan.qty)}</span>${esc(it.unit)} · ${fmtMin(plan.min)}`
      : `1${esc(it.unit)}あたり ${fmtMin(P.num(it.minutes))}`;
    return `<div class="task${done ? " done" : ""}">
      ${plan ? `<input type="checkbox" id="done-${k}" data-act="toggle-done" data-item="${k}" ${done ? "checked" : ""} aria-label="${esc(it.name)}を完了にする">` : "<span></span>"}
      <div class="name">${esc(it.name)} <span class="small muted">${target}</span></div>
      <div class="act">
        <label class="row">実績<input id="qty-${k}" type="number" min="0" step="1" inputmode="numeric" data-act="log" data-field="qty" data-item="${k}" value="${esc(l?.qty)}" placeholder="${plan ? esc(plan.qty) : 0}">${esc(it.unit)}</label>
        <label class="row">かかった時間<input id="min-${k}" type="number" min="0" step="5" inputmode="numeric" data-act="log" data-field="min" data-item="${k}" value="${esc(l?.min)}" placeholder="${plan ? esc(plan.min) : 0}">分</label>
      </div>
    </div>`;
  }

  function progressView(w) {
    const pr = P.weekProgress(w, todayStr());
    const im = Object.fromEntries(items(w).map((i) => [i.id, i]));
    const rows = pr.items
      .map((x) => {
        const it = im[x.itemId];
        const unit = esc(it.unit);
        let rest = "完了";
        if (x.remaining) {
          rest = pr.remDays
            ? `残り${esc(x.remaining)}${unit} → 1日あたり${esc(x.perDay)}${unit}`
            : `残り${esc(x.remaining)}${unit}（週の稼働日は終了）`;
        }
        return `<div class="prog">
          <div class="row between"><span class="title">${esc(it.name)}</span><span class="pill ${x.status.k}">${x.status.label}</span></div>
          <div class="bar" role="img" aria-label="達成率${x.pct}%"><i style="width:${Math.min(100, x.pct)}%"></i>${pr.elapsed ? `<u style="left:calc(${pr.expectedPct}% - 1px)"></u>` : ""}</div>
          <div class="row between small muted">
            <span><span class="num">${esc(x.actual)}/${esc(x.target)}</span>${unit}（<span class="num">${x.pct}</span>%）</span>
            <span>${rest}</span>
          </div>
        </div>`;
      })
      .join("");
    return `<div class="row between"><h2>週の進捗</h2><span class="pill ${pr.overall.k}">全体：${pr.overall.label}</span></div>
      <div class="meter">
        <div><b>${pr.elapsed}/${pr.totalDays}日</b><span>経過した稼働日</span></div>
        <div><b>${fmtMin(pr.remainingMin)}</b><span>残りの作業時間</span></div>
        <div><b>${pr.remDays ? fmtMin(pr.needMinPerDay) : "-"}</b><span>1日あたり必要</span></div>
      </div>
      <div>${rows}</div>
      <p class="note">判定は「実績 ÷ 今の時点で終わっているはずの量」で出しています。100%以上で予定通り、80〜99%で遅れ気味、80%未満で遅れです。終わっているはずの量は、締めた日と過ぎた日の数で計算します（バーの縦線）。全体の判定は、各項目を作業時間の重みで合わせたものです。</p>`;
  }

  function setupView(w) {
    const list = sortedWeeks();
    const newStart = list.length ? P.addDays(list[0].end, 1) : todayStr();
    const createForm = `<div class="stack">
      <h3>${list.length ? "新しい週を作る" : "最初の週を作る"}</h3>
      <div class="row">
        <label class="f">開始日<input id="new-start" type="date" value="${esc(newStart)}"></label>
        <label class="f">終了日<input id="new-end" type="date" value="${esc(P.addDays(newStart, 6))}"></label>
        ${w && items(w).length ? `<label class="row small end"><input id="new-copy" type="checkbox" checked>今の週の項目を引き継ぐ</label>` : ""}
        <button type="button" class="btn end${w ? " ghost" : ""}" data-act="create-week">週を作る</button>
      </div>
      <p class="small error">${esc(ui.createMsg)}</p>
    </div>`;

    if (!w) {
      return `<h2>週の設定</h2>
        <p class="muted">月や週のPDCAで決めた「週の目標」をここに登録します。まず期間を決めてください（最大${P.MAX_WEEK_DAYS}日）。</p>
        ${createForm}
        ${dataSection()}`;
    }

    const sel = list.length > 1
      ? `<label class="f">表示する週<select id="week-select" data-act="select-week">${list
          .map((x) => `<option value="${esc(x.id)}"${x.id === w.id ? " selected" : ""}>${dlabel(x.start)}〜${dlabel(x.end)}</option>`)
          .join("")}</select></label>`
      : "";
    const offChips = P.datesOf(w)
      .map((d) => {
        const off = offDays(w).includes(d);
        return `<button type="button" class="chip${off ? " off" : ""}" aria-pressed="${!off}" data-act="toggle-off" data-date="${esc(d)}">${dlabel(d)}</button>`;
      })
      .join("");
    const itemsHtml = items(w).map((it) => itemRow(it)).join("");

    return `<div class="row between"><h2>週の設定</h2>${sel}</div>
      <div class="row">
        <label class="f">開始日<input id="w-start" type="date" data-act="week-date" data-field="start" value="${esc(w.start)}"></label>
        <label class="f">終了日<input id="w-end" type="date" data-act="week-date" data-field="end" value="${esc(w.end)}"></label>
      </div>
      <p class="small error">${esc(ui.weekMsg)}</p>
      <div class="stack"><h3>作業する日（押すと休みの日に切り替わります）</h3><div class="chips">${offChips}</div></div>
      <div class="stack">
        <div class="row between"><h3>週の目標</h3><button type="button" class="btn ghost" data-act="add-item">項目を追加</button></div>
        ${itemsHtml
          ? `<div class="items">${itemsHtml}</div>`
          : `<p class="note">まだ項目がありません。「項目を追加」から、やること・週の目標量・1回あたりの時間を登録してください。優先度1から順に、その日の時間に入れていきます。</p>`}
      </div>
      <details${ui.createMsg ? " open" : ""}><summary>新しい週を作る</summary><div style="padding-top:10px">${createForm}</div></details>
      ${dataSection()}`;
  }

  function itemRow(it) {
    const k = esc(it.id);
    const avg = P.avgMinutesPerUnit(data.weeks, it.name);
    const avgHtml = avg != null
      ? `実績の平均 ${fmtMin(avg)}／${esc(it.unit || "回")}${Math.round(avg) !== P.num(it.minutes) ? ` <button type="button" class="btn quiet" data-act="apply-avg" data-item="${k}">標準時間に反映</button>` : ""}`
      : "実績が入ると、1回あたりの平均時間が出ます";
    const armed = ui.armed === it.id;
    return `<div class="item">
      <label class="f wide">やること<input id="name-${k}" data-act="item" data-field="name" data-item="${k}" value="${esc(it.name)}" placeholder="例 ココナラ商品の出品"></label>
      <label class="f">週の目標量<input id="target-${k}" type="number" min="0" step="1" data-act="item" data-field="target" data-item="${k}" value="${esc(it.target)}"></label>
      <label class="f">単位<input id="unit-${k}" data-act="item" data-field="unit" data-item="${k}" value="${esc(it.unit)}" placeholder="件"></label>
      <label class="f">1回の時間(分)<input id="minutes-${k}" type="number" min="0" step="5" data-act="item" data-field="minutes" data-item="${k}" value="${esc(it.minutes)}"></label>
      <label class="f">優先度<select id="priority-${k}" data-act="item" data-field="priority" data-item="${k}">${[1, 2, 3, 4, 5]
        .map((p) => `<option value="${p}"${P.num(it.priority) === p ? " selected" : ""}>${p}${p === 1 ? "（最優先）" : ""}</option>`)
        .join("")}</select></label>
      <div class="foot"><span>${avgHtml}</span><button type="button" class="btn danger${armed ? " armed" : ""}" data-act="del-item" data-item="${k}">${armed ? "もう一度押すと削除" : "削除"}</button></div>
    </div>`;
  }

  // F-07 書き出し・読み込み（週の設定タブの一番下）
  function dataSection() {
    const pend = ui.importPending;
    const confirm = pend
      ? `<div class="confirm">
          <p><b>「${esc(pend.name)}」で今のデータを上書きしますか？</b></p>
          <p class="small">今のデータ（週 ${Object.keys(data.weeks).length} 件）は消え、ファイルの内容（週 ${Object.keys(pend.data.weeks).length} 件）に置き換わります。不安なときは先に「データを書き出す」で保存してください。</p>
          <div class="row">
            <button type="button" class="btn danger solid" data-act="import-confirm">上書きして読み込む</button>
            <button type="button" class="btn quiet" data-act="import-cancel">やめる</button>
          </div>
        </div>`
      : "";
    const msg = ui.dataMsg ? `<p class="small ${ui.dataMsg.kind === "ok" ? "msg-ok" : "error"}">${esc(ui.dataMsg.text)}</p>` : "";
    return `<div class="stack data-box">
      <h3>データのバックアップ</h3>
      <p class="small muted">データはこのブラウザに自動で保存されます。ブラウザのデータを消すと失われるので、ときどき書き出してください。</p>
      <div class="row">
        <button type="button" class="btn ghost" data-act="export">データを書き出す</button>
        <button type="button" class="btn quiet" data-act="import">データを読み込む</button>
      </div>
      ${confirm}
      ${msg}
    </div>`;
  }

  // ---------- 月タブ（F-08〜F-10） ----------
  function monthView() {
    const m = ui.month;
    const rec = monthRec(m);
    const goals = rec.goals || [];
    const t = todayStr();
    const nav = `<div class="row between month-nav">
        <button type="button" class="btn quiet" data-act="month-prev">‹ 前の月</button>
        <h2>${monthLabel(m)}</h2>
        <button type="button" class="btn quiet" data-act="month-next">次の月 ›</button>
      </div>
      ${m !== P.monthOf(t) ? `<div class="row" style="justify-content:center"><button type="button" class="btn quiet" data-act="month-today">今月（${monthLabel(P.monthOf(t))}）に戻る</button></div>` : ""}`;

    if (!goals.length) {
      const prev = monthRec(P.addMonths(m, -1));
      const canCopy = (prev.goals || []).length > 0;
      return `${nav}
        <div class="empty">
          <h2>この月の目標がまだありません</h2>
          <p class="muted">月の目標（例：Threads 93投稿、売上 50,000円）を登録すると、月の進捗と週末ごとの進み具合が出ます。週の項目と同じ名前にすると、週の実績から自動で集めます。</p>
          <div class="row" style="justify-content:center">
            ${canCopy ? `<button type="button" class="btn" data-act="copy-prev-goals">前の月の目標を引き継ぐ</button>` : ""}
            <button type="button" class="btn${canCopy ? " ghost" : ""}" data-act="add-goal">目標を追加</button>
          </div>
          ${canCopy ? `<p class="small muted">引き継ぐのは名前・単位・目標量・挑戦目標・集め方だけです（${monthLabel(P.addMonths(m, -1))}の目標 ${prev.goals.length} 件）。</p>` : ""}
        </div>
        ${reviewSection(rec)}`;
    }

    const pr = P.monthProgress(rec, data.weeks, t);
    const gm = Object.fromEntries(goals.map((g) => [g.id, g]));
    const rows = pr.goals
      .map((x) => {
        const g = gm[x.goalId];
        const unit = esc(g.unit);
        const stretch = x.stretch === null ? "" : ` · 挑戦 <span class="num">${fmtNum(x.stretch)}</span>${unit}（<span class="num">${x.stretchPct}</span>%）`;
        let warn = "";
        if (!g.name) warn = `<span class="warn-text">名前を入れてください。</span>`;
        else if (!x.linked) warn = `<span class="warn-text">この月の週に「${esc(g.name)}」という項目がありません。週の設定の項目名と同じ名前にすると実績を集めます。</span>`;
        return `<div class="prog">
          <div class="row between"><span class="title">${esc(g.name) || "（名前なし）"}</span><span class="pill ${x.status.k}">${x.status.label}</span></div>
          <div class="bar" role="img" aria-label="達成率${x.pct}%"><i style="width:${Math.min(100, x.pct)}%"></i>${pr.elapsed ? `<u style="left:calc(${pr.expectedPct}% - 1px)"></u>` : ""}</div>
          <div class="small muted"><span class="num">${fmtNum(x.actual)}/${fmtNum(x.target)}</span>${unit}（<span class="num">${x.pct}</span>%）${stretch}</div>
          ${warn}
        </div>`;
      })
      .join("");

    return `${nav}
      <div class="stack">
        <div class="row between"><h3>月の進捗</h3><span class="small muted">経過 <span class="num">${pr.elapsed}/${pr.totalDays}</span>日</span></div>
        <div>${rows}</div>
      </div>
      ${checkpointSection(rec, gm, t)}
      ${goalsSection(rec)}
      ${reviewSection(rec)}`;
  }

  // F-09 週末ごとの進み具合
  function checkpointSection(rec, gm, t) {
    const cps = P.monthCheckpoints(rec, data.weeks, t);
    const body = cps.length
      ? `<div class="cps">${cps
          .map((cp) => {
            const lines = cp.goals
              .map((x) => {
                const g = gm[x.goalId];
                const stretch = x.stretchPct === null ? "" : ` · 挑戦 ${x.stretchPct}%`;
                return `<li><span class="gname">${esc(g.name) || "（名前なし）"}</span><span><span class="num">${fmtNum(x.actual)}/${fmtNum(g.target)}</span>${esc(g.unit)}（<span class="num">${x.pct}</span>%${stretch}）</span></li>`;
              })
              .join("");
            return `<div class="cp${cp.inProgress ? " current" : ""}">
              <div class="row between"><b>${dlabel(cp.start)}〜${dlabel(cp.end)}</b>${cp.inProgress ? '<span class="pill wait">途中</span>' : ""}</div>
              <span class="small muted">${dlabel(cp.end)}時点の累計 · この時点の目安 <span class="num">${cp.expectedPct}</span>%</span>
              <ul class="cp-goals">${lines}</ul>
            </div>`;
          })
          .join("")}</div>`
      : `<p class="note">この月にかかる週がまだありません。「週の設定」で週を作ると、週の終わりごとの累計がここに並びます。</p>`;
    return `<div class="section"><h3>週末ごとの進み具合</h3>${body}</div>`;
  }

  // F-08 月の目標の登録・編集
  function goalsSection(rec) {
    const rows = rec.goals.map((g) => goalRow(g)).join("");
    return `<div class="section">
      <div class="row between"><h3>月の目標</h3><button type="button" class="btn ghost" data-act="add-goal">目標を追加</button></div>
      <div class="items">${rows}</div>
      <p class="small muted">「設立済み／未設立」のようなものは、目標量1・手で入力にして、済んだら1を入れてください。</p>
    </div>`;
  }

  function goalRow(g) {
    const k = esc(g.id);
    const armed = ui.armed === g.id;
    const manual = g.source === "manual";
    let entriesHtml = "";
    if (manual) {
      const range = P.monthRange(ui.month);
      const defDate = P.defaultDate(range, todayStr());
      const list = [...(g.entries || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
      const entryItems = list
        .map((e) => {
          const ek = esc(e.id);
          const eArmed = ui.armed === e.id;
          return `<li><span class="num">${dlabel(e.date)}</span><span class="num">${fmtNum(e.qty)}${esc(g.unit)}</span><span class="memo">${esc(e.memo)}</span>
            <button type="button" class="btn danger${eArmed ? " armed" : ""}" data-act="del-entry" data-goal="${k}" data-entry="${ek}">${eArmed ? "もう一度押すと削除" : "削除"}</button></li>`;
        })
        .join("");
      entriesHtml = `<div class="full stack">
        <div class="entry-form">
          <label class="f">日付<input id="entry-date-${k}" type="date" min="${range.start}" max="${range.end}" value="${esc(defDate)}"></label>
          <label class="f">量（${esc(g.unit) || "単位なし"}）<input id="entry-qty-${k}" type="number" min="0" step="any" inputmode="decimal"></label>
          <label class="f wide">メモ<input id="entry-memo-${k}" placeholder="例 ココナラ1件"></label>
          <button type="button" class="btn ghost" data-act="add-entry" data-goal="${k}">実績を追加</button>
        </div>
        <p class="small error">${esc(ui.entryMsg[g.id])}</p>
        ${entryItems ? `<ul class="entries">${entryItems}</ul>` : `<p class="small muted">まだ実績がありません。</p>`}
      </div>`;
    }
    return `<div class="goal">
      <label class="f wide">名前<input id="gname-${k}" data-act="goal" data-field="name" data-goal="${k}" value="${esc(g.name)}" placeholder="例 Threads"></label>
      <label class="f">単位<input id="gunit-${k}" data-act="goal" data-field="unit" data-goal="${k}" value="${esc(g.unit)}" placeholder="件"></label>
      <label class="f">目標量<input id="gtarget-${k}" type="number" min="0" step="any" data-act="goal" data-field="target" data-goal="${k}" value="${esc(g.target)}"></label>
      <label class="f">挑戦目標<input id="gstretch-${k}" type="number" min="0" step="any" data-act="goal" data-field="stretch" data-goal="${k}" value="${esc(g.stretch)}" placeholder="なし"></label>
      <label class="f">集め方<select id="gsource-${k}" data-act="goal" data-field="source" data-goal="${k}">
        <option value="weekly"${manual ? "" : " selected"}>週の項目から</option>
        <option value="manual"${manual ? " selected" : ""}>手で入力</option>
      </select></label>
      ${entriesHtml}
      <div class="foot"><span>${manual ? "日付・量・メモを1件ずつ入れます" : "同じ名前の週の項目の実績を合計します"}</span><button type="button" class="btn danger${armed ? " armed" : ""}" data-act="del-goal" data-goal="${k}">${armed ? "もう一度押すと削除" : "削除"}</button></div>
    </div>`;
  }

  // F-10 振り返りメモ
  function reviewSection(rec) {
    const r = rec.review || {};
    const field = (f, label, ph) =>
      `<label class="f">${label}<textarea id="review-${f}" data-act="review" data-field="${f}" placeholder="${ph}">${esc(r[f])}</textarea></label>`;
    return `<div class="section">
      <h3>振り返りメモ</h3>
      ${field("good", "良かった点", "例 投稿は毎日続けられた")}
      ${field("issues", "課題・改善点", "例 出品が後回しになった")}
      ${field("act", "Act（次にやること）", "例 出品を朝いちばんにやる")}
    </div>`;
  }

  // 削除ボタンの1回目。4秒たったら元に戻す
  function arm(id) {
    ui.armed = id;
    render();
    setTimeout(() => { if (ui.armed === id) { ui.armed = null; render(); } }, 4000);
  }

  function addEntry(goalId) {
    const rec = ensureMonth(ui.month);
    const g = rec.goals.find((x) => x.id === goalId);
    if (!g) return;
    const date = $(`#entry-date-${CSS.escape(goalId)}`).value;
    const qty = $(`#entry-qty-${CSS.escape(goalId)}`).value;
    const memo = $(`#entry-memo-${CSS.escape(goalId)}`).value.trim();
    const err = P.validateMonthEntry(date, qty, ui.month);
    if (err) {
      ui.entryMsg[goalId] = err;
      render();
      return;
    }
    g.entries = g.entries || [];
    g.entries.push({ id: uid("e"), date, qty: Number(qty), memo });
    ui.entryMsg[goalId] = "";
    persist();
    render();
  }

  // ---------- 操作 ----------
  function makePlan(w) {
    const input = $("#hours");
    const raw = input.value;
    const h = Number(raw);
    if (raw === "" || !Number.isFinite(h) || h <= 0 || h > 24) {
      ui.hoursMsg = "使える時間を 0.5〜24 の範囲で入れてください。";
      ui.hoursValue = raw;
      render();
      $("#hours").focus();
      return;
    }
    const hours = Math.round(h * 2) / 2; // 0.5刻みにそろえる
    const date = activeDate(w);
    const day = touchDay(w, date);
    const r = P.planDay(w, date, hours);
    Object.assign(day, { hours, plan: r.plan, skipped: r.skipped, log: day.log || {}, closed: !!day.closed });
    data.settings.lastHours = hours;
    ui.hoursMsg = "";
    ui.hoursValue = null;
    persist();
    render();
  }

  function createWeek(cur) {
    const s = $("#new-start").value;
    const en = $("#new-end").value;
    const err = P.validateWeekRange(s, en, data.weeks);
    if (err) {
      ui.createMsg = err;
      render();
      return;
    }
    const copy = $("#new-copy")?.checked && cur;
    const w = {
      id: uid("w"),
      start: s,
      end: en,
      offDays: [],
      items: copy ? items(cur).map((i) => ({ ...i, id: uid("i") })) : [],
      days: {},
    };
    data.weeks[w.id] = w;
    data.settings.currentWeek = w.id;
    ui.date = null;
    ui.createMsg = "";
    persist();
    render();
  }

  function startImport() {
    ui.dataMsg = null;
    S.pickFile().then((file) => {
      if (!file) return;
      return S.readImportFile(file).then((r) => {
        if (r.ok) ui.importPending = { data: r.data, name: file.name };
        else ui.dataMsg = { kind: "error", text: `読み込めませんでした（${r.error}）。今のデータはそのままです。` };
        render();
      });
    });
  }

  function confirmImport() {
    const pend = ui.importPending;
    if (!pend) return;
    data = pend.data;
    readOnly = false; // 本人が上書きを選んだので保存を再開する
    ui.importPending = null;
    ui.date = null;
    ui.armed = null;
    ui.dataMsg = { kind: "ok", text: `「${pend.name}」を読み込みました（週 ${Object.keys(data.weeks).length} 件）。` };
    persist();
    render();
  }

  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      ui.tab = tab.dataset.tab;
      render();
      return;
    }
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "INPUT" || el.tagName === "SELECT") return;
    const w = curWeek();
    const act = el.dataset.act;

    if (act === "dismiss-notice") { ui.notice = null; render(); return; }
    if (act === "goto-setup") { ui.tab = "setup"; render(); return; }
    if (act === "pick-date") { ui.date = el.dataset.date; ui.hoursMsg = ""; render(); return; }
    if (act === "create-week") return createWeek(w);
    if (act === "export") {
      S.exportToFile(data, todayStr());
      ui.dataMsg = { kind: "ok", text: `${S.exportFileName(todayStr())} を書き出しました。` };
      render();
      return;
    }
    if (act === "import") return startImport();
    if (act === "import-confirm") return confirmImport();
    if (act === "import-cancel") { ui.importPending = null; ui.dataMsg = { kind: "ok", text: "読み込みをやめました。今のデータはそのままです。" }; render(); return; }

    // 月タブ（週がなくても使える）
    if (act === "month-prev" || act === "month-next" || act === "month-today") {
      ui.month = act === "month-today" ? P.monthOf(todayStr()) : P.addMonths(ui.month, act === "month-prev" ? -1 : 1);
      ui.armed = null;
      ui.entryMsg = {};
      render();
      return;
    }
    if (act === "add-goal") {
      const g = { id: uid("g"), name: "", unit: "", target: 1, stretch: null, source: "weekly", entries: [] };
      ensureMonth(ui.month).goals.push(g);
      persist();
      render();
      document.getElementById("gname-" + g.id)?.focus();
      return;
    }
    if (act === "copy-prev-goals") {
      const prev = monthRec(P.addMonths(ui.month, -1));
      if (!(prev.goals || []).length) return;
      ensureMonth(ui.month).goals = P.copyMonthGoals(prev.goals, () => uid("g"));
      persist();
      render();
      return;
    }
    if (act === "del-goal") {
      const id = el.dataset.goal;
      if (ui.armed !== id) return arm(id);
      ui.armed = null;
      const rec = ensureMonth(ui.month);
      rec.goals = rec.goals.filter((g) => g.id !== id);
      persist();
      render();
      return;
    }
    if (act === "add-entry") return addEntry(el.dataset.goal);
    if (act === "del-entry") {
      const id = el.dataset.entry;
      if (ui.armed !== id) return arm(id);
      ui.armed = null;
      const g = ensureMonth(ui.month).goals.find((x) => x.id === el.dataset.goal);
      if (g) g.entries = (g.entries || []).filter((e) => e.id !== id);
      persist();
      render();
      return;
    }
    if (!w) return;

    if (act === "make-plan") {
      makePlan(w);
    } else if (act === "replan") {
      // 予定だけ消す（実績・締めは残す）
      const day = w.days?.[activeDate(w)];
      if (day) { delete day.plan; delete day.skipped; }
      persist();
      render();
      $("#hours")?.focus();
    } else if (act === "close-day") {
      const day = touchDay(w, activeDate(w));
      day.closed = !day.closed;
      persist();
      render();
    } else if (act === "toggle-off") {
      const d = el.dataset.date;
      w.offDays = offDays(w).includes(d) ? offDays(w).filter((x) => x !== d) : [...offDays(w), d];
      persist();
      render();
    } else if (act === "add-item") {
      const it = { id: uid("i"), name: "", unit: "件", target: 1, minutes: 30, priority: 3 };
      items(w).push(it);
      persist();
      render();
      document.getElementById("name-" + it.id)?.focus();
    } else if (act === "del-item") {
      const id = el.dataset.item;
      if (ui.armed !== id) {
        ui.armed = id;
        render();
        setTimeout(() => { if (ui.armed === id) { ui.armed = null; render(); } }, 4000);
        return;
      }
      ui.armed = null;
      w.items = items(w).filter((i) => i.id !== id);
      persist();
      render();
    } else if (act === "apply-avg") {
      const it = items(w).find((i) => i.id === el.dataset.item);
      const avg = it && P.avgMinutesPerUnit(data.weeks, it.name);
      if (avg != null) {
        it.minutes = Math.round(avg);
        persist();
        render();
      }
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const w = curWeek();
    const act = el.dataset.act;
    if (act === "select-week") {
      data.settings.currentWeek = el.value;
      ui.date = null;
      ui.weekMsg = "";
      persist();
      render();
      return;
    }
    if (act === "goal") {
      const g = ensureMonth(ui.month).goals.find((x) => x.id === el.dataset.goal);
      if (!g) return;
      const f = el.dataset.field;
      if (f === "target") g.target = Math.max(0, P.num(el.value));
      else if (f === "stretch") g.stretch = el.value === "" ? null : Math.max(0, P.num(el.value));
      else if (f === "source") g.source = el.value === "manual" ? "manual" : "weekly";
      else g[f] = el.value.trim();
      persist();
      scheduleRender();
      return;
    }
    if (!w) return;

    if (act === "item") {
      const it = items(w).find((i) => i.id === el.dataset.item);
      if (!it) return;
      const f = el.dataset.field;
      if (f === "priority") it.priority = Math.min(5, Math.max(1, Math.round(P.num(el.value)) || 1));
      else if (f === "target" || f === "minutes") it[f] = Math.max(0, P.num(el.value));
      else it[f] = el.value.trim();
      persist();
      scheduleRender();
    } else if (act === "log" || act === "toggle-done") {
      const day = touchDay(w, activeDate(w));
      day.log = day.log || {};
      const id = el.dataset.item;
      const l = (day.log[id] = day.log[id] || {});
      if (act === "toggle-done") {
        l.done = el.checked;
        // チェックを入れたとき、量と時間が空なら予定の値を入れる
        const p = (day.plan || []).find((x) => x.itemId === id);
        if (l.done && p) {
          if (l.qty == null || l.qty === "") l.qty = p.qty;
          if (l.min == null || l.min === "") l.min = p.min;
        }
      } else {
        l[el.dataset.field] = el.value === "" ? "" : Math.max(0, P.num(el.value));
      }
      if (!l.done && (l.qty === "" || l.qty == null) && (l.min === "" || l.min == null)) delete day.log[id];
      persist();
      scheduleRender();
    } else if (act === "week-date") {
      const f = el.dataset.field;
      const s = f === "start" ? el.value : w.start;
      const en = f === "end" ? el.value : w.end;
      const err = P.validateWeekRange(s, en, data.weeks, w.id);
      if (err) {
        ui.weekMsg = err + "（元の日付に戻しました）";
        scheduleRender();
        return;
      }
      w.start = s;
      w.end = en;
      // 期間の外になった休みの日・実績は消さない（計算では期間の中だけを使う）
      ui.weekMsg = "";
      ui.date = null;
      persist();
      scheduleRender();
    }
  });

  // 振り返りメモは入力するたびに保存する（描画し直さない）
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset?.act !== "review") return;
    ensureMonth(ui.month).review[el.dataset.field] = el.value;
    persist();
  });

  // 使える時間の欄で Enter を押したら予定を作る
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "hours") {
      const w = curWeek();
      if (w) makePlan(w);
    }
  });

  if (readOnly) setSave("err", "保存を止めています");
  else setSave("ok", loaded.error ? "空のデータで開始" : "保存済み");
  render();
})();
