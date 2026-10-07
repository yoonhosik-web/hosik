// 가계부 화면 로직. 데이터는 localStorage에만 저장한다.
(function () {
  const L = window.Ledger;
  const KEY = "budget-ledger-v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---- 저장소 ----
  function emptyState() {
    return { entries: [], budgets: {}, categories: L.clone(L.DEFAULT_CATEGORIES), recurring: [] };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      const res = L.parseBackup(raw);
      if (res.error) throw new Error(res.error);
      return res.data;
    } catch (e) {
      console.warn("저장된 데이터를 읽지 못했습니다:", e);
      return emptyState();
    }
  }
  let storageOk = true;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      if (storageOk) toast("브라우저 저장소에 저장하지 못했습니다. 백업 파일로 내보내 두세요.");
      storageOk = false;
    }
  }

  const state = load();
  const today = L.toISODate(new Date());
  let month = L.monthOf(today);
  let view = "list";
  let editingId = null;

  // ---- 공통 ----
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  }
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }
  function fillSelect(sel, items, value) {
    sel.replaceChildren(...items.map((v) => el("option", { value: v, text: v })));
    if (value != null) {
      if (!items.includes(value)) sel.append(el("option", { value, text: value }));
      sel.value = value;
    }
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function monthLabel(m) {
    const [y, mm] = m.split("-");
    return `${y}년 ${Number(mm)}월`;
  }
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  function dayLabel(date) {
    const [y, m, d] = date.split("-").map(Number);
    return `${m}월 ${d}일 (${WEEK[new Date(y, m - 1, d).getDay()]})`;
  }

  // ---- 고정 항목 자동 추가 (오늘이 속한 달까지만) ----
  function applyRecurring(m) {
    if (m > L.monthOf(today)) return;
    const due = L.dueRecurring(state.recurring, m, state.entries);
    if (due.length) {
      state.entries.push(...due);
      save();
      toast(`${monthLabel(m)} 고정 항목 ${due.length}건을 추가했습니다.`);
    }
  }

  // ---- 입력 폼 ----
  const form = $("#entry-form");
  function formType() { return form.type.value; }
  function refreshFormCategories(keep) {
    fillSelect(form.category, state.categories[formType()], keep);
  }
  function resetForm() {
    editingId = null;
    form.reset();
    // 보고 있는 달이 이번 달이 아니면 그 달 1일을 기본값으로
    form.date.value = L.monthOf(today) === month ? today : `${month}-01`;
    refreshFormCategories();
    fillSelect(form.method, L.METHODS);
    $("#save-btn").textContent = "추가";
    $("#cancel-edit").hidden = true;
    $("#form-error").textContent = "";
  }
  $$("input[name=type]", form).forEach((r) => r.addEventListener("change", () => refreshFormCategories()));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const res = L.normalizeEntry({
      id: editingId || undefined,
      type: formType(),
      date: form.date.value,
      amount: form.amount.value,
      category: form.category.value,
      method: form.method.value,
      memo: form.memo.value,
    });
    if (res.errors) { $("#form-error").textContent = res.errors.join(" "); return; }
    if (editingId) {
      const i = state.entries.findIndex((e) => e.id === editingId);
      if (i >= 0) state.entries[i] = { ...state.entries[i], ...res.entry };
      toast("수정했습니다.");
    } else {
      state.entries.push(res.entry);
      toast(`${res.entry.type === "income" ? "수입" : "지출"} ${L.formatKRW(res.entry.amount)} 추가`);
    }
    save();
    const m = L.monthOf(res.entry.date);
    const lastDate = res.entry.date;
    if (m !== month) setMonth(m);
    resetForm();
    form.date.value = lastDate; // 같은 날 여러 건 입력하기 편하게
    render();
    form.amount.focus();
  });
  $("#cancel-edit").addEventListener("click", () => { resetForm(); render(); });

  function startEdit(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    editingId = id;
    form.querySelector(`input[name=type][value=${e.type}]`).checked = true;
    form.date.value = e.date;
    form.amount.value = e.amount.toLocaleString("ko-KR");
    refreshFormCategories(e.category);
    fillSelect(form.method, L.METHODS, e.method || L.METHODS[0]);
    form.memo.value = e.memo;
    $("#save-btn").textContent = "수정 저장";
    $("#cancel-edit").hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.amount.focus();
  }

  function removeEntry(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    if (!confirm(`${dayLabel(e.date)} ${e.category} ${L.formatKRW(e.amount)} 항목을 지울까요?`)) return;
    state.entries = state.entries.filter((x) => x.id !== id);
    if (e.recurringId) {
      const r = state.recurring.find((x) => x.id === e.recurringId);
      if (r) (r.skip = r.skip || []).push(L.monthOf(e.date));
    }
    if (editingId === id) resetForm();
    save();
    render();
  }

  // ---- 내역 목록 ----
  function renderList() {
    const filters = { month, type: $("#f-type").value, category: $("#f-category").value, query: $("#f-query").value };
    const list = L.sortEntries(L.filterEntries(state.entries, filters));
    const box = $("#entries");
    const t = L.totals(list);
    $("#list-count").textContent = list.length
      ? `${list.length}건 · 수입 ${L.formatKRW(t.income)} · 지출 ${L.formatKRW(t.expense)}` : "";
    if (!list.length) {
      box.replaceChildren(el("p", { class: "empty", text: `${monthLabel(month)}에 해당하는 내역이 없습니다.` }));
      return;
    }
    const groups = new Map();
    for (const e of list) (groups.get(e.date) || groups.set(e.date, []).get(e.date)).push(e);
    box.replaceChildren(...[...groups].map(([date, items]) => {
      const dt = L.totals(items);
      return el("div", { class: "day-group" },
        el("div", { class: "day-head" },
          el("span", { text: dayLabel(date) }),
          el("span", { class: "mono" },
            dt.income ? el("span", { class: "income", text: `+${dt.income.toLocaleString("ko-KR")} ` }) : null,
            dt.expense ? el("span", { class: "expense", text: `-${dt.expense.toLocaleString("ko-KR")}` }) : null)),
        items.map((e) => el("div", { class: "entry" },
          el("div", { class: "meta" },
            el("span", { class: "cat", text: e.category }),
            e.method ? el("span", { class: "badge", text: e.method }) : null,
            e.recurringId ? el("span", { class: "badge", text: "고정" }) : null,
            e.memo ? el("div", { class: "memo", text: e.memo }) : null),
          el("span", { class: `amt mono ${e.type}`, text: L.formatKRW(e.type === "income" ? e.amount : -e.amount, true) }),
          el("span", { class: "btns" },
            el("button", { class: "ghost", text: "수정", onclick: () => startEdit(e.id) }),
            el("button", { class: "ghost", text: "삭제", onclick: () => removeEntry(e.id) })))));
    }));
  }
  function refreshFilterCategories() {
    const sel = $("#f-category");
    const keep = sel.value;
    const type = $("#f-type").value;
    const used = new Set(state.entries.filter((e) => !type || e.type === type).map((e) => e.category));
    const cats = [...new Set([...(type ? state.categories[type] : [...state.categories.expense, ...state.categories.income]), ...used])];
    sel.replaceChildren(el("option", { value: "", text: "모든 분류" }), ...cats.map((c) => el("option", { value: c, text: c })));
    sel.value = cats.includes(keep) ? keep : "";
  }
  $("#f-type").addEventListener("change", () => { refreshFilterCategories(); renderList(); });
  $("#f-category").addEventListener("change", renderList);
  $("#f-query").addEventListener("input", renderList);

  // ---- 요약 ----
  function renderSummary() {
    const t = L.totals(L.filterEntries(state.entries, { month }));
    $("#sum-income").textContent = L.formatKRW(t.income);
    $("#sum-expense").textContent = L.formatKRW(t.expense);
    const b = $("#sum-balance");
    b.textContent = L.formatKRW(t.balance);
    b.className = "mono " + (t.balance < 0 ? "expense" : t.balance > 0 ? "income" : "");
  }

  // ---- 통계 ----
  function renderBars(box, rows, type) {
    box.classList.toggle("is-income", type === "income");
    if (!rows.length) { box.replaceChildren(el("p", { class: "note", text: "내역이 없습니다." })); return; }
    const max = rows[0].amount;
    box.replaceChildren(...rows.map((r) => el("div", { class: "row" },
      el("span", { class: "name", text: r.category, title: r.category }),
      el("span", { class: "track" }, el("span", { class: "fill", style: `display:block;width:${(r.amount / max) * 100}%` })),
      el("span", { class: "mono", text: `${L.formatKRW(r.amount)} (${Math.round(r.ratio * 100)}%)` }))));
  }

  const SVG = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    for (const c of kids) n.append(c);
    return n;
  }
  function shortWon(v) {
    if (v >= 1e8) return `${+(v / 1e8).toFixed(1)}억`;
    if (v >= 1e4) return `${+(v / 1e4).toFixed(1)}만`;
    return String(v);
  }
  // 세로 막대 차트. series: [{label, values:[...]}], colors: CSS 변수 이름
  function barChart(box, labels, series, colors, labelEvery = 1) {
    const W = 400, H = 170, pl = 40, pb = 18, pt = 8;
    const max = Math.max(1, ...series.flatMap((s) => s));
    const n = labels.length, gw = (W - pl) / n, bw = Math.max(2, (gw * 0.7) / series.length);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (let i = 0; i <= 2; i++) {
      const v = (max * i) / 2, y = H - pb - ((H - pb - pt) * i) / 2;
      root.append(svg("line", { x1: pl, x2: W, y1: y, y2: y, stroke: "var(--line)" }));
      root.append(svg("text", { x: pl - 4, y: y + 3, "text-anchor": "end" }, shortWon(Math.round(v))));
    }
    labels.forEach((lab, i) => {
      series.forEach((s, j) => {
        const h = ((H - pb - pt) * s[i]) / max;
        const x = pl + gw * i + (gw - bw * series.length) / 2 + bw * j;
        const r = svg("rect", { x, y: H - pb - h, width: bw, height: h, fill: `var(${colors[j]})`, rx: 1.5 });
        r.append(svg("title", {}, `${lab}: ${L.formatKRW(s[i])}`));
        root.append(r);
      });
      if (i % labelEvery === 0) root.append(svg("text", { x: pl + gw * i + gw / 2, y: H - 6, "text-anchor": "middle" }, lab));
    });
    box.replaceChildren(root);
  }

  function renderStats() {
    const list = L.filterEntries(state.entries, { month });
    renderBars($("#cat-chart"), L.byCategory(list, "expense"), "expense");
    renderBars($("#cat-chart-income"), L.byCategory(list, "income"), "income");

    const days = L.dailySeries(state.entries, month);
    barChart($("#daily-chart"), days.map((d) => String(d.day)), [days.map((d) => d.expense)], ["--expense"], 5);
    const spent = days.reduce((a, d) => a + d.expense, 0);
    const passed = month === L.monthOf(today) ? Number(today.slice(8)) : month < L.monthOf(today) ? days.length : 0;
    $("#daily-note").textContent = passed
      ? `하루 평균 지출 ${L.formatKRW(Math.round(spent / passed))} (${passed}일 기준)` : "";

    const ms = L.monthlySeries(state.entries, month, 6);
    barChart($("#monthly-chart"), ms.map((m) => `${Number(m.month.slice(5))}월`),
      [ms.map((m) => m.income), ms.map((m) => m.expense)], ["--income", "--expense"]);
    $("#monthly-table").replaceChildren(
      el("tr", {}, ["월", "수입", "지출", "잔액"].map((h) => el("th", { text: h }))),
      ...ms.map((m) => el("tr", {},
        el("td", { text: `${m.month.slice(2, 4)}.${Number(m.month.slice(5))}` }),
        el("td", { class: "income", text: L.formatKRW(m.income) }),
        el("td", { class: "expense", text: L.formatKRW(m.expense) }),
        el("td", { text: L.formatKRW(m.balance) }))));
  }

  // ---- 예산 ----
  function renderBudget() {
    const status = L.budgetStatus(state.entries, month, state.budgets);
    const box = $("#budget-status");
    if (!status.length) box.replaceChildren(el("p", { class: "note", text: "아래에서 월 예산을 정하면 여기서 사용 현황을 볼 수 있습니다." }));
    else box.replaceChildren(...status.map((s) => el("div", { class: `budget-item ${s.level}` },
      el("div", { class: "top" },
        el("strong", { text: s.category === "__total__" ? "전체 지출" : s.category }),
        el("span", { class: "mono" },
          `${L.formatKRW(s.used)} / ${L.formatKRW(s.limit)} (${Math.round(s.ratio * 100)}%) · `,
          el("span", { class: "remain", text: s.remain >= 0 ? `${L.formatKRW(s.remain)} 남음` : `${L.formatKRW(-s.remain)} 초과` }))),
      el("div", { class: "track" }, el("div", { class: "fill", style: `width:${Math.min(100, s.ratio * 100)}%` })))));

    const f = $("#budget-form");
    const input = (key, label, cls) => el("label", { class: cls },
      el("span", { text: label }),
      el("input", { type: "text", inputmode: "numeric", name: key, value: state.budgets[key] ? state.budgets[key].toLocaleString("ko-KR") : "", placeholder: "0" }));
    f.replaceChildren(input("__total__", "전체 지출 예산", "total"), ...state.categories.expense.map((c) => input(c, c)));
  }
  $("#budget-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const next = {};
    for (const inp of $$("input", ev.target)) {
      if (!inp.value.trim()) continue;
      const v = L.parseAmount(inp.value);
      if (!Number.isFinite(v) || v < 0) { toast(`'${inp.name === "__total__" ? "전체" : inp.name}' 금액을 확인하세요.`); inp.focus(); return; }
      if (v > 0) next[inp.name] = v;
    }
    state.budgets = next;
    save();
    render();
    toast("예산을 저장했습니다.");
  });

  // ---- 설정: 고정 항목 ----
  const recForm = $("#rec-form");
  function refreshRecForm() {
    fillSelect(recForm.category, state.categories[recForm.type.value]);
    fillSelect(recForm.method, L.METHODS);
  }
  recForm.type.addEventListener("change", refreshRecForm);
  recForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const day = Number(recForm.day.value);
    const res = L.normalizeEntry({ type: recForm.type.value, date: today, amount: recForm.amount.value,
      category: recForm.category.value, method: recForm.method.value, memo: recForm.memo.value });
    const errs = res.errors ? res.errors.slice() : [];
    if (!(day >= 1 && day <= 31 && Number.isInteger(day))) errs.push("날짜는 1~31 사이로 입력하세요.");
    if (errs.length) { $("#rec-error").textContent = errs.join(" "); return; }
    $("#rec-error").textContent = "";
    const { type, amount, category, method, memo } = res.entry;
    state.recurring.push({ id: res.entry.id, type, amount, category, method, memo, day, startMonth: L.monthOf(today), skip: [] });
    save();
    recForm.reset();
    refreshRecForm();
    applyRecurring(L.monthOf(today));
    render();
  });
  function renderRecurring() {
    const ul = $("#rec-list");
    if (!state.recurring.length) { ul.replaceChildren(el("li", { class: "note", text: "등록된 고정 항목이 없습니다." })); return; }
    ul.replaceChildren(...state.recurring.map((r) => el("li", {},
      el("span", {},
        `매월 ${r.day}일 · ${r.category}${r.memo ? ` (${r.memo})` : ""} · `,
        el("strong", { class: `mono ${r.type}`, text: L.formatKRW(r.type === "income" ? r.amount : -r.amount, true) })),
      el("button", { class: "ghost", text: "삭제", onclick: () => {
        if (!confirm("이 고정 항목을 삭제할까요? 이미 추가된 내역은 남습니다.")) return;
        state.recurring = state.recurring.filter((x) => x.id !== r.id);
        save();
        render();
      } }))));
  }

  // ---- 설정: 분류 ----
  function renderCategories() {
    for (const type of ["expense", "income"]) {
      $(`#cat-${type}`).replaceChildren(...state.categories[type].map((c) => el("li", {}, c,
        el("button", { "aria-label": `${c} 삭제`, text: "×", onclick: () => {
          if (state.categories[type].length <= 1) { toast("분류는 하나 이상 있어야 합니다."); return; }
          state.categories[type] = state.categories[type].filter((x) => x !== c);
          if (type === "expense") delete state.budgets[c];
          save();
          render();
        } }))));
    }
  }
  $$(".cat-add").forEach((f) => f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const inp = $("input", f);
    const name = inp.value.trim();
    const list = state.categories[f.dataset.type];
    if (!name) return;
    if (name === "__total__" || list.includes(name)) { toast("이미 있는 분류입니다."); return; }
    list.push(name);
    inp.value = "";
    save();
    render();
  }));

  // ---- 백업·CSV ----
  const stamp = () => today.replace(/-/g, "");
  $("#export-json").addEventListener("click", () => {
    download(`가계부-백업-${stamp()}.json`, JSON.stringify({ app: "budget", version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2), "application/json");
  });
  $("#export-csv").addEventListener("click", () => {
    download(`가계부-${month}.csv`, L.toCSV(L.filterEntries(state.entries, { month })), "text/csv;charset=utf-8");
  });
  $("#export-csv-all").addEventListener("click", () => {
    download(`가계부-전체-${stamp()}.csv`, L.toCSV(state.entries), "text/csv;charset=utf-8");
  });
  function readFile(input, cb) {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { $("#io-msg").textContent = "파일이 너무 큽니다 (20MB 초과)."; return; }
    file.text().then(cb, () => ($("#io-msg").textContent = "파일을 읽지 못했습니다."));
  }
  $("#import-json").addEventListener("change", (ev) => readFile(ev.target, (text) => {
    const res = L.parseBackup(text);
    if (res.error) { $("#io-msg").textContent = res.error; return; }
    if (!confirm(`백업의 내역 ${res.data.entries.length}건으로 현재 데이터(${state.entries.length}건)를 바꿀까요?`)) return;
    Object.assign(state, res.data);
    save();
    $("#io-msg").textContent = `복원했습니다: 내역 ${state.entries.length}건.`;
    resetForm();
    render();
  }));
  $("#import-csv").addEventListener("change", (ev) => readFile(ev.target, (text) => {
    const { entries, errors } = L.fromCSV(text);
    const merged = L.mergeEntries(state.entries, entries);
    // 새 분류는 분류 목록에도 추가
    for (const e of entries) if (!state.categories[e.type].includes(e.category)) state.categories[e.type].push(e.category);
    state.entries = merged.list;
    save();
    const msg = [`${merged.added}건 가져옴`];
    if (merged.skipped) msg.push(`중복 ${merged.skipped}건 건너뜀`);
    if (errors.length) msg.push(`오류 ${errors.length}건: ${errors.slice(0, 3).join(" / ")}${errors.length > 3 ? " …" : ""}`);
    $("#io-msg").textContent = msg.join(", ");
    render();
  }));
  $("#wipe").addEventListener("click", () => {
    if (!confirm("모든 내역·예산·설정을 지울까요? 되돌릴 수 없습니다.")) return;
    if (!confirm("정말 지울까요? 필요하면 먼저 '전체 백업'을 받아 두세요.")) return;
    Object.assign(state, emptyState());
    try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
    resetForm();
    render();
    toast("모두 지웠습니다.");
  });

  // ---- 월 이동·탭 ----
  function setMonth(m) {
    month = m;
    $("#month").value = m;
    applyRecurring(m);
  }
  $("#month").addEventListener("change", (ev) => {
    if (/^\d{4}-\d{2}$/.test(ev.target.value)) { setMonth(ev.target.value); if (!editingId) resetForm(); render(); }
  });
  $("#prev-month").addEventListener("click", () => { setMonth(L.shiftMonth(month, -1)); if (!editingId) resetForm(); render(); });
  $("#next-month").addEventListener("click", () => { setMonth(L.shiftMonth(month, 1)); if (!editingId) resetForm(); render(); });
  $("#this-month").addEventListener("click", () => { setMonth(L.monthOf(today)); if (!editingId) resetForm(); render(); });

  function showView(v) {
    view = v;
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    for (const s of ["list", "stats", "budget", "settings"]) $(`#view-${s}`).hidden = s !== v;
    render();
  }
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $$("[data-goto]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); showView(a.dataset.goto); }));

  function render() {
    renderSummary();
    if (view === "list") { refreshFilterCategories(); renderList(); }
    else if (view === "stats") renderStats();
    else if (view === "budget") renderBudget();
    else { renderRecurring(); renderCategories(); }
    // 분류가 바뀌었을 수 있으니 폼 선택지 갱신 (선택값 유지)
    const cur = form.category.value;
    if (!editingId) refreshFormCategories(state.categories[formType()].includes(cur) ? cur : undefined);
  }

  // 다른 탭에서 바뀐 내용 반영
  window.addEventListener("storage", (ev) => {
    if (ev.key !== KEY) return;
    Object.assign(state, load());
    render();
  });

  setMonth(month);
  resetForm();
  refreshRecForm();
  render();
})();
