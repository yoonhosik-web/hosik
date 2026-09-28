// 영상 편집기 순수 로직 검사: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const T = require("../video-maker/js/timeline.js");

test("전환 시간만큼 구간이 겹치고 전체 길이가 줄어든다", () => {
  const tl = T.buildTimeline([{ duration: 4 }, { duration: 4 }, { duration: 4 }], 1);
  assert.deepStrictEqual(tl.items.map((i) => i.start), [0, 3, 6]);
  assert.strictEqual(tl.total, 10);
});

test("전환 시간은 가장 짧은 구간의 절반으로 제한", () => {
  const tl = T.buildTimeline([{ duration: 4 }, { duration: 1 }], 2);
  assert.strictEqual(tl.transition, 0.5);
  assert.strictEqual(T.buildTimeline([{ duration: 4 }], 2).transition, 0);
});

test("겹치는 구간에서는 두 장면이 함께 보인다", () => {
  const tl = T.buildTimeline([{ duration: 4 }, { duration: 4 }], 1);
  const act = T.activeAt(tl, 3.5);
  assert.strictEqual(act.length, 2);
  assert.strictEqual(act[1].fadeIn, 0.5);
  assert.strictEqual(T.activeAt(tl, 1).length, 1);
  assert.strictEqual(T.activeAt(tl, 99)[0].item.index, 1); // 끝난 뒤에는 마지막 장면 유지
  assert.strictEqual(T.activeAt(T.buildTimeline([], 0), 0).length, 0);
});

test("fitRect cover/contain", () => {
  assert.deepStrictEqual(T.fitRect(100, 100, 200, 100, "contain"), { x: 50, y: 0, w: 100, h: 100 });
  assert.deepStrictEqual(T.fitRect(100, 100, 200, 100, "cover"), { x: 0, y: -50, w: 200, h: 200 });
});

test("켄 번즈 배율은 1~1.12 범위", () => {
  for (const i of [0, 1, 2, 3]) {
    for (const p of [0, 0.3, 1]) {
      const k = T.kenBurns(i, p);
      assert.ok(k.scale >= 1 && k.scale <= 1.12 + 1e-9);
    }
  }
});

test("시간 표기", () => {
  assert.strictEqual(T.formatTime(0), "0:00");
  assert.strictEqual(T.formatTime(75.9), "1:15");
  assert.strictEqual(T.formatTime(3725), "1:02:05");
  assert.strictEqual(T.formatTime(5, true), "0:00:05");
});

test("챕터: 첫 챕터는 0:00, 조건 미달 시 경고", () => {
  const segs = [
    { type: "intro", duration: 3 },
    { duration: 15, chapter: "공항" },
    { duration: 15, chapter: "바다" },
    { duration: 15, chapter: "바다" },
    { duration: 15, chapter: "" },
    { duration: 15, chapter: "맛집" },
  ];
  const ch = T.buildChapters(T.buildTimeline(segs, 1));
  assert.strictEqual(ch.text, "0:00 공항\n0:16 바다\n0:58 맛집");
  assert.ok(ch.valid);
  const few = T.buildChapters(T.buildTimeline([{ duration: 5, chapter: "a" }, { duration: 5, chapter: "b" }], 0));
  assert.ok(!few.valid);
  assert.strictEqual(few.warnings.length, 3); // 개수 부족 + 두 챕터 모두 10초 미만
});

test("태그 정리와 글자 수", () => {
  const tags = T.parseTags("제주, #여행 , 제주,  제주 여행,");
  assert.deepStrictEqual(tags, ["제주", "여행", "제주 여행"]);
  assert.strictEqual(T.tagsLength(tags), 2 + 2 + 7 + 2);
});

test("설명 조합", () => {
  const d = T.buildDescription({ description: "소개", chapters: "0:00 a", hashtags: "제주 여행, vlog" });
  assert.strictEqual(d, "소개\n\n0:00 a\n\n#제주여행 #vlog");
});

test("메타데이터 검사", () => {
  assert.deepStrictEqual(T.validateMeta({ title: "좋은 제목", description: "", tags: [], format: "yt1080", total: 600 }), []);
  const issues = T.validateMeta({ title: "가".repeat(101) + "<", description: "", tags: [], hashtags: new Array(61).fill("a"), format: "shorts", total: 200 });
  assert.strictEqual(issues.length, 4);
  assert.ok(T.validateMeta({ title: "", description: "", tags: [] }).length === 1);
});

test("줄바꿈: 폭을 넘지 않고 긴 단어는 글자 단위로 자른다", () => {
  const measure = (s) => [...s].length * 10;
  const lines = T.wrapText("가나다 라마바사 아자차카타파하가나다라", 60, measure);
  lines.forEach((l) => assert.ok(measure(l) <= 60, l));
  assert.strictEqual(lines.join("").replace(/\s/g, ""), "가나다라마바사아자차카타파하가나다라");
  assert.deepStrictEqual(T.wrapText("a\nb", 100, measure), ["a", "b"]);
});

test("녹화 형식: MP4 우선, 없으면 WebM", () => {
  assert.match(T.pickMimeType((m) => m.startsWith("video/mp4")), /^video\/mp4/);
  assert.strictEqual(T.pickMimeType((m) => m === "video/webm;codecs=vp8,opus"), "video/webm;codecs=vp8,opus");
  assert.strictEqual(T.pickMimeType(() => false), "");
});

// 최소 JPEG + EXIF(APP1) 만들기
function fakeJpeg(date, littleEndian, useExifIfd = true) {
  const tiff = Buffer.alloc(200);
  const w16 = (o, v) => (littleEndian ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
  const w32 = (o, v) => (littleEndian ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
  tiff.write(littleEndian ? "II" : "MM", 0, "latin1");
  w16(2, 42);
  w32(4, 8);
  w16(8, 1); // IFD0 항목 1개
  if (useExifIfd) {
    w16(10, 0x8769); w16(12, 4); w32(14, 1); w32(18, 26);
    w16(26, 1); // Exif IFD 항목 1개
    w16(28, 0x9003); w16(30, 2); w32(32, 20); w32(36, 60);
  } else {
    w16(10, 0x0132); w16(12, 2); w32(14, 20); w32(18, 60);
  }
  tiff.write(date + "\0", 60, "latin1");
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff]);
  const buf = Buffer.concat([head, app1, Buffer.from([0xff, 0xd9])]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

test("EXIF 촬영 시각 읽기", () => {
  const expect = new Date(2025, 6, 14, 9, 30, 5).getTime();
  assert.strictEqual(T.readExifDate(fakeJpeg("2025:07:14 09:30:05", true)), expect);
  assert.strictEqual(T.readExifDate(fakeJpeg("2025:07:14 09:30:05", false)), expect);
  assert.strictEqual(T.readExifDate(fakeJpeg("2025:07:14 09:30:05", true, false)), expect);
  assert.strictEqual(T.readExifDate(fakeJpeg("0000:00:00 00:00:00", true)), null);
  assert.strictEqual(T.readExifDate(new Uint8Array([1, 2, 3, 4]).buffer), null);
});
