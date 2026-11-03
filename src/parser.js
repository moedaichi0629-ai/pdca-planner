// PDCA の文章の読み取り（純粋関数のみ。DOM・localStorage に触らない）
// 読み取りのルールは docs/requirements.md の「F-11」と「4.6」が正。
(function () {
  "use strict";

  const pad = (v) => String(v).padStart(2, "0");

  // 全角の数字・コロン・記号を半角にそろえる
  function normalize(s) {
    return String(s)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[：]/g, ":")
      .replace(/[，]/g, ",")
      .replace(/[．]/g, ".")
      .replace(/[／]/g, "/");
  }

  const PLAN_RE = /^【\s*plan\s*】/i;
  const SECTION_RE = /^【.*】/;
  const RULE_RE = /^[━─—\-=＝_]+$/; // 罫線だけの行
  const BULLET_RE = /^[・･•]\s*/;
  const ARROW_RE = /^(?:→|->|⇒)\s*/;
  const NUM_RE = /\d[\d,]*(?:\.\d+)?/;
  const WEEK_RE = /(\d{1,2})\/(\d{1,2})\s*[〜～~\-－]\s*(\d{1,2})\/(\d{1,2})/;
  const MONTH_RE = /(\d{1,2})月/;
  const UNIT_MAX = 8;
  const UNREADABLE = "数値が読み取れません";

  // 今日にいちばん近い年（月の差が前後6か月以内）。ちょうど6か月のときは前の年を選ぶ
  function nearestYear(month, today) {
    const ty = Number(today.slice(0, 4));
    const tm = Number(today.slice(5, 7));
    let best = ty;
    let bestDiff = Infinity;
    for (const y of [ty - 1, ty, ty + 1]) {
      const diff = Math.abs(y * 12 + month - (ty * 12 + tm));
      if (diff < bestDiff) {
        best = y;
        bestDiff = diff;
      }
    }
    return best;
  }

  // 実在する日付なら YYYY-MM-DD、そうでなければ null
  function makeDate(y, m, d) {
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  // 見出しの1行から期間を読む。読めなければ null
  function parsePeriod(line, today) {
    const s = normalize(line);
    const w = s.match(WEEK_RE);
    if (w) {
      const [sm, sd, em, ed] = w.slice(1).map(Number);
      const sy = nearestYear(sm, today);
      const ey = em < sm ? sy + 1 : sy; // 年をまたぐ週（12/28〜1/3）
      const start = makeDate(sy, sm, sd);
      const end = makeDate(ey, em, ed);
      return start && end ? { kind: "week", start, end } : null;
    }
    const m = s.match(MONTH_RE);
    if (m) {
      const mo = Number(m[1]);
      if (mo < 1 || mo > 12) return null;
      return { kind: "month", month: `${nearestYear(mo, today)}-${pad(mo)}` };
    }
    return null;
  }

  const toNumber = (s) => Number(s.replace(/,/g, ""));

  // 「・名前：内容」の行を1つの目標にする
  function parseGoalLine(line) {
    const body = normalize(line).replace(BULLET_RE, "").trim();
    const base = { name: body, target: null, unit: "", minimum: null, stretch: null, include: false, error: UNREADABLE, line };
    const colon = body.indexOf(":");
    if (colon < 0) return { ...base, error: `${UNREADABLE}（「名前：内容」の形ではありません）` };
    const name = body.slice(0, colon).trim();
    const content = body.slice(colon + 1).trim();
    const m = content.match(NUM_RE);
    if (!m) return { ...base, name };
    const prefix = content.slice(0, m.index).trim();
    const unit = content.slice(m.index + m[0].length).trim().replace(/\s*以上$/, "");
    if (unit.length > UNIT_MAX || /[、。,!?！？\s]/.test(unit)) return { ...base, name };
    let fullName = name;
    if (prefix.startsWith("各")) fullName = `${name}（${prefix}）`;
    else if (prefix) fullName = name + prefix;
    return { ...base, name: fullName, target: toNumber(m[0]), unit, include: true, error: null };
  }

  // 「→ 最低目標：」「→ 挑戦目標：」の行。違う形なら null
  function parseSubLine(line) {
    const body = normalize(line).replace(ARROW_RE, "").trim();
    const m = body.match(/^(最低目標|挑戦目標)\s*:\s*(.*)$/);
    if (!m) return null;
    const n = m[2].match(NUM_RE);
    return { field: m[1] === "最低目標" ? "minimum" : "stretch", value: n ? toNumber(n[0]) : null };
  }

  const isBlank = (t) => t === "" || RULE_RE.test(t);

  // 文章全体を読む。today は YYYY-MM-DD（年を決めるのに使う）
  // 戻り値: { period, rows, skipped }
  function parsePdcaText(text, today) {
    const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim());
    const planAt = lines.findIndex((l) => PLAN_RE.test(l));
    let head;
    let body;
    if (planAt >= 0) {
      head = lines.slice(0, planAt);
      body = [];
      for (const l of lines.slice(planAt + 1)) {
        if (SECTION_RE.test(l)) break; // 【Do】【Check】などの次の見出しで読むのをやめる
        body.push(l);
      }
    } else {
      body = lines.filter((l) => !SECTION_RE.test(l));
      head = body;
    }

    let period = null;
    let headLine = null;
    for (const l of head) {
      if (isBlank(l) || BULLET_RE.test(l) || ARROW_RE.test(l)) continue;
      period = parsePeriod(l, today);
      if (period) {
        headLine = l;
        break;
      }
    }

    const rows = [];
    const skipped = [];
    for (const l of body) {
      if (isBlank(l) || l === headLine) continue;
      if (BULLET_RE.test(l)) {
        rows.push(parseGoalLine(l));
        continue;
      }
      if (ARROW_RE.test(l)) {
        const sub = parseSubLine(l);
        const prev = rows[rows.length - 1];
        if (sub && prev && sub.value !== null) {
          prev[sub.field] = sub.value;
          continue;
        }
      }
      skipped.push(l);
    }
    return { period, rows, skipped };
  }

  const Parser = { normalize, nearestYear, parsePeriod, parseGoalLine, parsePdcaText, UNREADABLE };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Parser;
  } else {
    window.PlannerParser = Parser;
  }
})();
