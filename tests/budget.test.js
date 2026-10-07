// 가계부 순수 로직 검사: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const L = require("../budget/js/ledger.js");

const E = (date, type, amount, category = "식비", memo = "") =>
  L.normalizeEntry({ date, type, amount, category, memo }).entry;

test("금액 입력 해석", () => {
  assert.strictEqual(L.parseAmount("12,000"), 12000);
  assert.strictEqual(L.parseAmount("₩ 3,500원"), 3500);
  assert.strictEqual(L.parseAmount("1.5만"), 15000);
  assert.strictEqual(L.parseAmount("3천"), 3000);
  assert.strictEqual(L.parseAmount("-2000"), -2000);
  assert.ok(Number.isNaN(L.parseAmount("")));
  assert.ok(Number.isNaN(L.parseAmount("abc")));
  assert.ok(Number.isNaN(L.parseAmount("1e5")));
});

test("금액 표시", () => {
  assert.strictEqual(L.formatKRW(1234567), "1,234,567원");
  assert.strictEqual(L.formatKRW(-500), "-500원");
  assert.strictEqual(L.formatKRW(500, true), "+500원");
  assert.strictEqual(L.formatKRW(0, true), "0원");
});

test("날짜 검사와 월 계산", () => {
  assert.ok(L.isValidDate("2024-02-29"));
  assert.ok(!L.isValidDate("2025-02-29"));
  assert.ok(!L.isValidDate("2025-13-01"));
  assert.strictEqual(L.shiftMonth("2026-01", -1), "2025-12");
  assert.strictEqual(L.shiftMonth("2026-12", 1), "2027-01");
  assert.strictEqual(L.daysInMonth("2024-02"), 29);
  assert.strictEqual(L.daysInMonth("2026-04"), 30);
});

test("입력 검증", () => {
  assert.ok(L.normalizeEntry({ date: "2026-10-07", type: "expense", amount: "0" }).errors);
  assert.ok(L.normalizeEntry({ date: "2026-10-07", type: "expense", amount: "-5" }).errors);
  assert.ok(L.normalizeEntry({ date: "2026-10-32", type: "expense", amount: "5" }).errors);
  assert.ok(L.normalizeEntry({ date: "2026-10-07", type: "x", amount: "5" }).errors);
  const ok = L.normalizeEntry({ date: "2026-10-07", type: "income", amount: "1,000", memo: "  용돈 " }).entry;
  assert.strictEqual(ok.amount, 1000);
  assert.strictEqual(ok.memo, "용돈");
  assert.strictEqual(ok.category, "기타");
  assert.ok(ok.id);
});

test("정렬: 최신 날짜 먼저, 같은 날은 나중에 추가한 것 먼저", () => {
  const a = E("2026-10-01", "expense", 1), b = E("2026-10-05", "expense", 2), c = E("2026-10-05", "expense", 3);
  assert.deepStrictEqual(L.sortEntries([a, b, c]).map((e) => e.amount), [3, 2, 1]);
});

test("필터·합계·분류별", () => {
  const list = [
    E("2026-10-01", "income", 3000000, "급여"),
    E("2026-10-02", "expense", 9000, "식비", "점심 김밥"),
    E("2026-10-03", "expense", 1000, "식비"),
    E("2026-10-03", "expense", 10000, "교통"),
    E("2026-09-30", "expense", 50000, "식비"),
  ];
  const oct = L.filterEntries(list, { month: "2026-10" });
  assert.strictEqual(oct.length, 4);
  assert.deepStrictEqual(L.totals(oct), { income: 3000000, expense: 20000, balance: 2980000 });
  assert.strictEqual(L.filterEntries(list, { query: "김밥" }).length, 1);
  const cats = L.byCategory(oct, "expense");
  assert.deepStrictEqual(cats.map((c) => [c.category, c.amount]), [["식비", 10000], ["교통", 10000]]);
  assert.strictEqual(cats[0].ratio, 0.5);
  const days = L.dailySeries(list, "2026-10");
  assert.strictEqual(days.length, 31);
  assert.strictEqual(days[2].expense, 11000);
  const ms = L.monthlySeries(list, "2026-10", 3);
  assert.deepStrictEqual(ms.map((m) => [m.month, m.expense]), [["2026-08", 0], ["2026-09", 50000], ["2026-10", 20000]]);
});

