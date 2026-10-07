// 가계부 계산·검증·CSV 등 화면과 무관한 순수 로직 (Node 테스트 가능)
(function (root) {
  const DEFAULT_CATEGORIES = {
    expense: ["식비", "카페·간식", "교통", "주거·관리비", "통신", "생활용품", "의료·건강", "교육", "문화·여가", "의류·미용", "경조사·선물", "보험", "기타"],
    income: ["급여", "상여", "부수입", "용돈", "이자·배당", "환급", "기타"],
  };
  const METHODS = ["카드", "현금", "계좌이체", "간편결제", "기타"];
  const MAX_AMOUNT = 1e12; // 1조 원 미만만 허용 (입력 실수 방지)

  // "12,000원", "1.5만", " 3000 " 같은 입력을 정수 원 단위로 바꾼다. 실패하면 NaN
  function parseAmount(input) {
    if (typeof input === "number") return Number.isFinite(input) ? Math.round(input) : NaN;
    let s = String(input == null ? "" : input).replace(/[\s,₩원]/g, "");
    if (!s) return NaN;
    let mul = 1;
    if (/만$/.test(s)) { mul = 10000; s = s.slice(0, -1); }
    else if (/천$/.test(s)) { mul = 1000; s = s.slice(0, -1); }
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * mul);
  }

  function formatKRW(n, withSign) {
    const v = Math.round(n || 0);
    const body = Math.abs(v).toLocaleString("ko-KR") + "원";
    if (v < 0) return "-" + body;
    return (withSign && v > 0 ? "+" : "") + body;
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  function isValidDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  const monthOf = (date) => date.slice(0, 7);
  function shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function daysInMonth(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  // 입력값 검사 후 저장 형태로 정리. 오류가 있으면 { errors: [...] }
  function normalizeEntry(raw) {
    const errors = [];
    const type = raw.type === "income" ? "income" : raw.type === "expense" ? "expense" : null;
    if (!type) errors.push("수입/지출 구분이 올바르지 않습니다.");
    const date = String(raw.date || "").trim();
    if (!isValidDate(date)) errors.push("날짜가 올바르지 않습니다.");
    const amount = parseAmount(raw.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push("금액은 0보다 큰 숫자여야 합니다.");
    else if (amount >= MAX_AMOUNT) errors.push("금액이 너무 큽니다.");
    const category = String(raw.category || "").trim() || "기타";
    if (errors.length) return { errors };
    return {
      entry: {
        id: raw.id || makeId(),
        date, type, amount, category,
        method: String(raw.method || "").trim(),
        memo: String(raw.memo || "").trim().slice(0, 200),
      },
    };
  }

  let seq = 0;
  function makeId() {
    return Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // 날짜 내림차순, 같은 날이면 나중에 추가한 것이 위
  function sortEntries(list) {
    return list.map((e, i) => [e, i])
      .sort(([a, i], [b, j]) => (a.date < b.date ? 1 : a.date > b.date ? -1 : j - i))
      .map(([e]) => e);
  }

  function filterEntries(list, { month, type, category, query } = {}) {
    const q = (query || "").trim().toLowerCase();
    return list.filter((e) =>
      (!month || monthOf(e.date) === month) &&
      (!type || e.type === type) &&
      (!category || e.category === category) &&
      (!q || [e.memo, e.category, e.method].some((f) => (f || "").toLowerCase().includes(q))));
  }

  function totals(list) {
    let income = 0, expense = 0;
    for (const e of list) e.type === "income" ? (income += e.amount) : (expense += e.amount);
    return { income, expense, balance: income - expense };
  }

  // 분류별 합계, 큰 순서. ratio는 해당 유형 합계 대비 비율
  function byCategory(list, type) {
    const map = new Map();
    let sum = 0;
    for (const e of list) {
      if (e.type !== type) continue;
      map.set(e.category, (map.get(e.category) || 0) + e.amount);
      sum += e.amount;
    }
    return [...map].map(([category, amount]) => ({ category, amount, ratio: sum ? amount / sum : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }

  // 그 달의 일별 수입·지출 (index 0 = 1일)
  function dailySeries(list, month) {
    const n = daysInMonth(month);
    const days = Array.from({ length: n }, (_, i) => ({ day: i + 1, income: 0, expense: 0 }));
    for (const e of list) {
      if (monthOf(e.date) !== month) continue;
      days[Number(e.date.slice(8, 10)) - 1][e.type] += e.amount;
    }
    return days;
  }

  // 최근 n개월 수입·지출 (오래된 달부터)
  function monthlySeries(list, endMonth, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const m = shiftMonth(endMonth, -i);
      out.push({ month: m, ...totals(filterEntries(list, { month: m })) });
    }
    return out;
  }

  // 예산 대비 지출. budgets = { 분류: 월 예산 }, "__total__"은 전체 예산
  function budgetStatus(list, month, budgets) {
    const spent = new Map(byCategory(filterEntries(list, { month }), "expense").map((c) => [c.category, c.amount]));
    const totalSpent = [...spent.values()].reduce((a, b) => a + b, 0);
    return Object.entries(budgets || {})
      .filter(([, limit]) => limit > 0)
      .map(([category, limit]) => {
        const used = category === "__total__" ? totalSpent : spent.get(category) || 0;
        const ratio = used / limit;
        return { category, limit, used, remain: limit - used, ratio,
          level: ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok" };
      })
      .sort((a, b) => (a.category === "__total__" ? -1 : b.category === "__total__" ? 1 : b.ratio - a.ratio));
  }

  // 고정 수입·지출(매월 n일)을 해당 달에 아직 없으면 만들어 준다. 31일 지정 시 짧은 달은 말일
  function dueRecurring(recurring, month, existing) {
    const out = [];
    for (const r of recurring || []) {
      if (r.startMonth && month < r.startMonth) continue;
      if ((r.skip || []).includes(month)) continue; // 그 달에 사용자가 지운 경우 다시 만들지 않음
      const already = existing.some((e) => e.recurringId === r.id && monthOf(e.date) === month);
      if (already) continue;
      const day = Math.min(r.day, daysInMonth(month));
      out.push({ id: makeId(), recurringId: r.id, date: `${month}-${pad(day)}`, type: r.type,
        amount: r.amount, category: r.category, method: r.method || "", memo: r.memo || "" });
    }
    return out;
  }

  // ---- CSV (엑셀 호환: UTF-8 BOM, 따옴표 이스케이프, 수식 주입 방지) ----
  const CSV_HEADER = ["날짜", "구분", "분류", "금액", "결제수단", "메모"];
  const TYPE_LABEL = { income: "수입", expense: "지출" };

  function csvCell(v) {
    let s = String(v == null ? "" : v);
    // =,+,-,@ 로 시작하는 문자열은 엑셀이 수식으로 실행할 수 있어 앞에 '를 붙인다 (OWASP CSV Injection)
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCSV(list) {
    const rows = [CSV_HEADER, ...sortEntries(list).reverse().map((e) =>
      [e.date, TYPE_LABEL[e.type], e.category, e.amount, e.method, e.memo])];
    return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  function parseCSVText(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  // CSV → 항목. 날짜는 2026-01-05, 2026.1.5, 2026/1/5 모두 허용
  function fromCSV(text) {
    const rows = parseCSVText(text);
    if (!rows.length) return { entries: [], errors: ["빈 파일입니다."] };
    const head = rows[0].map((h) => h.trim());
    const idx = (name) => head.indexOf(name);
    if (idx("날짜") < 0 || idx("금액") < 0) return { entries: [], errors: ["첫 줄에 '날짜', '금액' 열이 필요합니다."] };
    const entries = [], errors = [];
    rows.slice(1).forEach((r, i) => {
      const get = (name) => (idx(name) >= 0 ? (r[idx(name)] || "").trim().replace(/^'(?=[=+\-@])/, "") : "");
      const dm = get("날짜").match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      const date = dm ? `${dm[1]}-${pad(dm[2])}-${pad(dm[3])}` : get("날짜");
      let amount = parseAmount(get("금액"));
      let type = { 수입: "income", 지출: "expense", income: "income", expense: "expense" }[get("구분")];
      // 구분 열이 없거나 비어 있으면 은행 내역처럼 음수=지출, 양수=수입으로 본다
      if (!type) type = amount < 0 ? "expense" : "income";
      if (amount < 0) amount = -amount;
      const res = normalizeEntry({ date, type, amount, category: get("분류"), method: get("결제수단"), memo: get("메모") });
      if (res.errors) errors.push(`${i + 2}번째 줄: ${res.errors.join(" ")}`);
      else entries.push(res.entry);
    });
    return { entries, errors };
  }

  // 가져오기 시 날짜·구분·금액·분류·메모가 모두 같은 항목은 중복으로 보고 건너뛴다
  function mergeEntries(existing, incoming) {
    const key = (e) => [e.date, e.type, e.amount, e.category, e.memo].join("\u0001");
    const seen = new Set(existing.map(key));
    const added = [];
    for (const e of incoming) {
      const k = key(e);
      if (seen.has(k)) continue;
      seen.add(k);
      added.push(e);
    }
    return { list: existing.concat(added), added: added.length, skipped: incoming.length - added.length };
  }

  // 백업 파일(JSON) 검사
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch { return { error: "JSON 형식이 아닙니다." }; }
    if (!data || !Array.isArray(data.entries)) return { error: "가계부 백업 파일이 아닙니다." };
    const entries = [];
    for (const raw of data.entries) {
      const res = normalizeEntry(raw);
      if (res.errors) return { error: `잘못된 항목이 있습니다 (${raw && raw.date}): ${res.errors.join(" ")}` };
      if (raw.recurringId) res.entry.recurringId = raw.recurringId;
      entries.push(res.entry);
    }
    return {
      data: {
        entries,
        budgets: data.budgets && typeof data.budgets === "object" ? data.budgets : {},
        categories: data.categories && Array.isArray(data.categories.expense) && Array.isArray(data.categories.income)
          ? data.categories : clone(DEFAULT_CATEGORIES),
        recurring: Array.isArray(data.recurring) ? data.recurring : [],
      },
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  const api = { DEFAULT_CATEGORIES, METHODS, MAX_AMOUNT, parseAmount, formatKRW, toISODate, isValidDate, monthOf,
    shiftMonth, daysInMonth, normalizeEntry, sortEntries, filterEntries, totals, byCategory, dailySeries,
    monthlySeries, budgetStatus, dueRecurring, toCSV, parseCSVText, fromCSV, mergeEntries, parseBackup, clone };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Ledger = api;
})(typeof window !== "undefined" ? window : globalThis);
