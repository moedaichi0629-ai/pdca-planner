// 画面の描画とイベント処理。計算は Planner（src/planner.js）、文章の読み取りは PlannerParser（src/parser.js）、
// 保存は PlannerStorage（src/storage.js）だけを使う。
(function () {
  "use strict";

  const P = window.Planner;
  const S = window.PlannerStorage;
  const R = window.PlannerParser;

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
    weekDoneMsg: "", // 週を削除したあとに1回だけ出す
    hoursMsg: "",
    dataMsg: null, // { kind: "ok" | "error", text }
    importPending: null, // { data, name }
    hoursValue: null, // 検証で弾いた「使える時間」の入力をそのまま残す
    month: P.monthOf(todayStr()), // 月タブで表示する月（YYYY-MM）
    entryMsg: {}, // 目標 id → 手入力の実績を弾いた理由
    catMsg: "", // カテゴリーの名前・割合を弾いた理由
    // F-11 文章からまとめて登録。scope: "month"（月タブ）/ "week"（週の設定タブ）
    // text: 貼り付けた文章 / open: 折りたたみを開いているか / draft: 確認画面の中身 / readMsg: 読み取れなかった理由 / doneMsg: 登録後に1回だけ出す
    bulk: {
      month: { text: "", open: false, draft: null, readMsg: "", doneMsg: "" },
      week: { text: "", open: false, draft: null, readMsg: "", doneMsg: "" },
    },
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
  const cats = () => data.categories || (data.categories = []);

  // カテゴリーの選択欄。未選択は「その他」
  function categorySelect(attrs, value) {
    const cur = P.categoryOf({ categoryId: value }, cats());
    return `<select ${attrs}><option value=""${cur ? "" : " selected"}>その他（未選択）</option>${cats()
      .map((c) => `<option value="${esc(c.id)}"${c.id === cur ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("")}</select>`;
  }
  const categoryName = (id) => cats().find((c) => c.id === id)?.name || "その他";
  // カテゴリーの色（並び順で6色をくり返す）
  const colorClass = (index) => `c${((index % 6) + 6) % 6}`;
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
          <p class="muted small">この日に作業に使える時間を入れてください。毎日することを先に入れ、残りの時間を${cats().length ? "カテゴリーの割合で分けて、各カテゴリーの中で" : ""}優先度の高い順に並べます。ほかの項目の量は、週の残りの量を残りの日数で割って出します。</p>
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
      ${breakdownHtml(w, day)}
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

  // F-13 今日の内訳（毎日すること／カテゴリー／その他／余り）
  function breakdownHtml(w, day) {
    const b = P.dayBreakdown(day, items(w), cats());
    if (!b.total) return "";
    const planned = b.segments.filter((x) => x.planMin > 0);
    const scale = Math.max(b.total, planned.reduce((s, x) => s + x.planMin, 0));
    const cls = (x) => (x.kind === "category" ? colorClass(x.index) : x.kind);
    const bar = [...planned.map((x) => ({ cls: cls(x), min: x.planMin, name: x.name })), ...(b.free ? [{ cls: "free", min: b.free, name: "余り" }] : [])]
      .map((x) => `<i class="seg ${x.cls}" style="width:${((x.min / scale) * 100).toFixed(2)}%" title="${esc(x.name)} ${fmtMin(x.min)}"></i>`)
      .join("");
    const label = [...planned.map((x) => `${x.name} ${fmtMin(x.planMin)}`), `余り ${fmtMin(b.free)}`].join("、");
    const rows = b.segments
      .map((x) => {
        const budget = x.budget !== null && x.kind === "category" ? `<span class="muted">（割り当て ${fmtMin(x.budget)}）</span>` : "";
        const actual = b.hasActual ? `<span>→ 実際 <b>${fmtMin(x.actualMin)}</b></span>` : "";
        // 毎日することは、その中の項目も並べる
        const sub = (x.items || [])
          .map((d) => `<li><span class="bd-name">${esc(d.name) || "（削除した項目）"}${d.qty ? ` <span class="muted">${fmtNum(d.qty)}${esc(d.unit)}</span>` : ""}</span><span class="bd-val"><span>予定 <b>${fmtMin(d.planMin)}</b></span>${b.hasActual ? `<span>→ 実際 <b>${fmtMin(d.actualMin)}</b></span>` : ""}</span></li>`)
          .join("");
        return `<li><span class="sw ${cls(x)}"></span><span class="bd-name">${esc(x.name)}</span><span class="bd-val"><span>予定 <b>${fmtMin(x.planMin)}</b></span>${budget}${actual}</span>${sub ? `<ul class="bd-sub">${sub}</ul>` : ""}</li>`;
      })
      .join("");
    return `<div class="stack breakdown">
      <h3>今日の内訳</h3>
      <div class="stackbar" role="img" aria-label="${esc(label)}">${bar}</div>
      <ul class="bd-list">${rows}<li><span class="sw free"></span><span class="bd-name">余り</span><span class="bd-val"><b>${fmtMin(b.free)}</b></span></li></ul>
      ${b.dailyShort ? `<p class="warn-text">毎日することだけで時間が足りません。入らなかった分は下の「今日は入らなかった」に出しています。</p>` : ""}
    </div>`;
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
        ${ui.weekDoneMsg ? `<p class="small msg-ok">${esc(ui.weekDoneMsg)}</p>` : ""}
        <p class="muted">月や週のPDCAで決めた「週の目標」をここに登録します。まず期間を決めてください（最大${P.MAX_WEEK_DAYS}日）。</p>
        ${createForm}
        ${bulkSection("week")}
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
    const delArmed = ui.armed === "week:" + w.id;
    const deleteBox = `<div class="stack data-box">
        <h3>この週を削除</h3>
        <p class="small muted">${dlabel(w.start)}〜${dlabel(w.end)} の週の項目・予定・実績がすべて消えます。月の目標と、月で手入力した実績は残ります（週の項目から集めていた月の実績は、この週の分が減ります）。</p>
        <div class="row"><button type="button" class="btn danger${delArmed ? " armed" : ""}" data-act="del-week">${delArmed ? "もう一度押すと週を削除" : "この週を削除"}</button></div>
      </div>`;

    return `<div class="row between"><h2>週の設定</h2>${sel}</div>
      ${ui.weekDoneMsg ? `<p class="small msg-ok">${esc(ui.weekDoneMsg)}</p>` : ""}
      <div class="row">
        <label class="f">開始日<input id="w-start" type="date" data-act="week-date" data-field="start" value="${esc(w.start)}"></label>
        <label class="f">終了日<input id="w-end" type="date" data-act="week-date" data-field="end" value="${esc(w.end)}"></label>
      </div>
      <p class="small error">${esc(ui.weekMsg)}</p>
      <div class="stack"><h3>作業する日（押すと休みの日に切り替わります）</h3><div class="chips">${offChips}</div></div>
      ${categoriesSection()}
      <div class="stack">
        <div class="row between"><h3>週の目標</h3><button type="button" class="btn ghost" data-act="add-item">項目を追加</button></div>
        ${itemsHtml
          ? `<div class="items">${itemsHtml}</div>`
          : `<p class="note">まだ項目がありません。「項目を追加」から、やること・週の目標量・1回あたりの時間を登録してください。優先度1から順に、その日の時間に入れていきます。</p>`}
      </div>
      ${bulkSection("week")}
      ${deleteBox}
      <details${ui.createMsg ? " open" : ""}><summary>新しい週を作る</summary><div style="padding-top:10px">${createForm}</div></details>
      ${dataSection()}`;
  }

  // F-13 カテゴリーと時間の割合（全体で1つ）
  function categoriesSection() {
    const list = cats();
    const total = P.ratioTotal(list);
    const rows = list
      .map((c, i) => {
        const k = esc(c.id);
        const armed = ui.armed === "cat:" + c.id;
        return `<div class="cat-row">
          <span class="sw ${colorClass(i)}" aria-hidden="true"></span>
          <label class="f wide">名前<input id="cname-${k}" data-act="cat" data-field="name" data-cat="${k}" value="${esc(c.name)}"></label>
          <label class="f">割合（%）<input id="cratio-${k}" type="number" min="0" max="100" step="1" data-act="cat" data-field="ratio" data-cat="${k}" value="${esc(c.ratio)}"></label>
          <button type="button" class="btn danger end${armed ? " armed" : ""}" data-act="del-cat" data-cat="${k}">${armed ? "もう一度押すと削除" : "削除"}</button>
        </div>`;
      })
      .join("");
    let note = "";
    if (list.length && total === 0) note = `<p class="small warn-text">割合がすべて0%です。カテゴリーで分ける時間がないので、各カテゴリーの項目は余った時間だけで入れます。</p>`;
    else if (list.length && total !== 100) note = `<p class="small warn-text">合計 ${total}%（100%ではありません）。合計に対する比で分けます（例：${esc(list[0].name)}は ${Math.round((Math.max(0, P.num(list[0].ratio)) / total) * 100)}%として扱います）。</p>`;
    return `<div class="stack">
      <div class="row between"><h3>カテゴリー（時間の割合）</h3><button type="button" class="btn ghost" data-act="add-cat">カテゴリーを追加</button></div>
      ${list.length
        ? `<p class="small muted">予定を作るとき、毎日することを引いた残りの時間をこの割合で分けます。カテゴリーを選んでいない項目は「その他」として、カテゴリーで余った時間だけを使います。すべての週で共通です。</p>
           <div class="items">${rows}</div>
           <p class="small muted">合計 <span class="num">${total}</span>%</p>`
        : `<p class="note">カテゴリーがないときは、毎日することのあと、優先度の高い順に入れます。「ココナラ 50%・Threads 30%」のように時間の割合を決めると、その割合で予定を作ります。</p>`}
      ${note}
      <p class="small error">${esc(ui.catMsg)}</p>
    </div>`;
  }

  function itemRow(it) {
    const k = esc(it.id);
    const avg = P.avgMinutesPerUnit(data.weeks, it.name);
    const daily = !!it.daily;
    // 毎日やる項目は「今かかっている時間 = 平均 × 1日にやる量」に反映する
    const avgTarget = daily ? Math.round((avg ?? 0) * P.num(it.dailyQty)) : Math.round(avg ?? 0);
    const avgCur = daily ? P.num(it.dailyMin) : P.num(it.minutes);
    const avgHtml = avg != null
      ? `実績の平均 ${fmtMin(avg)}／${esc(it.unit || "回")}${avgTarget !== avgCur && (!daily || P.isDaily(it)) ? ` <button type="button" class="btn quiet" data-act="apply-avg" data-item="${k}">${daily ? `今かかっている時間に反映（${fmtMin(avgTarget)}）` : "標準時間に反映"}</button>` : ""}`
      : "実績が入ると、1回あたりの平均時間が出ます";
    const w = curWeek();
    const wd = w ? P.workdays(w).length : 0;
    const dailyFields = daily
      ? `<label class="f">1日にやる量<input id="dailyQty-${k}" type="number" min="0" step="any" data-act="item" data-field="dailyQty" data-item="${k}" value="${esc(it.dailyQty)}"></label>
        <label class="f">今かかっている時間(分)<input id="dailyMin-${k}" type="number" min="0" step="5" data-act="item" data-field="dailyMin" data-item="${k}" value="${esc(it.dailyMin)}"></label>
        <p class="small ${P.isDaily(it) ? "muted" : "warn-text"} full">${P.isDaily(it)
          ? `稼働日は毎日 ${fmtNum(it.dailyQty)}${esc(it.unit)}（${fmtMin(P.num(it.dailyMin))}）を先に入れます。週の目標量の目安：${fmtNum(it.dailyQty)} × 稼働日 ${wd}日 = ${fmtNum(P.num(it.dailyQty) * wd)}${esc(it.unit)}`
          : "1日にやる量を0より大きい数で入れてください。入れるまでは毎日やる項目として扱いません。"}</p>`
      : "";
    const armed = ui.armed === it.id;
    return `<div class="item">
      <label class="f wide">やること<input id="name-${k}" data-act="item" data-field="name" data-item="${k}" value="${esc(it.name)}" placeholder="例 ココナラ商品の出品"></label>
      <label class="f">週の目標量<input id="target-${k}" type="number" min="0" step="1" data-act="item" data-field="target" data-item="${k}" value="${esc(it.target)}"></label>
      <label class="f">単位<input id="unit-${k}" data-act="item" data-field="unit" data-item="${k}" value="${esc(it.unit)}" placeholder="件"></label>
      ${daily ? "" : `<label class="f">1回の時間(分)<input id="minutes-${k}" type="number" min="0" step="5" data-act="item" data-field="minutes" data-item="${k}" value="${esc(it.minutes)}"></label>`}
      <label class="f">優先度<select id="priority-${k}" data-act="item" data-field="priority" data-item="${k}">${[1, 2, 3, 4, 5]
        .map((p) => `<option value="${p}"${P.num(it.priority) === p ? " selected" : ""}>${p}${p === 1 ? "（最優先）" : ""}</option>`)
        .join("")}</select></label>
      <label class="f">カテゴリー${categorySelect(`id="category-${k}" data-act="item" data-field="categoryId" data-item="${k}"`, it.categoryId)}</label>
      <label class="row small daily-check"><input type="checkbox" id="daily-${k}" data-act="item" data-field="daily" data-item="${k}"${daily ? " checked" : ""}>毎日やる</label>
      ${dailyFields}
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
          ${canCopy ? `<p class="small muted">引き継ぐのは名前・単位・目標量・最低目標・挑戦目標・集め方だけです（${monthLabel(P.addMonths(m, -1))}の目標 ${prev.goals.length} 件）。</p>` : ""}
        </div>
        <div class="section">${bulkSection("month")}</div>
        ${reviewSection(rec)}`;
    }

    const pr = P.monthProgress(rec, data.weeks, t);
    const gm = Object.fromEntries(goals.map((g) => [g.id, g]));
    const rows = pr.goals
      .map((x) => {
        const g = gm[x.goalId];
        const unit = esc(g.unit);
        const stretch = x.stretch === null ? "" : ` · 挑戦 <span class="num">${fmtNum(x.stretch)}</span>${unit}（<span class="num">${x.stretchPct}</span>%）`;
        const minimum = x.minimum === null ? "" : ` · 最低 <span class="num">${fmtNum(x.minimum)}</span>${unit}（<span class="num">${x.minimumPct}</span>%）`;
        let warn = "";
        if (!g.name) warn = `<span class="warn-text">名前を入れてください。</span>`;
        else if (!x.linked) warn = `<span class="warn-text">この月の週に「${esc(g.name)}」という項目がありません。週の設定の項目名と同じ名前にすると実績を集めます。</span>`;
        return `<div class="prog">
          <div class="row between"><span class="title">${esc(g.name) || "（名前なし）"}${P.categoryOf(g, cats()) ? ` <span class="small muted">${esc(categoryName(g.categoryId))}</span>` : ""}</span><span class="pill ${x.status.k}">${x.status.label}</span></div>
          <div class="bar" role="img" aria-label="達成率${x.pct}%"><i style="width:${Math.min(100, x.pct)}%"></i>${pr.elapsed ? `<u style="left:calc(${pr.expectedPct}% - 1px)"></u>` : ""}</div>
          <div class="small muted"><span class="num">${fmtNum(x.actual)}/${fmtNum(x.target)}</span>${unit}（<span class="num">${x.pct}</span>%）${minimum}${stretch}</div>
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
      <div class="section">${bulkSection("month")}</div>
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
      <label class="f">最低目標<input id="gminimum-${k}" type="number" min="0" step="any" data-act="goal" data-field="minimum" data-goal="${k}" value="${esc(g.minimum)}" placeholder="なし"></label>
      <label class="f">挑戦目標<input id="gstretch-${k}" type="number" min="0" step="any" data-act="goal" data-field="stretch" data-goal="${k}" value="${esc(g.stretch)}" placeholder="なし"></label>
      <label class="f">集め方<select id="gsource-${k}" data-act="goal" data-field="source" data-goal="${k}">
        <option value="weekly"${manual ? "" : " selected"}>週の項目から</option>
        <option value="manual"${manual ? " selected" : ""}>手で入力</option>
      </select></label>
      <label class="f">カテゴリー${categorySelect(`id="gcategory-${k}" data-act="goal" data-field="categoryId" data-goal="${k}"`, g.categoryId)}</label>
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

  // ---------- F-11 文章からまとめて登録（月タブ・週の設定タブ） ----------
  const BULK_EXAMPLE = {
    month: "例\n💰 11月 収益化PDCA\n【Plan】\n・売上：30,000円以上\n→ 最低目標：10,000円\n→ 挑戦目標：50,000円\n・ココナラ受注：2件以上",
    week: "例\n📅 11/2〜11/8 第2週PDCA\n【Plan】\n・Threads（AI・業務自動化）：21投稿\n・ココナラ新商品出品：1商品",
  };

  function bulkSection(scope) {
    const b = ui.bulk[scope];
    const done = b.doneMsg ? `<p class="small msg-ok">${esc(b.doneMsg)}</p>` : "";
    return `<details class="bulk" data-scope="${scope}"${b.open || b.draft || b.doneMsg ? " open" : ""}>
      <summary>文章からまとめて登録</summary>
      <div class="stack bulk-body">
        ${done}
        <p class="small muted">${scope === "month" ? "月" : "週"}のPDCAの文章を貼り付けて「読み取る」を押してください。【Plan】の部分だけを読みます（全文を貼っても大丈夫です）。登録する前に1行ずつ直せます。</p>
        <textarea id="bulk-text-${scope}" class="bulk-text" data-act="bulk-text" data-scope="${scope}" placeholder="${esc(BULK_EXAMPLE[scope])}">${esc(b.text)}</textarea>
        <div class="row"><button type="button" class="btn${b.draft ? " ghost" : ""}" data-act="bulk-read" data-scope="${scope}">${b.draft ? "読み取り直す" : "読み取る"}</button></div>
        <p class="small error">${esc(b.readMsg)}</p>
        ${b.draft ? bulkConfirm(scope, b.draft) : ""}
      </div>
    </details>`;
  }

  // 確認画面。登録先・扱い・1行ずつの値
  function bulkConfirm(scope, d) {
    const isMonth = scope === "month";
    let period;
    let removed = [];
    const names = d.rows.filter((r) => r.include).map((r) => ({ name: String(r.name).trim() }));
    if (isMonth) {
      const valid = /^\d{4}-\d{2}$/.test(d.month);
      period = `<label class="f">登録する月<input id="bulk-month" type="month" data-act="bulk-period" data-scope="month" data-field="month" value="${esc(d.month)}"></label>
        <p class="small ${valid ? "muted" : "error"}">${valid ? `${monthLabel(d.month)}の目標に登録します。` : "月を入れてください。"}</p>`;
      if (valid && d.mode === "replace") removed = P.mergeMonthGoals(monthRec(d.month).goals, names, "replace", () => "").removed;
    } else {
      const existing = P.findWeekByRange(data.weeks, d.start, d.end);
      const err = existing ? null : P.validateWeekRange(d.start, d.end, data.weeks);
      const status = existing
        ? `<p class="small muted">今ある週（${dlabel(existing.start)}〜${dlabel(existing.end)}）に登録します。</p>`
        : err
          ? `<p class="small error">${esc(err)}</p>`
          : `<p class="small muted">新しい週（${dlabel(d.start)}〜${dlabel(d.end)}）を作って登録します。休みの日はあとで「作業する日」で選べます。</p>`;
      period = `<div class="row">
          <label class="f">開始日<input id="bulk-start" type="date" data-act="bulk-period" data-scope="week" data-field="start" value="${esc(d.start)}"></label>
          <label class="f">終了日<input id="bulk-end" type="date" data-act="bulk-period" data-scope="week" data-field="end" value="${esc(d.end)}"></label>
        </div>${status}`;
      if (existing && d.mode === "replace") removed = P.mergeWeekItems(existing, names, "replace", () => "").removed;
    }
    const word = isMonth ? "目標" : "項目";
    const modes = [
      ["merge", "同じ名前は上書きし、ない名前は追加する"],
      ["replace", `今の${word}をすべて置き換える`],
    ]
      .map(([v, label]) => `<label class="row small"><input type="radio" id="bulk-mode-${scope}-${v}" name="bulk-mode-${scope}" data-act="bulk-mode" data-scope="${scope}" value="${v}"${d.mode === v ? " checked" : ""}>${label}</label>`)
      .join("");
    const removedHtml = removed.length
      ? `<p class="small warn-text">置き換えると消える${word}：${removed.map((x) => esc(x.name || "（名前なし）") + (x.hasRecord ? "（実績あり）" : "")).join("、")}${
          removed.some((x) => x.hasRecord) ? (isMonth ? "。「実績あり」は手で入れた実績も消えます。" : "。「実績あり」はその項目の実績も見えなくなります。") : ""
        }</p>`
      : "";
    const rows = d.rows.map((r, i) => bulkRow(scope, r, i)).join("");
    const skipped = d.skipped.length
      ? `<details class="bulk-skipped"><summary>読まなかった行（${d.skipped.length}行）</summary><ul>${d.skipped.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>`
      : "";
    const count = d.rows.filter((r) => r.include).length;
    return `<div class="stack bulk-confirm">
      <h3>読み取った結果（${d.rows.length}行・登録する ${count}行）</h3>
      ${d.periodNote ? `<p class="small warn-text">${esc(d.periodNote)}</p>` : ""}
      ${period}
      <div class="stack bulk-modes"><span class="small muted">今の${word}の扱い</span>${modes}${removedHtml}</div>
      <div class="items">${rows}</div>
      ${skipped}
      <p class="small error">${esc(d.msg)}</p>
      <div class="row">
        <button type="button" class="btn" data-act="bulk-apply" data-scope="${scope}">登録する</button>
        <button type="button" class="btn quiet" data-act="bulk-cancel" data-scope="${scope}">やめる</button>
      </div>
    </div>`;
  }

  function bulkRow(scope, r, i) {
    const attrs = (f) => `id="bulk-${scope}-${i}-${f}" data-act="bulk-row" data-scope="${scope}" data-idx="${i}" data-field="${f}"`;
    const numField = (f, label, ph = "") =>
      `<label class="f">${label}<input type="number" min="0" step="any" ${attrs(f)} value="${esc(r[f])}"${ph ? ` placeholder="${ph}"` : ""}></label>`;
    const extra = scope === "month"
      ? `${numField("minimum", "最低目標", "なし")}${numField("stretch", "挑戦目標", "なし")}
        <label class="f">集め方<select ${attrs("source")}>
          <option value="weekly"${r.source === "manual" ? "" : " selected"}>週の項目から</option>
          <option value="manual"${r.source === "manual" ? " selected" : ""}>手で入力</option>
        </select></label>
        <label class="f">カテゴリー${categorySelect(attrs("categoryId"), r.categoryId)}</label>`
      : `${r.daily ? "" : numField("minutes", "1回の時間(分)")}
        <label class="f">優先度<select ${attrs("priority")}>${[1, 2, 3, 4, 5]
          .map((p) => `<option value="${p}"${P.num(r.priority) === p ? " selected" : ""}>${p}${p === 1 ? "（最優先）" : ""}</option>`)
          .join("")}</select></label>
        <label class="f">カテゴリー${categorySelect(attrs("categoryId"), r.categoryId)}</label>
        <label class="row small daily-check"><input type="checkbox" ${attrs("daily")}${r.daily ? " checked" : ""}>毎日やる</label>
        ${r.daily ? `${numField("dailyQty", "1日にやる量")}${numField("dailyMin", "今かかっている時間(分)")}` : ""}`;
    return `<div class="bulk-row${r.include ? "" : " skip-row"}">
      <label class="row small bulk-check"><input type="checkbox" ${attrs("include")}${r.include ? " checked" : ""}>登録する</label>
      <label class="f wide">名前<input ${attrs("name")} value="${esc(r.name)}"></label>
      ${numField("target", "目標量")}
      <label class="f">単位<input ${attrs("unit")} value="${esc(r.unit)}"></label>
      ${extra}
      <div class="foot"><span class="bulk-line">元の行：${esc(r.line)}</span>${r.error ? `<span class="warn-text">${esc(r.error)}</span>` : ""}</div>
    </div>`;
  }

  // 「読み取る」。文章を読み、確認画面の初期値を作る（まだ保存しない）
  function bulkRead(scope) {
    const b = ui.bulk[scope];
    b.text = $(`#bulk-text-${scope}`)?.value ?? b.text;
    b.doneMsg = "";
    const t = todayStr();
    const r = R.parsePdcaText(b.text, t);
    if (!r.rows.length) {
      b.draft = null;
      b.readMsg = "「・」で始まる目標の行が見つかりませんでした。「・名前：内容」の形の行を貼り付けてください。";
      render();
      return;
    }
    b.readMsg = "";
    const opt = (v) => (v === null || v === undefined ? "" : v);
    const base = (x) => ({ include: x.include, name: x.name, target: opt(x.target), unit: x.unit, error: x.error, line: x.line });
    if (scope === "month") {
      const ok = r.period?.kind === "month";
      const month = ok ? r.period.month : ui.month;
      const goals = monthRec(month).goals || [];
      b.draft = {
        mode: "merge",
        month,
        periodNote: ok ? "" : `見出しから月を読み取れなかったため、表示している${monthLabel(month)}にしています。`,
        // 最低・挑戦は文章の値（なければ空）。集め方は今の目標 → 週の項目 → 手で入力の順に決める
        rows: r.rows.map((x) => ({
          ...base(x),
          minimum: opt(x.minimum),
          stretch: opt(x.stretch),
          source: P.goalSourceDefault(data.weeks, month, x.name, goals),
          categoryId: P.goalCategoryDefault(x.name, goals, cats()),
        })),
        skipped: r.skipped,
        msg: "",
      };
    } else {
      const ok = r.period?.kind === "week";
      const cur = curWeek();
      const start = ok ? r.period.start : cur?.start || "";
      const end = ok ? r.period.end : cur?.end || "";
      const existing = P.findWeekByRange(data.weeks, start, end);
      b.draft = {
        mode: "merge",
        start,
        end,
        periodNote: ok ? "" : cur ? "見出しから週の期間を読み取れなかったため、今表示している週にしています。" : "見出しから週の期間を読み取れませんでした。開始日と終了日を入れてください。",
        // 最低目標・挑戦目標は週の項目では使わない
        // カテゴリー・毎日やるは、登録先の週 → 前の週の同じ名前の項目 → 名前に入っているカテゴリー名の順に決める
        rows: r.rows.map((x) => ({ ...base(x), ...P.itemDefaults(data.weeks, x.name, start || t, existing?.items, cats()) })),
        skipped: r.skipped,
        msg: "",
      };
    }
    render();
  }

  // 「登録する」。確認画面の値をすべて書いて保存する
  function bulkApply(scope) {
    const b = ui.bulk[scope];
    const d = b.draft;
    if (!d) return;
    const fail = (msg) => {
      d.msg = msg;
      render();
    };
    const norm = P.normalizeImportRows(d.rows, scope, cats());
    if (!norm.ok) return fail(norm.error);
    const summary = (res) => `追加 ${res.added}件・上書き ${res.updated}件${res.removed.length ? `・削除 ${res.removed.length}件` : ""}`;
    if (scope === "month") {
      if (!/^\d{4}-\d{2}$/.test(d.month)) return fail("登録する月を入れてください。");
      const rec = ensureMonth(d.month);
      const res = P.mergeMonthGoals(rec.goals, norm.rows, d.mode, () => uid("g"));
      rec.goals = res.goals;
      ui.month = d.month;
      b.doneMsg = `${monthLabel(d.month)}の目標を登録しました（${summary(res)}）。`;
    } else {
      let w = P.findWeekByRange(data.weeks, d.start, d.end);
      if (!w) {
        const err = P.validateWeekRange(d.start, d.end, data.weeks);
        if (err) return fail(err);
        w = { id: uid("w"), start: d.start, end: d.end, offDays: [], items: [], days: {} };
        data.weeks[w.id] = w;
      }
      const res = P.mergeWeekItems(w, norm.rows, d.mode, () => uid("i"));
      w.items = res.items;
      data.settings.currentWeek = w.id;
      ui.date = null;
      ui.weekMsg = "";
      b.doneMsg = `${dlabel(w.start)}〜${dlabel(w.end)} の週の項目を登録しました（${summary(res)}）。`;
    }
    b.draft = null;
    b.text = "";
    ui.armed = null;
    persist();
    render();
    b.doneMsg = ""; // 1回だけ出す
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
    const r = P.planDay(w, date, hours, cats());
    Object.assign(day, { hours, plan: r.plan, skipped: r.skipped, alloc: r.alloc, log: day.log || {}, closed: !!day.closed });
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
    if (act === "bulk-read") return bulkRead(el.dataset.scope);
    if (act === "bulk-apply") return bulkApply(el.dataset.scope);
    if (act === "bulk-cancel") { ui.bulk[el.dataset.scope].draft = null; render(); return; }
    if (act === "import-cancel") { ui.importPending = null; ui.dataMsg = { kind: "ok", text: "読み込みをやめました。今のデータはそのままです。" }; render(); return; }

    // 月タブ（週がなくても使える）
    if (act === "month-prev" || act === "month-next" || act === "month-today") {
      ui.month = act === "month-today" ? P.monthOf(todayStr()) : P.addMonths(ui.month, act === "month-prev" ? -1 : 1);
      ui.armed = null;
      ui.entryMsg = {};
      render();
      return;
    }
    if (act === "add-cat") {
      const base = "新しいカテゴリー";
      let name = base;
      for (let n = 2; cats().some((c) => c.name === name); n++) name = `${base}${n}`;
      const c = { id: uid("c"), name, ratio: 0 };
      cats().push(c);
      ui.catMsg = "";
      persist();
      render();
      document.getElementById("cname-" + c.id)?.select();
      return;
    }
    if (act === "del-cat") {
      const id = el.dataset.cat;
      if (ui.armed !== "cat:" + id) return arm("cat:" + id);
      ui.armed = null;
      const name = categoryName(id);
      let n = 0;
      // そのカテゴリーの項目・目標は「その他」に戻す（過去の予定の内訳は「その他」として数える）
      for (const w of Object.values(data.weeks)) for (const it of w.items || []) if (it.categoryId === id) { it.categoryId = null; n++; }
      for (const m of Object.values(data.months || {})) for (const g of m.goals || []) if (g.categoryId === id) { g.categoryId = null; n++; }
      data.categories = cats().filter((c) => c.id !== id);
      ui.catMsg = "";
      ui.weekDoneMsg = `カテゴリー「${name}」を削除しました${n ? `（項目・目標 ${n}件を「その他」にしました）` : ""}。`;
      persist();
      render();
      ui.weekDoneMsg = "";
      return;
    }
    if (act === "add-goal") {
      const g = { id: uid("g"), name: "", unit: "", target: 1, minimum: null, stretch: null, source: "weekly", categoryId: null, entries: [] };
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
      if (day) { delete day.plan; delete day.skipped; delete day.alloc; }
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
      const it = { id: uid("i"), name: "", unit: "件", target: 1, minutes: 30, priority: 3, categoryId: null, daily: false, dailyQty: null, dailyMin: null };
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
    } else if (act === "del-week") {
      const key = "week:" + w.id;
      if (ui.armed !== key) return arm(key);
      ui.armed = null;
      const label = `${dlabel(w.start)}〜${dlabel(w.end)}`;
      // 週だけを消す。月（data.months）には触らない
      delete data.weeks[w.id];
      // 残りの週から、今日を含む週かいちばん新しい週を選ぶ（curWeek の選び方）
      delete data.settings.currentWeek;
      const next = curWeek();
      if (next) data.settings.currentWeek = next.id;
      ui.date = null;
      ui.weekMsg = "";
      ui.weekDoneMsg = next
        ? `${label} の週を削除しました。${dlabel(next.start)}〜${dlabel(next.end)} の週を表示しています。`
        : `${label} の週を削除しました。`;
      persist();
      render();
      ui.weekDoneMsg = "";
    } else if (act === "apply-avg") {
      const it = items(w).find((i) => i.id === el.dataset.item);
      const avg = it && P.avgMinutesPerUnit(data.weeks, it.name);
      if (avg != null) {
        if (it.daily) it.dailyMin = Math.round(avg * P.num(it.dailyQty));
        else it.minutes = Math.round(avg);
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
    if (act === "bulk-row" || act === "bulk-period" || act === "bulk-mode") {
      const d = ui.bulk[el.dataset.scope]?.draft;
      if (!d) return;
      if (act === "bulk-mode") d.mode = el.value === "replace" ? "replace" : "merge";
      else if (act === "bulk-period") d[el.dataset.field] = el.value;
      else {
        const row = d.rows[Number(el.dataset.idx)];
        if (!row) return;
        const f = el.dataset.field;
        row[f] = f === "include" || f === "daily" ? el.checked : el.value;
        if (f === "daily" && row.daily) {
          // 初めて印を付けたときは、1日1単位・1回の時間を初期値にする
          if (row.dailyQty === null || row.dailyQty === undefined || row.dailyQty === "") row.dailyQty = 1;
          if (row.dailyMin === null || row.dailyMin === undefined || row.dailyMin === "") row.dailyMin = P.num(row.minutes) * P.num(row.dailyQty);
        }
      }
      d.msg = "";
      scheduleRender();
      return;
    }
    if (act === "cat") {
      const c = cats().find((x) => x.id === el.dataset.cat);
      if (!c) return;
      const f = el.dataset.field;
      const name = f === "name" ? el.value.trim() : c.name;
      const ratio = f === "ratio" ? el.value : c.ratio;
      const err = P.validateCategory(name, ratio, cats(), c.id);
      if (err) {
        ui.catMsg = err + "（元に戻しました）";
        scheduleRender();
        return;
      }
      c.name = name;
      c.ratio = Number(ratio);
      ui.catMsg = "";
      persist();
      scheduleRender();
      return;
    }
    if (act === "goal") {
      const g = ensureMonth(ui.month).goals.find((x) => x.id === el.dataset.goal);
      if (!g) return;
      const f = el.dataset.field;
      if (f === "target") g.target = Math.max(0, P.num(el.value));
      else if (f === "stretch" || f === "minimum") g[f] = el.value === "" ? null : Math.max(0, P.num(el.value));
      else if (f === "source") g.source = el.value === "manual" ? "manual" : "weekly";
      else if (f === "categoryId") g.categoryId = P.categoryOf({ categoryId: el.value }, cats());
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
      else if (f === "dailyQty" || f === "dailyMin") it[f] = el.value === "" ? null : Math.max(0, P.num(el.value));
      else if (f === "categoryId") it.categoryId = P.categoryOf({ categoryId: el.value }, cats());
      else if (f === "daily") {
        it.daily = el.checked;
        // 初めて印を付けたときは、1日1単位・1回の時間を初期値にする
        if (it.daily && (it.dailyQty == null || it.dailyQty === "")) it.dailyQty = 1;
        if (it.daily && (it.dailyMin == null || it.dailyMin === "")) it.dailyMin = P.num(it.minutes) * P.num(it.dailyQty);
      }
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
    // 貼り付けた文章は描画し直しても消えないように覚えておく（保存はしない）
    if (el.dataset?.act === "bulk-text") {
      ui.bulk[el.dataset.scope].text = el.value;
      return;
    }
    if (el.dataset?.act !== "review") return;
    ensureMonth(ui.month).review[el.dataset.field] = el.value;
    persist();
  });

  // 「文章からまとめて登録」の開け閉めを覚えておく（toggle は伝わらないので capture で拾う）
  document.addEventListener("toggle", (e) => {
    const el = e.target;
    if (el.classList?.contains("bulk") && ui.bulk[el.dataset.scope]) ui.bulk[el.dataset.scope].open = el.open;
  }, true);

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