test("예산 상태", () => {
  const list = [E("2026-10-01", "expense", 85000, "식비"), E("2026-10-02", "expense", 30000, "교통")];
  const st = L.budgetStatus(list, "2026-10", { __total__: 100000, 식비: 100000, 교통: 20000, 통신: 0 });
  assert.strictEqual(st[0].category, "__total__");
  assert.strictEqual(st[0].level, "over");
  assert.strictEqual(st[0].remain, -15000);
  const food = st.find((s) => s.category === "식비");
  assert.strictEqual(food.level, "warn");
  assert.ok(!st.some((s) => s.category === "통신"));
});

test("고정 항목: 한 달에 한 번, 말일 보정, 시작 전·지운 달은 제외", () => {
  const rec = [{ id: "r1", type: "expense", amount: 500000, category: "주거·관리비", day: 31, startMonth: "2026-02", skip: ["2026-04"] }];
  const feb = L.dueRecurring(rec, "2026-02", []);
  assert.strictEqual(feb.length, 1);
  assert.strictEqual(feb[0].date, "2026-02-28");
  assert.strictEqual(L.dueRecurring(rec, "2026-02", feb).length, 0);
  assert.strictEqual(L.dueRecurring(rec, "2026-01", []).length, 0);
  assert.strictEqual(L.dueRecurring(rec, "2026-04", []).length, 0);
});

test("CSV 내보내기: 따옴표·쉼표·줄바꿈 이스케이프와 수식 주입 방지", () => {
  const csv = L.toCSV([E("2026-10-01", "expense", 1000, "식비", 'a,"b"\nc'), E("2026-10-02", "expense", 2000, "식비", "=1+1")]);
  assert.ok(csv.startsWith("﻿날짜,구분,분류,금액,결제수단,메모\r\n"));
  assert.ok(csv.includes('"a,""b""\nc"'));
  assert.ok(csv.includes(",'=1+1"));
});

test("CSV 왕복", () => {
  const src = [E("2026-10-01", "income", 1000, "급여", 'x,"y"\nz'), E("2026-10-02", "expense", 2500, "식비", "-메모")];
  const { entries, errors } = L.fromCSV(L.toCSV(src));
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(entries.map((e) => [e.date, e.type, e.amount, e.category, e.memo]),
    src.map((e) => [e.date, e.type, e.amount, e.category, e.memo]));
});

test("CSV 가져오기: 다른 날짜 형식, 구분 없을 때 부호로 판단, 오류 줄 보고", () => {
  const text = "날짜,금액,메모\n2026.1.5,-12000,편의점\n2026/01/06,\"1,000,000\",월급\n잘못된날,100,\n";
  const { entries, errors } = L.fromCSV(text);
  assert.deepStrictEqual(entries.map((e) => [e.date, e.type, e.amount]),
    [["2026-01-05", "expense", 12000], ["2026-01-06", "income", 1000000]]);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /^4번째 줄/);
  assert.ok(L.fromCSV("a,b\n1,2").errors.length);
});

test("중복 가져오기 건너뜀", () => {
  const a = E("2026-10-01", "expense", 1000, "식비", "x");
  const dup = { ...a, id: "other" };
  const r = L.mergeEntries([a], [dup, E("2026-10-01", "expense", 1000, "식비", "y"), { ...dup, id: "z" }]);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.skipped, 2);
  assert.strictEqual(r.list.length, 2);
});

test("백업 파일 검사", () => {
  assert.ok(L.parseBackup("not json").error);
  assert.ok(L.parseBackup("{}").error);
  assert.ok(L.parseBackup(JSON.stringify({ entries: [{ date: "x", type: "expense", amount: 1 }] })).error);
  const ok = L.parseBackup(JSON.stringify({ entries: [{ id: "a", date: "2026-10-01", type: "expense", amount: 1, recurringId: "r" }] }));
  assert.strictEqual(ok.data.entries[0].recurringId, "r");
  assert.deepStrictEqual(ok.data.categories, L.DEFAULT_CATEGORIES);
});
