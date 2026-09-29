// 사진·동영상 → 유튜브 영상 편집기. 모든 처리는 브라우저 안에서만 이뤄진다.
(function () {
  const T = window.Timeline;
  const $ = (id) => document.getElementById(id);
  const FONT = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";
  const MAX_IMAGE_SIDE = 2600; // 큰 사진은 줄여서 메모리·속도 확보
  const FPS = 30;

  const state = {
    clips: [],
    bgm: null,
    timeline: T.buildTimeline([], 0),
    t: 0,
    playing: false,
    wall0: 0,
    t0: 0,
    exporting: null,
    thumbSrc: null,
    chaptersEdited: false,
    nextId: 1,
  };
  const audio = { ctx: null, master: null, dest: null, bgmGain: null };

  const canvas = $("preview");
  const ctx = canvas.getContext("2d");
  const small = document.createElement("canvas"); // 흐린 배경용 축소 캔버스
  const smallCtx = small.getContext("2d");

  // ---------- 설정 ----------
  const SETTING_IDS = ["format", "photo-dur", "transition", "trans-dur", "fit", "kenburns", "intro-title", "intro-sub",
    "intro-dur", "outro-text", "outro-dur", "card-bg", "card-fg", "cap-pos", "cap-size", "cap-style", "bgm-vol",
    "clip-vol", "duck", "thumb-color", "thumb-stroke", "thumb-pos", "thumb-dim"];
  const STORE_KEY = "video-maker-settings";

  for (const [key, f] of Object.entries(T.FORMATS)) {
    $("format").add(new Option(f.label, key));
  }

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (e) { /* 저장소 사용 불가 */ }
    for (const id of SETTING_IDS) {
      if (!(id in saved)) continue;
      const el = $(id);
      if (el.type === "checkbox") el.checked = saved[id];
      else el.value = saved[id];
    }
  }
  function saveSettings() {
    const out = {};
    for (const id of SETTING_IDS) {
      const el = $(id);
      out[id] = el.type === "checkbox" ? el.checked : el.value;
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (e) { /* 무시 */ }
  }
  const num = (id, def) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : def; };

  function settings() {
    return {
      format: $("format").value,
      photoDur: num("photo-dur", 4),
      transition: $("transition").value,
      transDur: $("transition").value === "none" ? 0 : num("trans-dur", 0.8),
      fit: $("fit").value,
      kenburns: $("kenburns").checked,
      introTitle: $("intro-title").value.trim(),
      introSub: $("intro-sub").value.trim(),
      introDur: num("intro-dur", 3),
      outroText: $("outro-text").value.trim(),
      outroDur: num("outro-dur", 3),
      cardBg: $("card-bg").value,
      cardFg: $("card-fg").value,
      capPos: $("cap-pos").value,
      capSize: parseFloat($("cap-size").value),
      capStyle: $("cap-style").value,
      bgmVol: parseFloat($("bgm-vol").value),
      clipVol: parseFloat($("clip-vol").value),
      duck: $("duck").checked,
    };
  }

  // ---------- 타임라인 ----------
  function clipDuration(c, s) {
    if (c.kind === "image") return c.dur > 0 ? c.dur : s.photoDur;
    return Math.max(0.5, c.trimEnd - c.trimStart);
  }

  function rebuild() {
    const s = settings();
    const segs = [];
    if (s.introTitle) segs.push({ type: "intro", duration: s.introDur });
    for (const c of state.clips) {
      segs.push({ type: "clip", clip: c, duration: clipDuration(c, s), chapter: c.chapter ? c.caption : "" });
    }
    if (s.outroText && state.clips.length) segs.push({ type: "outro", duration: s.outroDur });
    state.timeline = T.buildTimeline(segs, s.transDur);
    const f = T.FORMATS[s.format];
    if (canvas.width !== f.w || canvas.height !== f.h) { canvas.width = f.w; canvas.height = f.h; }
    small.width = Math.max(16, Math.round(f.w / 24));
    small.height = Math.max(16, Math.round(f.h / 24));
    state.t = Math.min(state.t, state.timeline.total);
    updateSummary();
    updateMeta();
    saveSettings();
    requestRender();
  }

  function updateSummary() {
    const n = state.clips.filter((c) => c.kind === "image").length;
    const m = state.clips.length - n;
    const total = state.timeline.total;
    let text = state.clips.length ? `사진 ${n}장 · 동영상 ${m}개 · 전체 ${T.formatTime(total)}` : "";
    if ($("format").value === "shorts" && total > T.LIMITS.shortsMaxSec) text += " ⚠ 쇼츠는 3분 이하여야 합니다";
    $("summary").textContent = text;
    $("export-start").disabled = !state.clips.length || !!state.exporting;
  }

  // ---------- 그리기 ----------
  let renderQueued = false;
  function requestRender() {
    if (renderQueued || state.playing) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  function sourceSize(c) {
    if (c.kind === "video") return [c.el.videoWidth || c.w, c.el.videoHeight || c.h];
    return [c.src.width, c.src.height];
  }

  function drawBlurBg(src, sw, sh, W, H) {
    const r = T.fitRect(sw, sh, small.width, small.height, "cover");
    smallCtx.drawImage(src, r.x, r.y, r.w, r.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, H);
  }

  function drawClip(item, local, s, W, H) {
    const c = item.clip;
    const src = c.kind === "video" ? c.el : c.src;
    const [sw, sh] = sourceSize(c);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (!sw || !sh) return;
    if (s.fit === "blur") drawBlurBg(src, sw, sh, W, H);
    const r = T.fitRect(sw, sh, W, H, s.fit === "cover" ? "cover" : "contain");
    if (c.kind === "image" && s.kenburns) {
      const k = T.kenBurns(item.index, Math.min(1, local / item.duration));
      const w = r.w * k.scale, h = r.h * k.scale;
      r.x -= (w - r.w) / 2 - k.dx * W;
      r.y -= (h - r.h) / 2 - k.dy * H;
      r.w = w; r.h = h;
    }
    ctx.drawImage(src, r.x, r.y, r.w, r.h);
    if (c.caption && !s.noCaption) drawCaption(c.caption, s, W, H);
  }

  function drawCaption(text, s, W, H) {
    const size = Math.round(Math.min(W, H) * s.capSize);
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = T.wrapText(text, W * 0.84, (x) => ctx.measureText(x).width);
    const lh = size * 1.3;
    const block = lines.length * lh;
    const shorts = H > W;
    let top;
    if (s.capPos === "top") top = H * (shorts ? 0.12 : 0.07);
    else if (s.capPos === "middle") top = (H - block) / 2;
    else top = H - block - H * (shorts ? 0.2 : 0.07);
    if (s.capStyle === "box") {
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const pad = size * 0.4;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect((W - widest) / 2 - pad, top - pad * 0.5, widest + pad * 2, block + pad, size * 0.25);
      ctx.fill();
    }
    lines.forEach((l, i) => {
      const y = top + lh * (i + 0.5);
      if (s.capStyle === "outline") {
        ctx.lineWidth = size * 0.16;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#000";
        ctx.strokeText(l, W / 2, y);
      }
      ctx.fillStyle = "#fff";
      ctx.fillText(l, W / 2, y);
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard(item, local, s, W, H) {
    ctx.fillStyle = s.cardBg;
    ctx.fillRect(0, 0, W, H);
    const appear = Math.min(1, local / 0.7);
    const e = appear * appear * (3 - 2 * appear);
    const base = Math.min(W, H);
    ctx.save();
    ctx.globalAlpha *= e;
    ctx.translate(0, (1 - e) * base * 0.03);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = s.cardFg;
    const mainText = item.type === "intro" ? s.introTitle : s.outroText;
    const size = Math.round(base * (item.type === "intro" ? 0.09 : 0.065));
    ctx.font = `800 ${size}px ${FONT}`;
    const lines = T.wrapText(mainText, W * 0.84, (x) => ctx.measureText(x).width);
    const sub = item.type === "intro" ? s.introSub : "";
    const subSize = Math.round(base * 0.045);
    const lh = size * 1.25;
    const blockH = lines.length * lh + (sub ? subSize * 2 : 0);
    let y = (H - blockH) / 2 + lh / 2;
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += lh; }
    if (sub) {
      ctx.font = `500 ${subSize}px ${FONT}`;
      ctx.globalAlpha *= 0.8;
      ctx.fillText(sub, W / 2, y + subSize * 0.5);
    }
    ctx.restore();
  }

  function drawSegment(a, s, W, H) {
    if (a.item.type === "clip") drawClip(a.item, a.local, s, W, H);
    else drawCard(a.item, a.local, s, W, H);
  }

  function render(opts) {
    const s = Object.assign(settings(), opts);
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const act = T.activeAt(state.timeline, state.t);
    if (!act.length) {
      ctx.fillStyle = "#777";
      ctx.font = `500 ${Math.round(Math.min(W, H) * 0.045)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("사진이나 동영상을 추가하세요", W / 2, H / 2);
    } else if (act.length === 1) {
      drawSegment(act[0], s, W, H);
    } else {
      const [a, b] = act;
      const p = b.fadeIn;
      if (s.transition === "slide") {
        const e = p * p * (3 - 2 * p);
        ctx.save(); ctx.translate(-e * W, 0); drawSegment(a, s, W, H); ctx.restore();
        ctx.save(); ctx.translate((1 - e) * W, 0); drawSegment(b, s, W, H); ctx.restore();
      } else if (s.transition === "black") {
        if (p < 0.5) { ctx.globalAlpha = 1 - p * 2; drawSegment(a, s, W, H); }
        else { ctx.globalAlpha = p * 2 - 1; drawSegment(b, s, W, H); }
      } else {
        drawSegment(a, s, W, H);
        ctx.globalAlpha = p;
        drawSegment(b, s, W, H);
      }
    }
    ctx.restore();
    syncMedia(act, s);
    updateClock();
  }

  // ---------- 오디오·동영상 동기화 ----------
  function ensureAudio() {
    if (audio.ctx) { if (audio.ctx.state === "suspended") audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.connect(audio.ctx.destination);
    if (audio.ctx.createMediaStreamDestination) {
      audio.dest = audio.ctx.createMediaStreamDestination();
      audio.master.connect(audio.dest);
    }
    state.clips.forEach(connectClipAudio);
    if (state.bgm) connectBgm();
  }

  function connectClipAudio(c) {
    if (!audio.ctx || c.kind !== "video" || c.gain) return;
    try {
      const src = audio.ctx.createMediaElementSource(c.el);
      c.gain = audio.ctx.createGain();
      c.gain.gain.value = 0;
      src.connect(c.gain).connect(audio.master);
    } catch (e) { console.warn("동영상 소리 연결 실패", e); }
  }

  function connectBgm() {
    if (!audio.ctx || state.bgm.gain) return;
    const src = audio.ctx.createMediaElementSource(state.bgm.el);
    state.bgm.gain = audio.ctx.createGain();
    state.bgm.gain.gain.value = 0;
    src.connect(state.bgm.gain).connect(audio.master);
  }

  function setGain(node, v) {
    if (!node || !audio.ctx) return;
    node.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.04);
  }

  function syncMedia(act, s) {
    const t = state.t;
    const weights = new Map();
    act.forEach((a, i) => {
      const w = act.length === 2 ? (i === 0 ? 1 - act[1].fadeIn : act[1].fadeIn) : 1;
      weights.set(a.item, w);
    });
    let videoSound = false;
    for (const it of state.timeline.items) {
      if (it.type !== "clip" || it.clip.kind !== "video") continue;
      const c = it.clip, el = c.el;
      const active = weights.has(it);
      const expected = c.trimStart + Math.min(Math.max(t - it.start, 0), it.duration);
      const drift = Math.abs(el.currentTime - expected);
      if (active && state.playing) {
        if (el.paused) {
          if (drift > 0.15) el.currentTime = expected;
          el.play().catch(() => {});
        } else if (drift > 0.35) el.currentTime = expected;
      } else {
        if (!el.paused) el.pause();
        const upcoming = it.start - t > 0 && it.start - t < 2;
        if ((active || upcoming) && !el.seeking && drift > 0.04) el.currentTime = expected;
      }
      const vol = active && !c.mute && state.playing ? s.clipVol * weights.get(it) : 0;
      if (vol > 0.05) videoSound = true;
      setGain(c.gain, vol);
    }
    const b = state.bgm;
    if (b) {
      const total = state.timeline.total;
      if (state.playing && total > 0) {
        const expected = t % b.duration;
        if (b.el.paused) { b.el.currentTime = expected; b.el.play().catch(() => {}); }
        else if (Math.abs(b.el.currentTime - expected) > 0.5 && b.el.currentTime < b.duration - 0.5) b.el.currentTime = expected;
      } else if (!b.el.paused) b.el.pause();
      const env = Math.min(1, t / 1, Math.max(0, (total - t) / 2)); // 앞 1초 페이드인, 끝 2초 페이드아웃
      const duck = s.duck && videoSound ? 0.25 : 1;
      setGain(b.gain, state.playing ? s.bgmVol * env * duck : 0);
    }
  }

  // ---------- 재생 ----------
  function play() {
    if (!state.timeline.total) return;
    ensureAudio();
    if (state.t >= state.timeline.total) state.t = 0;
    state.playing = true;
    state.t0 = state.t;
    state.wall0 = performance.now();
    $("play").textContent = "❚❚";
    requestAnimationFrame(tick);
  }

  function pause() {
    state.playing = false;
    $("play").textContent = "▶";
    render();
  }

  function seek(t) {
    state.t = Math.max(0, Math.min(t, state.timeline.total));
    state.t0 = state.t;
    state.wall0 = performance.now();
    if (!state.playing) requestRender();
  }

  function tick(now) {
    if (!state.playing) return;
    state.t = state.t0 + (now - state.wall0) / 1000;
    const total = state.timeline.total;
    if (state.t >= total) {
      state.t = total;
      render();
      state.playing = false;
      $("play").textContent = "▶";
      syncMedia([], settings());
      if (state.exporting) finishExport();
      return;
    }
    render();
    if (state.exporting) $("export-progress").value = state.t / total;
    requestAnimationFrame(tick);
  }

  function updateClock() {
    const total = state.timeline.total;
    $("clock").textContent = `${T.formatTime(state.t)} / ${T.formatTime(total)}`;
    if (document.activeElement !== $("seek")) $("seek").value = total ? Math.round((state.t / total) * 1000) : 0;
  }

  $("play").onclick = () => (state.playing ? pause() : play());
  $("seek").oninput = (e) => seek((e.target.value / 1000) * state.timeline.total);
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || state.exporting) return;
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    state.playing ? pause() : play();
  });

  // ---------- 파일 불러오기 ----------
  async function addFiles(files) {
    const list = [...files].filter((f) => /^(image|video)\//.test(f.type) || /\.(heic|mov|mkv)$/i.test(f.name));
    if (!list.length) return;
    $("summary").textContent = `${list.length}개 파일 불러오는 중…`;
    const failed = [];
    for (const f of list) {
      try { state.clips.push(await loadClip(f)); }
      catch (e) { failed.push(f.name); }
    }
    if (failed.length) alert(`이 브라우저에서 열 수 없는 파일이 있습니다:\n${failed.join("\n")}\n\n(아이폰 HEIC 사진은 JPG로 변환하거나 사파리를 이용하세요.)`);
    renderList();
    rebuild();
  }

  async function loadClip(file) {
    const url = URL.createObjectURL(file);
    const base = { id: state.nextId++, file, name: file.name, caption: "", chapter: false, date: file.lastModified };
    if (file.type.startsWith("video/") || /\.(mov|mkv)$/i.test(file.name)) {
      const el = document.createElement("video");
      el.preload = "auto";
      el.playsInline = true;
      el.src = url;
      await new Promise((ok, fail) => { el.onloadedmetadata = ok; el.onerror = fail; });
      let d = el.duration;
      if (!isFinite(d)) d = 10;
      el.addEventListener("seeked", requestRender);
      const c = Object.assign(base, { kind: "video", el, url, w: el.videoWidth, h: el.videoHeight,
        srcDuration: d, trimStart: 0, trimEnd: d, mute: false });
      c.thumb = await videoThumb(el, Math.min(0.5, d / 2));
      connectClipAudio(c);
      return c;
    }
    const img = new Image();
    img.src = url;
    await img.decode();
    const exif = file.type === "image/jpeg" ? T.readExifDate(await file.slice(0, 256 * 1024).arrayBuffer()) : null;
    if (exif) base.date = exif;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const src = document.createElement("canvas");
    src.width = Math.round(img.naturalWidth * scale);
    src.height = Math.round(img.naturalHeight * scale);
    src.getContext("2d").drawImage(img, 0, 0, src.width, src.height);
    URL.revokeObjectURL(url);
    return Object.assign(base, { kind: "image", src, w: src.width, h: src.height, dur: 0, thumb: makeThumb(src) });
  }

  function makeThumb(src) {
    const c = document.createElement("canvas");
    c.width = 192; c.height = 128;
    const r = T.fitRect(src.videoWidth || src.width, src.videoHeight || src.height, 192, 128, "cover");
    c.getContext("2d").drawImage(src, r.x, r.y, r.w, r.h);
    return c.toDataURL("image/jpeg", 0.7);
  }

  function videoThumb(el, at) {
    return new Promise((ok) => {
      const done = () => { el.removeEventListener("seeked", done); try { ok(makeThumb(el)); } catch (e) { ok(""); } };
      el.addEventListener("seeked", done);
      el.currentTime = at;
      setTimeout(done, 3000);
    });
  }

  const drop = $("drop");
  $("files").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  drop.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); drop.classList.add("over"); } });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
  // 드롭 영역 밖에 파일을 떨어뜨려도 브라우저가 파일을 열어 버리지 않도록
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => { if (hasFiles(e)) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
  function hasFiles(e) { return e.dataTransfer && [...e.dataTransfer.types].includes("Files"); }

  // ---------- 클립 목록 ----------
  function removeClip(c) {
    if (c.el) { c.el.pause(); c.el.removeAttribute("src"); c.el.load(); }
    if (c.url) URL.revokeObjectURL(c.url);
    state.clips = state.clips.filter((x) => x !== c);
  }

  function renderList() {
    const ol = $("clips");
    ol.textContent = "";
    const s = settings();
    state.clips.forEach((c, i) => {
      const li = document.createElement("li");
      li.className = "clip";
      li.dataset.id = c.id;
      li.innerHTML = `
        <span class="handle" title="끌어서 순서 바꾸기">⠿</span>
        <img class="thumbnail" alt="" title="이 장면으로 이동">
        <div class="body">
          <div class="row">
            <span class="badge"></span><span class="name"></span>
            <span class="actions">
              <button data-act="up" title="위로">↑</button>
              <button data-act="down" title="아래로">↓</button>
              <button data-act="del" title="삭제">✕</button>
            </span>
          </div>
          <div class="row timing"></div>
          <input type="text" data-f="caption" placeholder="자막 (비워 두면 표시 안 함)" maxlength="120">
          <div class="row"><label><input type="checkbox" data-f="chapter"> 이 자막을 유튜브 챕터 제목으로 쓰기</label></div>
        </div>`;
      li.querySelector(".thumbnail").src = c.thumb || "";
      li.querySelector(".badge").textContent = `${i + 1} · ${c.kind === "image" ? "사진" : "동영상"}`;
      li.querySelector(".name").textContent = c.name;
      li.querySelector("[data-f=caption]").value = c.caption;
      li.querySelector("[data-f=chapter]").checked = c.chapter;
      const timing = li.querySelector(".timing");
      if (c.kind === "image") {
        timing.innerHTML = `<label>길이 <input type="number" data-f="dur" min="0.5" max="60" step="0.5"> 초</label>`;
        const d = timing.querySelector("input");
        d.placeholder = s.photoDur;
        if (c.dur > 0) d.value = c.dur;
      } else {
        timing.innerHTML = `
          <label>시작 <input type="number" data-f="trimStart" min="0" step="0.1"> 초</label>
          <label>끝 <input type="number" data-f="trimEnd" min="0" step="0.1"> 초</label>
          <span class="note"></span>
          <label><input type="checkbox" data-f="mute"> 원본 소리 끄기</label>`;
        timing.querySelector("[data-f=trimStart]").value = +c.trimStart.toFixed(1);
        timing.querySelector("[data-f=trimEnd]").value = +c.trimEnd.toFixed(1);
        timing.querySelector("[data-f=trimEnd]").max = c.srcDuration.toFixed(1);
        timing.querySelector(".note").textContent = `(원본 ${T.formatTime(c.srcDuration)})`;
        timing.querySelector("[data-f=mute]").checked = c.mute;
      }
      ol.appendChild(li);
    });
  }

  function clipOf(el) {
    const li = el.closest(".clip");
    return li && state.clips.find((c) => c.id === +li.dataset.id);
  }

  $("clips").addEventListener("click", (e) => {
    const c = clipOf(e.target);
    if (!c) return;
    if (e.target.classList.contains("thumbnail")) {
      const it = state.timeline.items.find((x) => x.clip === c);
      if (it) seek(it.start + Math.min(state.timeline.transition, it.duration / 2));
      return;
    }
    const act = e.target.dataset.act;
    if (!act) return;
    const i = state.clips.indexOf(c);
    if (act === "del") removeClip(c);
    else {
      const j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= state.clips.length) return;
      [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
    }
    renderList();
    rebuild();
  });

  $("clips").addEventListener("input", (e) => {
    const c = clipOf(e.target);
    const f = e.target.dataset.f;
    if (!c || !f) return;
    if (f === "caption") c.caption = e.target.value;
    else if (f === "chapter") c.chapter = e.target.checked;
    else if (f === "mute") c.mute = e.target.checked;
    else if (f === "dur") c.dur = parseFloat(e.target.value) || 0;
    else if (f === "trimStart" || f === "trimEnd") {
      const v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      if (f === "trimStart") c.trimStart = Math.max(0, Math.min(v, c.trimEnd - 0.5));
      else c.trimEnd = Math.min(c.srcDuration, Math.max(v, c.trimStart + 0.5));
    }
    rebuild();
  });

  // 끌어서 순서 바꾸기 (손잡이를 잡았을 때만)
  let dragging = null;
  $("clips").addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("handle")) e.target.closest(".clip").draggable = true;
  });
  $("clips").addEventListener("dragstart", (e) => {
    dragging = e.target.closest(".clip");
    if (!dragging) return;
    dragging.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragging.dataset.id);
  });
  $("clips").addEventListener("dragover", (e) => {
    if (!dragging) return;
    e.preventDefault();
    document.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before"));
    const li = e.target.closest(".clip");
    if (li && li !== dragging) li.classList.add("drop-before");
  });
  $("clips").addEventListener("drop", (e) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target.closest(".clip");
    const from = state.clips.find((c) => c.id === +dragging.dataset.id);
    if (target && target !== dragging) {
      state.clips.splice(state.clips.indexOf(from), 1);
      const to = state.clips.findIndex((c) => c.id === +target.dataset.id);
      state.clips.splice(to, 0, from);
    }
  });
  $("clips").addEventListener("dragend", () => {
    if (dragging) { dragging.draggable = false; dragging = null; }
    renderList();
    rebuild();
  });

  $("sort-date").onclick = () => { state.clips.sort((a, b) => a.date - b.date); renderList(); rebuild(); };
  $("shuffle").onclick = () => {
    for (let i = state.clips.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
    }
    renderList(); rebuild();
  };
  $("clear").onclick = () => {
    if (!state.clips.length || !confirm("추가한 사진·동영상을 모두 목록에서 뺄까요? (원본 파일은 지워지지 않습니다)")) return;
    pause();
    [...state.clips].forEach(removeClip);
    state.t = 0;
    renderList(); rebuild();
  };

  // ---------- 배경 음악 ----------
  $("bgm").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    clearBgm();
    const el = new Audio();
    el.preload = "auto";
    el.src = URL.createObjectURL(f);
    try { await new Promise((ok, fail) => { el.onloadedmetadata = ok; el.onerror = fail; }); }
    catch (err) { alert("이 음악 파일을 열 수 없습니다."); return; }
    el.loop = true;
    state.bgm = { el, duration: isFinite(el.duration) ? el.duration : 1e9 };
    if (audio.ctx) connectBgm();
  };
  function clearBgm() {
    if (!state.bgm) return;
    state.bgm.el.pause();
    URL.revokeObjectURL(state.bgm.el.src);
    if (state.bgm.gain) state.bgm.gain.disconnect();
    state.bgm = null;
  }
  $("bgm-clear").onclick = () => { clearBgm(); $("bgm").value = ""; };

  // ---------- 설정 변경 ----------
  for (const id of SETTING_IDS) {
    if (id.startsWith("thumb-")) continue;
    $(id).addEventListener("input", () => {
      if (id === "photo-dur") renderList();
      rebuild();
    });
  }

  // ---------- 탭 ----------
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.onclick = () => {
      if (state.exporting && b.dataset.view !== "export") return;
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
      document.querySelectorAll("main > section[id^=view-]").forEach((s) => (s.hidden = s.id !== "view-" + b.dataset.view));
      if (b.dataset.view === "meta") updateMeta();
      if (b.dataset.view === "thumb") drawThumb();
    };
  });

  // ---------- 내보내기 ----------
  function waitSeeked(el, timeout) {
    return new Promise((ok) => {
      if (!el.seeking) return ok();
      const done = () => { el.removeEventListener("seeked", done); ok(); };
      el.addEventListener("seeked", done);
      setTimeout(done, timeout);
    });
  }

  async function startExport() {
    if (!state.clips.length || state.exporting) return;
    if (!window.MediaRecorder || !canvas.captureStream) {
      alert("이 브라우저는 영상 녹화를 지원하지 않습니다. 최신 크롬·엣지·파이어폭스·사파리를 이용하세요.");
      return;
    }
    const mime = T.pickMimeType((m) => MediaRecorder.isTypeSupported(m));
    ensureAudio();
    pause();
    seek(0);
    render();
    await Promise.all(state.clips.filter((c) => c.kind === "video").map((c) => waitSeeked(c.el, 3000)));

    const fmt = T.FORMATS[$("format").value];
    const tracks = canvas.captureStream(FPS).getVideoTracks();
    if (audio.dest) tracks.push(...audio.dest.stream.getAudioTracks());
    const opts = { videoBitsPerSecond: fmt.bitrate, audioBitsPerSecond: 192000 };
    if (mime) opts.mimeType = mime;
    let rec;
    try { rec = new MediaRecorder(new MediaStream(tracks), opts); }
    catch (e) { alert("녹화를 시작할 수 없습니다: " + e.message); return; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const job = state.exporting;
      state.exporting = null;
      setExportUi(false);
      if (!job || job.cancelled) { $("export-info").textContent = "취소했습니다."; return; }
      const type = rec.mimeType || mime || "video/webm";
      const blob = new Blob(chunks, { type });
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const url = URL.createObjectURL(blob);
      if ($("result-link").href) URL.revokeObjectURL($("result-link").href);
      $("result-video").src = url;
      $("result-link").href = url;
      $("result-link").download = `${safeName($("intro-title").value || "my-video")}.${ext}`;
      $("result-size").textContent = `${ext.toUpperCase()} · ${(blob.size / 1048576).toFixed(1)}MB · ${T.formatTime(state.timeline.total)}`;
      $("export-result").hidden = false;
      $("export-info").textContent = "완성! 파일을 받아 유튜브 스튜디오에서 업로드하세요.";
    };
    state.exporting = { rec, cancelled: false };
    setExportUi(true);
    $("export-info").textContent = `녹화 중… (${fmt.w}×${fmt.h}, ${(mime || "기본 형식").split(";")[0]})`;
    rec.start(1000);
    play();
  }

  function finishExport() {
    const job = state.exporting;
    if (!job) return;
    $("export-progress").value = 1;
    setTimeout(() => { if (job.rec.state !== "inactive") job.rec.stop(); }, 300); // 마지막 프레임까지 담기
  }

  function setExportUi(on) {
    $("export-start").disabled = on;
    $("export-cancel").hidden = !on;
    $("export-progress").hidden = !on;
    $("export-progress").value = 0;
    $("view-edit").inert = on;
    $("play").disabled = on;
    $("seek").disabled = on;
    if (on) $("export-result").hidden = true;
  }

  $("export-start").onclick = startExport;
  $("export-cancel").onclick = () => {
    if (!state.exporting) return;
    state.exporting.cancelled = true;
    pause();
    state.exporting.rec.stop();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.exporting) $("export-info").textContent = "⚠ 탭이 가려져 있으면 녹화가 끊길 수 있습니다. 이 탭으로 돌아와 주세요.";
  });

  function safeName(s) { return s.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 60) || "video"; }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- 썸네일 ----------
  const thumb = $("thumb");
  const tctx = thumb.getContext("2d");

  function drawThumb() {
    const W = thumb.width, H = thumb.height;
    tctx.fillStyle = "#222";
    tctx.fillRect(0, 0, W, H);
    const src = state.thumbSrc;
    if (src) {
      const r = T.fitRect(src.width, src.height, W, H, "cover");
      tctx.drawImage(src, r.x, r.y, r.w, r.h);
    } else {
      tctx.fillStyle = "#888";
      tctx.font = `500 40px ${FONT}`;
      tctx.textAlign = "center";
      tctx.textBaseline = "middle";
      tctx.fillText("‘현재 장면 가져오기’를 누르세요", W / 2, H / 2);
    }
    const pos = $("thumb-pos").value;
    const dim = parseFloat($("thumb-dim").value);
    tctx.fillStyle = `rgba(0,0,0,${dim})`;
    tctx.fillRect(0, 0, W, H);
    const g = pos === "right" ? tctx.createLinearGradient(W, 0, W * 0.3, H * 0.7)
      : pos === "left" ? tctx.createLinearGradient(0, H, W * 0.7, H * 0.3)
      : tctx.createLinearGradient(0, H / 2, 0, H);
    g.addColorStop(0, `rgba(0,0,0,${Math.min(0.85, dim + 0.35)})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    tctx.fillStyle = g;
    tctx.fillRect(0, 0, W, H);

    const text = $("thumb-text").value.trim();
    const sub = $("thumb-sub").value.trim();
    const color = $("thumb-color").value, stroke = $("thumb-stroke").value;
    const maxW = W * (pos === "center" ? 0.88 : 0.75);
    const margin = 60;
    let size = 170, lines = [];
    const measure = (x) => tctx.measureText(x).width;
    for (; size >= 60; size -= 6) {
      tctx.font = `900 ${size}px ${FONT}`;
      lines = text ? T.wrapText(text, maxW, measure) : [];
      if (lines.length <= 2 && Math.max(0, ...lines.map(measure)) <= maxW) break;
    }
    const subSize = 46;
    const lh = size * 1.1;
    const subH = sub ? subSize * 1.45 + size * 0.22 : 0;
    const blockH = lines.length * lh + subH;
    const align = pos === "left" ? "left" : pos === "right" ? "right" : "center";
    const x = align === "left" ? margin : align === "right" ? W - margin : W / 2;
    let y = pos === "left" ? H - margin - blockH : pos === "right" ? margin : (H - blockH) / 2;
    tctx.textAlign = align;
    tctx.textBaseline = "top";
    if (sub) {
      tctx.font = `800 ${subSize}px ${FONT}`;
      const w = tctx.measureText(sub).width + 36;
      const bx = align === "left" ? x : align === "right" ? x - w : x - w / 2;
      tctx.fillStyle = stroke;
      tctx.fillRect(bx, y, w, subSize * 1.45);
      tctx.fillStyle = "#fff";
      tctx.fillText(sub, align === "left" ? x + 18 : align === "right" ? x - 18 : x, y + subSize * 0.2);
      y += subH;
    }
    tctx.font = `900 ${size}px ${FONT}`;
    tctx.lineJoin = "round";
    for (const l of lines) {
      tctx.lineWidth = size * 0.2;
      tctx.strokeStyle = stroke;
      tctx.strokeText(l, x, y);
      tctx.lineWidth = size * 0.07;
      tctx.strokeStyle = "#000";
      tctx.strokeText(l, x, y);
      tctx.fillStyle = color;
      tctx.fillText(l, x, y);
      y += lh;
    }
  }

  $("thumb-grab").onclick = () => {
    render({ noCaption: true }); // 썸네일에는 자막을 빼고 가져온다
    const c = document.createElement("canvas");
    c.width = canvas.width; c.height = canvas.height;
    c.getContext("2d").drawImage(canvas, 0, 0);
    state.thumbSrc = c;
    if (!$("thumb-text").value && $("intro-title").value) $("thumb-text").value = $("intro-title").value;
    render();
    drawThumb();
  };
  $("thumb-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    try { await img.decode(); } catch (err) { alert("이 사진을 열 수 없습니다."); return; }
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    state.thumbSrc = c;
    drawThumb();
    e.target.value = "";
  };
  ["thumb-text", "thumb-sub", "thumb-color", "thumb-stroke", "thumb-pos", "thumb-dim"].forEach((id) => {
    $(id).addEventListener("input", () => { drawThumb(); saveSettings(); });
  });

  const toBlob = (c, type, q) => new Promise((ok) => c.toBlob(ok, type, q));
  $("thumb-save").onclick = async () => {
    drawThumb();
    const LIMIT = 2 * 1024 * 1024;
    let blob = await toBlob(thumb, "image/png");
    let ext = "png";
    for (let q = 0.92; blob.size > LIMIT && q > 0.4; q -= 0.08) {
      blob = await toBlob(thumb, "image/jpeg", q);
      ext = "jpg";
    }
    $("thumb-size").textContent = `${ext.toUpperCase()} · ${(blob.size / 1024).toFixed(0)}KB`;
    download(blob, `thumbnail.${ext}`);
  };

  // ---------- 제목·설명 ----------
  function updateMeta() {
    const chapters = T.buildChapters(state.timeline);
    if (!state.chaptersEdited) $("meta-chapters").value = chapters.marks.length ? chapters.text : "";
    const warn = $("chapter-warn");
    warn.textContent = "";
    if (!state.chaptersEdited && chapters.marks.length) {
      chapters.warnings.forEach((w) => { const li = document.createElement("li"); li.textContent = w; warn.appendChild(li); });
    }
    if (!$("meta-title").value && document.activeElement !== $("meta-title")) $("meta-title").placeholder = $("intro-title").value || "검색될 만한 핵심어를 앞쪽에";

    const title = $("meta-title").value || $("intro-title").value;
    const desc = T.buildDescription({ description: $("meta-desc").value, chapters: $("meta-chapters").value, hashtags: $("meta-hashtags").value });
    const tags = T.parseTags($("meta-tags").value);
    $("meta-out").value = desc;
    setCount("title-count", [...title].length, T.LIMITS.titleMax);
    setCount("desc-count", [...desc].length, T.LIMITS.descMax);
    setCount("tags-count", T.tagsLength(tags), T.LIMITS.tagsMax);
    const issues = T.validateMeta({ title, description: desc, tags, hashtags: T.parseTags($("meta-hashtags").value),
      format: $("format").value, total: state.timeline.total });
    const ul = $("meta-issues");
    ul.textContent = "";
    issues.forEach((w) => { const li = document.createElement("li"); li.textContent = w; ul.appendChild(li); });
  }
  function setCount(id, n, max) {
    $(id).textContent = `${n} / ${max}`;
    $(id).classList.toggle("over", n > max);
  }
  ["meta-title", "meta-desc", "meta-hashtags", "meta-tags"].forEach((id) => $(id).addEventListener("input", updateMeta));
  $("meta-chapters").addEventListener("input", () => { state.chaptersEdited = true; updateMeta(); });
  $("chapter-reset").onclick = () => { state.chaptersEdited = false; updateMeta(); };

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    $("copy-msg").textContent = "복사했습니다.";
    setTimeout(() => ($("copy-msg").textContent = ""), 1500);
  }
  $("copy-title").onclick = () => copy($("meta-title").value || $("intro-title").value);
  $("copy-desc").onclick = () => copy($("meta-out").value);
  $("copy-tags").onclick = () => copy(T.parseTags($("meta-tags").value).join(", "));
  $("meta-save").onclick = () => {
    const title = $("meta-title").value || $("intro-title").value;
    const text = `[제목]\n${title}\n\n[설명]\n${$("meta-out").value}\n\n[태그]\n${T.parseTags($("meta-tags").value).join(", ")}\n`;
    download(new Blob([text], { type: "text/plain;charset=utf-8" }), `${safeName(title || "youtube")}_설명.txt`);
  };

  // ---------- 시작 ----------
  loadSettings();
  rebuild();
  drawThumb();
})();
