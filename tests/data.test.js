// 데이터 무결성 및 문제 생성기 검사: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const { KANJI, YOJI, TAIGI, RUIGI } = require("../js/data.js");
const { MODES, levelPool } = require("../js/app.js");

const KANA = /^[ぁ-ゖー]+$/;
const KATA = /^[ァ-ヺー]+$/;

test("3급 배당한자는 284자", () => {
  assert.strictEqual(KANJI.filter((k) => k.level === 3).length, 284);
});

test("한자 중복 없음", () => {
  const all = KANJI.map((k) => k.kanji);
  assert.strictEqual(new Set(all).size, all.length);
});

test("각 항목의 형식이 올바름", () => {
  for (const k of KANJI) {
    assert.strictEqual([...k.kanji].length, 1, k.kanji);
    assert.ok(k.on.length + k.kun.length > 0, `${k.kanji}: 읽기 없음`);
    k.on.forEach((o) => assert.match(o, KATA, `${k.kanji} 음독 ${o}`));
    k.kun.forEach((r) => assert.match(r.replace(/[()]/g, ""), KANA, `${k.kanji} 훈독 ${r}`));
    assert.ok(k.bushu, `${k.kanji}: 부수 없음`);
    assert.ok(k.examples.length > 0);
    for (const e of k.examples) {
      assert.ok(e.word.includes(k.kanji), `${k.kanji}: 예시어 ${e.word}`);
      assert.match(e.yomi, KANA, `${k.kanji}: 예시어 읽기 ${e.yomi}`);
    }
  }
});

test("사자성어·대의어·유의어 형식", () => {
  YOJI.forEach(([w, y, m]) => {
    assert.strictEqual([...w].length, 4, w);
    assert.match(y, KANA, w);
    assert.ok(m);
  });
  [...TAIGI, ...RUIGI].forEach((p) => assert.strictEqual(p.length, 2));
});

test("모든 모드에서 정답이 선택지에 포함되고 선택지가 중복되지 않음", () => {
  for (const level of ["3", "4", "all"]) {
    for (const [id, m] of Object.entries(MODES)) {
      let pool = levelPool(level);
      if (m.filter) pool = pool.filter(m.filter);
      for (let i = 0; i < 500; i++) {
        const q = m.make(pool);
        assert.ok(q.choices.includes(q.answer), `${id}: ${q.q}`);
        assert.strictEqual(new Set(q.choices).size, q.choices.length, `${id}: 중복 선택지`);
        assert.ok(q.choices.length >= (id === "kunyomi" ? 3 : 4), `${id}: 선택지 ${q.choices.length}개 (${q.q})`);
      }
    }
  }
});
