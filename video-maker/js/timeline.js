// 타임라인 계산·챕터·메타데이터 등 화면과 무관한 순수 로직 (Node 테스트 가능)
(function (root) {
  const FORMATS = {
    "yt1080": { label: "유튜브 1080p (16:9)", w: 1920, h: 1080, bitrate: 8e6 },
    "yt720": { label: "유튜브 720p (16:9)", w: 1280, h: 720, bitrate: 5e6 },
    "shorts": { label: "쇼츠 (9:16, 1080×1920)", w: 1080, h: 1920, bitrate: 8e6 },
  };

  // 유튜브 고객센터 기준 제한값
  const LIMITS = {
    titleMax: 100,        // 제목 최대 100자
    descMax: 5000,        // 설명 최대 5,000자
    tagsMax: 500,         // 태그 합계 최대 500자
    shortsMaxSec: 180,    // 쇼츠 최대 3분
    chapterMinCount: 3,   // 챕터 최소 3개
    chapterMinSec: 10,    // 챕터당 최소 10초
    hashtagsMax: 60,      // 해시태그가 60개를 넘으면 모두 무시됨
  };

  // 전환 시간은 가장 짧은 구간 길이의 절반을 넘을 수 없다
  function effectiveTransition(segments, transition) {
    if (segments.length < 2 || !transition) return 0;
    const minDur = Math.min(...segments.map((s) => s.duration));
    return Math.max(0, Math.min(transition, minDur / 2));
  }

  // segments: [{duration, ...}] → 시작 시간을 붙인 목록과 전체 길이
  function buildTimeline(segments, transition) {
    const t = effectiveTransition(segments, transition);
    let cursor = 0;
    const items = segments.map((s, i) => {
      const item = Object.assign({}, s, { index: i, start: cursor, end: cursor + s.duration });
      cursor += s.duration - t;
      return item;
    });
    const total = items.length ? items[items.length - 1].end : 0;
    return { items, total, transition: t };
  }

  // 시각 time에 보여야 할 구간들과 각 구간의 전환 진행도(0~1)
  function activeAt(timeline, time) {
    const { items, transition } = timeline;
    const out = [];
    for (const it of items) {
      if (time < it.start || time >= it.end) continue;
      const local = time - it.start;
      let fadeIn = 1;
      if (transition > 0 && it.index > 0 && local < transition) fadeIn = local / transition;
      out.push({ item: it, local, fadeIn });
    }
    if (!out.length && items.length && time >= timeline.total) {
      const last = items[items.length - 1];
      out.push({ item: last, local: last.duration, fadeIn: 1 });
    }
    return out;
  }

  // 켄 번즈(천천히 확대·이동) 효과: 진행도 p(0~1)에 따른 배율과 이동량
  function kenBurns(index, p) {
    const e = p * p * (3 - 2 * p); // smoothstep
    const zoomIn = index % 2 === 0;
    const scale = zoomIn ? 1 + 0.12 * e : 1.12 - 0.12 * e;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const [dx, dy] = dirs[index % 4];
    return { scale, dx: dx * 0.03 * (e - 0.5), dy: dy * 0.03 * (e - 0.5) };
  }

  // 원본(sw×sh)을 대상(dw×dh)에 cover/contain으로 맞출 때의 그리기 영역
  function fitRect(sw, sh, dw, dh, mode) {
    const r = mode === "contain" ? Math.min(dw / sw, dh / sh) : Math.max(dw / sw, dh / sh);
    const w = sw * r, h = sh * r;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
  }

  function formatTime(sec, withHours) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 || withHours ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // 캡션이 있는 구간을 챕터로. 첫 챕터는 0:00에서 시작해야 한다.
  function buildChapters(timeline) {
    const marks = [];
    for (const it of timeline.items) {
      const label = (it.chapter || "").trim();
      if (!label) continue;
      if (marks.length && marks[marks.length - 1].label === label) continue;
      marks.push({ time: marks.length ? it.start : 0, label });
    }
    const warnings = [];
    if (marks.length < LIMITS.chapterMinCount) {
      warnings.push(`챕터가 ${LIMITS.chapterMinCount}개 이상이어야 유튜브에 표시됩니다 (현재 ${marks.length}개).`);
    }
    marks.forEach((m, i) => {
      const next = i + 1 < marks.length ? marks[i + 1].time : timeline.total;
      if (next - m.time < LIMITS.chapterMinSec) {
        warnings.push(`"${m.label}" 챕터가 ${LIMITS.chapterMinSec}초보다 짧습니다.`);
      }
    });
    const withHours = timeline.total >= 3600;
    const text = marks.map((m) => `${formatTime(m.time, withHours)} ${m.label}`).join("\n");
    return { marks, text, warnings, valid: warnings.length === 0 && marks.length > 0 };
  }

  function parseTags(input) {
    const seen = new Set();
    return String(input || "")
      .split(/[,\n]/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  }

  // 태그 글자 수: 공백이 들어간 태그는 따옴표가 붙어 계산되고, 태그 사이 쉼표도 센다
  function tagsLength(tags) {
    return tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);
  }

  function buildDescription({ description, chapters, hashtags }) {
    const parts = [];
    if (description && description.trim()) parts.push(description.trim());
    if (chapters && chapters.trim()) parts.push(chapters.trim());
    const hs = parseTags(hashtags).map((h) => "#" + h.replace(/\s+/g, ""));
    if (hs.length) parts.push(hs.join(" "));
    return parts.join("\n\n");
  }

  function validateMeta({ title, description, tags, hashtags, format, total }) {
    const issues = [];
    const len = (s) => [...(s || "")].length;
    if (!title || !title.trim()) issues.push("제목을 입력하세요.");
    if (len(title) > LIMITS.titleMax) issues.push(`제목이 ${LIMITS.titleMax}자를 넘습니다 (${len(title)}자).`);
    if (/[<>]/.test(title || "") || /[<>]/.test(description || "")) issues.push("제목·설명에는 < > 문자를 쓸 수 없습니다.");
    if (len(description) > LIMITS.descMax) issues.push(`설명이 ${LIMITS.descMax}자를 넘습니다 (${len(description)}자).`);
    if (tagsLength(tags || []) > LIMITS.tagsMax) issues.push(`태그 합계가 ${LIMITS.tagsMax}자를 넘습니다.`);
    if ((hashtags || []).length > LIMITS.hashtagsMax) issues.push(`해시태그가 ${LIMITS.hashtagsMax}개를 넘으면 유튜브가 모두 무시합니다.`);
    if (format === "shorts" && total > LIMITS.shortsMaxSec) {
      issues.push(`쇼츠는 ${LIMITS.shortsMaxSec / 60}분 이하여야 합니다 (현재 ${formatTime(total)}).`);
    }
    return issues;
  }

  // 긴 문장을 폭에 맞춰 줄바꿈. measure(text) → 픽셀 폭
  function wrapText(text, maxWidth, measure) {
    const lines = [];
    for (const para of String(text).split("\n")) {
      const tokens = para.match(/\S+\s*|\s+/g) || [""];
      let line = "";
      for (const tok of tokens) {
        if (measure((line + tok).trimEnd()) <= maxWidth) { line += tok; continue; }
        if (line.trim()) { lines.push(line.trimEnd()); line = ""; }
        const word = line ? tok : tok.trimStart();
        if (measure(word.trimEnd()) <= maxWidth) { line = word; continue; }
        // 띄어쓰기 없는 긴 단어는 글자 단위로 자른다
        for (const ch of word) {
          if (measure((line + ch).trimEnd()) > maxWidth && line) { lines.push(line.trimEnd()); line = ""; }
          line += ch;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  // JPEG의 EXIF에서 촬영 시각(DateTimeOriginal, 없으면 DateTime)을 읽는다. 실패하면 null
  function readExifDate(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      const marker = v.getUint16(p);
      const size = v.getUint16(p + 2);
      if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      p += 2 + size;
    }
    return null;
  }

  function parseTiff(v, tiff) {
    try {
      const le = v.getUint16(tiff) === 0x4949;
      const u16 = (o) => v.getUint16(tiff + o, le);
      const u32 = (o) => v.getUint32(tiff + o, le);
      const readIfd = (off) => {
        const tags = {};
        const n = u16(off);
        for (let i = 0; i < n; i++) {
          const e = off + 2 + i * 12;
          tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8) };
        }
        return tags;
      };
      const ascii = (t) => {
        if (!t || t.type !== 2 || t.count < 19) return "";
        let s = "";
        for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(tiff + t.value + i));
        return s;
      };
      const ifd0 = readIfd(u32(4));
      let str = "";
      if (ifd0[0x8769]) str = ascii(readIfd(ifd0[0x8769].value)[0x9003]);
      if (!str) str = ascii(ifd0[0x0132]);
      const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
      if (!m) return null;
      const d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
      return isFinite(d) && +m[1] > 1900 ? d : null;
    } catch (e) { return null; }
  }

  function pickMimeType(isSupported) {
    const candidates = [
      "video/mp4;codecs=avc1.640028,mp4a.40.2",
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return candidates.find((c) => isSupported(c)) || "";
  }

  const api = { FORMATS, LIMITS, effectiveTransition, buildTimeline, activeAt, kenBurns, fitRect,
    formatTime, buildChapters, parseTags, tagsLength, buildDescription, validateMeta, wrapText, readExifDate, pickMimeType };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Timeline = api;
})(typeof window !== "undefined" ? window : globalThis);
