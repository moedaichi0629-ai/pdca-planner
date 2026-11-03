// localStorage の読み書き、JSON 書き出し・読み込み（データの形は docs/requirements.md「5. データ設計」）
// 保存先は引数 storage で差し替えられる（省略時は localStorage）。Node のテストでは偽の storage を渡す。
(function () {
  "use strict";

  const KEY = "pdca-planner";
  const SCHEMA_VERSION = 4;

  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  function defaultStorage() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (e) {
      return null; // 設定によっては localStorage に触っただけで例外になる
    }
  }

  function emptyData() {
    return { schemaVersion: SCHEMA_VERSION, settings: {}, categories: [], weeks: {}, months: {} };
  }

  // 古い形のデータを今の形にする。既存の週・設定は消さない。
  // 戻り値: { ok: true, data } / { ok: false, error }
  function migrate(raw) {
    if (!isObject(raw)) return { ok: false, error: "データの形が正しくありません" };
    const version = raw.schemaVersion === undefined ? 0 : raw.schemaVersion;
    if (!Number.isInteger(version) || version < 0) {
      return { ok: false, error: "schemaVersion が正しくありません" };
    }
    if (version > SCHEMA_VERSION) {
      return { ok: false, error: `新しい版のデータです（schemaVersion ${version}）。ツールを更新してください` };
    }
    const data = { ...raw };
    // v0: 試作版（schemaVersion なしの { weeks, settings }）→ v1
    if (version < 1) data.schemaVersion = 1;
    // v1 → v2: 月（months）を足す。週・設定はそのまま
    if (data.schemaVersion < 2) {
      if (data.months === undefined) data.months = {};
      data.schemaVersion = 2;
    }
    // v2 → v3: 月の目標に最低目標（minimum）を足す。空なら null。ほかの値はそのまま
    if (data.schemaVersion < 3) {
      if (isObject(data.months)) {
        data.months = Object.fromEntries(
          Object.entries(data.months).map(([key, m]) => [
            key,
            isObject(m) && Array.isArray(m.goals)
              ? { ...m, goals: m.goals.map((g) => (isObject(g) && g.minimum === undefined ? { ...g, minimum: null } : g)) }
              : m,
          ])
        );
      }
      data.schemaVersion = 3;
    }
    // v3 → v4: カテゴリー（categories）を足す。週の項目は「カテゴリーなし・毎日やるなし」、月の目標は「カテゴリーなし」にする
    if (data.schemaVersion < 4) {
      if (data.categories === undefined) data.categories = [];
      if (isObject(data.weeks)) {
        data.weeks = Object.fromEntries(
          Object.entries(data.weeks).map(([id, w]) => [
            id,
            isObject(w) && Array.isArray(w.items)
              ? { ...w, items: w.items.map((it) => (isObject(it) ? { categoryId: null, daily: false, dailyQty: null, dailyMin: null, ...it } : it)) }
              : w,
          ])
        );
      }
      if (isObject(data.months)) {
        data.months = Object.fromEntries(
          Object.entries(data.months).map(([key, m]) => [
            key,
            isObject(m) && Array.isArray(m.goals) ? { ...m, goals: m.goals.map((g) => (isObject(g) ? { categoryId: null, ...g } : g)) } : m,
          ])
        );
      }
      data.schemaVersion = 4;
    }
    // 今後の形の変更はここに if (data.schemaVersion < 5) { ... } と足していく

    if (data.settings === undefined) data.settings = {};
    if (data.weeks === undefined) data.weeks = {};
    if (data.months === undefined) data.months = {};
    if (data.categories === undefined) data.categories = [];
    const error = validate(data);
    return error ? { ok: false, error } : { ok: true, data };
  }

  // 最低限の形の確認。問題があれば理由の文字列、なければ null
  function validate(data) {
    if (!isObject(data.settings)) return "settings の形が正しくありません";
    if (!isObject(data.weeks)) return "weeks の形が正しくありません";
    if (!Array.isArray(data.categories)) return "categories の形が正しくありません";
    for (const c of data.categories) {
      if (!isObject(c) || typeof c.id !== "string") return "カテゴリーの形が正しくありません";
    }
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (const [id, w] of Object.entries(data.weeks)) {
      if (!isObject(w)) return `週 ${id} の形が正しくありません`;
      if (!dateRe.test(w.start) || !dateRe.test(w.end)) return `週 ${id} の開始日・終了日が正しくありません`;
      if (w.items !== undefined && !Array.isArray(w.items)) return `週 ${id} の items の形が正しくありません`;
      for (const it of w.items || []) {
        if (isObject(it) && it.weekdays !== undefined && !Array.isArray(it.weekdays)) return `週 ${id} の項目「${it.name ?? ""}」の weekdays の形が正しくありません`;
      }
      if (w.days !== undefined && !isObject(w.days)) return `週 ${id} の days の形が正しくありません`;
      for (const [d, day] of Object.entries(w.days || {})) {
        if (isObject(day) && day.extras !== undefined && !Array.isArray(day.extras)) return `週 ${id} の ${d} の extras の形が正しくありません`;
        if (isObject(day) && day.notes !== undefined && !isObject(day.notes)) return `週 ${id} の ${d} の notes の形が正しくありません`;
      }
    }
    if (!isObject(data.months)) return "months の形が正しくありません";
    for (const [key, m] of Object.entries(data.months)) {
      if (!/^\d{4}-\d{2}$/.test(key) || !isObject(m)) return `月 ${key} の形が正しくありません`;
      if (m.goals !== undefined && !Array.isArray(m.goals)) return `月 ${key} の goals の形が正しくありません`;
      for (const g of m.goals || []) {
        if (!isObject(g)) return `月 ${key} の目標の形が正しくありません`;
        if (g.entries !== undefined && !Array.isArray(g.entries)) return `月 ${key} の entries の形が正しくありません`;
      }
      if (m.review !== undefined && !isObject(m.review)) return `月 ${key} の review の形が正しくありません`;
    }
    return null;
  }

  // JSON 文字列をデータにする（読み込み・localStorage 共通）
  function parseData(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "JSON として読めません" };
    }
    return migrate(raw);
  }

  // 読めなかった元データを別のキーに退避する（上書き保存で消さないため）。戻り値: 退避先のキー、失敗したら null
  function backupRaw(storage, text) {
    const key = `${KEY}.backup.${Date.now()}`;
    try {
      storage.setItem(key, text);
      return key;
    } catch (e) {
      return null;
    }
  }

  // 戻り値: { data, error, readOnly }。error があっても data は空のデータで、画面はそのまま動かせる。
  // 読めなかったデータは退避してから空のデータを返す。退避にも失敗したときは readOnly: true（save すると元データが消えるため）。
  function load(storage = defaultStorage()) {
    if (!storage) return { data: emptyData(), error: "この環境では保存できません（localStorage が使えません）", readOnly: false };
    let text;
    try {
      text = storage.getItem(KEY);
    } catch (e) {
      return { data: emptyData(), error: "保存データを読めませんでした（localStorage が使えません）", readOnly: false };
    }
    if (text === null || text === undefined) return { data: emptyData(), error: null, readOnly: false };
    const r = parseData(text);
    if (r.ok) return { data: r.data, error: null, readOnly: false };
    const backupKey = backupRaw(storage, text);
    return {
      data: emptyData(),
      error: backupKey
        ? `保存データを読めませんでした（${r.error}）。元のデータは localStorage の「${backupKey}」に残しています。`
        : `保存データを読めませんでした（${r.error}）。元のデータを退避できなかったため、上書きしないよう保存を止めています。`,
      readOnly: !backupKey,
    };
  }

  // 戻り値: 保存できたら true
  function save(data, storage = defaultStorage()) {
    if (!storage) return false;
    try {
      storage.setItem(KEY, JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION }));
      return true;
    } catch (e) {
      return false; // 容量超過など
    }
  }

  // ---------- 書き出し・読み込み（ブラウザのみ） ----------

  // 書き出すファイル名。date は YYYY-MM-DD
  function exportFileName(date) {
    return `pdca-planner-${date}.json`;
  }

  function toJson(data) {
    return JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION }, null, 2);
  }

  // JSON ファイルとしてダウンロードさせる
  function exportToFile(data, date) {
    const blob = new Blob([toJson(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(date);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ファイル選択を開く。選ばれたら File、キャンセルなら null
  function pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.addEventListener("change", () => resolve(input.files[0] || null));
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  }

  // 選んだファイルを読んで確認する。保存はしない（上書きの確認は画面側で行い、その後 save を呼ぶ）
  // 戻り値: Promise<{ ok: true, data } / { ok: false, error }>
  async function readImportFile(file) {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      return { ok: false, error: "ファイルを読めませんでした" };
    }
    return parseData(text);
  }

  const Storage = { KEY, SCHEMA_VERSION, emptyData, migrate, validate, parseData, load, save, exportFileName, toJson, exportToFile, pickFile, readImportFile };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Storage;
  } else {
    window.PlannerStorage = Storage;
  }
})();
