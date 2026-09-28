// 漢検 3級 학습 앱
(function () {
  const isNode = typeof module !== "undefined" && module.exports;
  const D = isNode ? require("./data.js") : { KANJI, YOJI, TAIGI, RUIGI };

  // ---------- 유틸 ----------
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // 정답 1개 + 후보 중 중복 없는 오답 (n-1)개를 섞어 반환
  function makeChoices(answer, candidates, n = 4) {
    const set = new Set([answer]);
    for (const c of shuffle(candidates)) {
      if (set.size >= n) break;
      if (c) set.add(c);
    }
    return shuffle([...set]);
  }

  const levelPool = (level) =>
    level === "all" ? D.KANJI : D.KANJI.filter((k) => String(k.level) === String(level));

  const readings = (k) =>
    `음: ${k.on.join("・") || "—"} / 훈: ${k.kun.join("・") || "—"}`;

  const underline = (word, ch) => word.split(ch).join(`<u>${ch}</u>`);

  // ---------- 문제 생성기 ----------
  const allExamples = D.KANJI.flatMap((k) => k.examples.map((e) => ({ ...e, k })));

  const MODES = {
    reading: {
      name: "읽기",
      desc: "밑줄 친 한자가 들어간 단어의 읽기를 고르세요",
      make(pool) {
        const k = pick(pool);
        const e = pick(k.examples);
        const near = allExamples
          .filter((x) => x.yomi !== e.yomi && Math.abs(x.yomi.length - e.yomi.length) <= 1)
          .map((x) => x.yomi);
        return {
          key: k.kanji,
          q: underline(e.word, k.kanji),
          sub: "이 단어의 읽기는?",
          choices: makeChoices(e.yomi, near),
          answer: e.yomi,
          explain: `${e.word}（${e.yomi}）　${k.kanji} — ${readings(k)}`,
        };
      },
    },
    writing: {
      name: "쓰기 (한자 고르기)",
      desc: "□에 들어갈 한자를 고르세요. 같은 음독 한자가 오답으로 나옵니다",
      make(pool) {
        const k = pick(pool);
        const e = pick(k.examples);
        // 같은 음독을 가진 한자를 우선 오답으로 사용 (동음이자 연습)
        const same = D.KANJI.filter(
          (x) => x.kanji !== k.kanji && x.on.some((o) => k.on.includes(o)) && !e.word.includes(x.kanji)
        ).map((x) => x.kanji);
        const others = pool.filter((x) => !e.word.includes(x.kanji)).map((x) => x.kanji);
        const cands = [...shuffle(same).slice(0, 3), ...shuffle(others)];
        const set = new Set([k.kanji]);
        for (const c of cands) { if (set.size >= 4) break; set.add(c); }
        return {
          key: k.kanji,
          q: e.word.split(k.kanji).join("□"),
          sub: e.yomi,
          choices: shuffle([...set]),
          answer: k.kanji,
          explain: `${e.word}（${e.yomi}）　${k.kanji} — ${readings(k)}`,
        };
      },
    },
    bushu: {
      name: "부수",
      desc: "한자의 부수를 고르세요 (漢検 부수 분류 기준)",
      make(pool) {
        const k = pick(pool);
        const cands = [...new Set(D.KANJI.map((x) => x.bushu))].filter(
          (b) => b !== k.bushu && !k.kanji.includes(b)
        );
        return {
          key: k.kanji,
          q: k.kanji,
          sub: "이 한자의 부수는?",
          choices: makeChoices(k.bushu, cands),
          answer: k.bushu,
          explain: `${k.kanji}의 부수: ${k.bushu}`,
        };
      },
    },
    onyomi: {
      name: "음독",
      desc: "한자의 음독(音読み)을 고르세요",
      filter: (k) => k.on.length > 0,
      make(pool) {
        const k = pick(pool);
        const ans = pick(k.on);
        const cands = D.KANJI.flatMap((x) => x.on).filter((o) => !k.on.includes(o));
        return {
          key: k.kanji,
          q: k.kanji,
          sub: "음독으로 올바른 것은?",
          choices: makeChoices(ans, [...new Set(cands)]),
          answer: ans,
          explain: `${k.kanji} — ${readings(k)}`,
        };
      },
    },
    kunyomi: {
      name: "훈독·오쿠리가나",
      desc: "훈독과 오쿠리가나를 바르게 나눈 것을 고르세요",
      // 오답 선택지를 만들 수 있도록 3글자 이상인 훈독만 사용
      okuri: (r) => r.includes("(") && r.replace(/[()]/g, "").length >= 3,
      filter: (k) => k.kun.some(MODES.kunyomi.okuri),
      make(pool) {
        const k = pick(pool);
        const ans = pick(k.kun.filter(MODES.kunyomi.okuri));
        const [stem, oku] = ans.replace(")", "").split("(");
        const full = stem + oku;
        // 오쿠리가나 경계를 옮긴 오답 생성
        const wrongs = [`${k.kanji}${full}`];
        for (let i = 1; i < full.length; i++) {
          if (i !== stem.length) wrongs.push(`${k.kanji}${full.slice(i)}`);
        }
        const fmt = `${k.kanji}${oku}`;
        return {
          key: k.kanji,
          q: full,
          sub: "한자와 오쿠리가나로 바르게 쓴 것은?",
          choices: makeChoices(fmt, wrongs),
          answer: fmt,
          explain: `${fmt}（${full}）　${k.kanji} — ${readings(k)}`,
        };
      },
    },
    yoji: {
      name: "사자성어",
      desc: "사자성어의 빈칸에 들어갈 한자를 고르세요",
      noKanjiPool: true,
      make() {
        const [word, yomi, mean] = pick(D.YOJI);
        const i = Math.floor(Math.random() * 4);
        const ans = word[i];
        const cands = D.YOJI.flatMap((y) => [...y[0]]).filter((c) => c !== ans);
        return {
          key: null,
          q: [...word].map((c, j) => (j === i ? "□" : c)).join(""),
          sub: mean,
          choices: makeChoices(ans, [...new Set(cands)]),
          answer: ans,
          explain: `${word}（${yomi}）`,
        };
      },
    },
    taigi: {
      name: "대의어·유의어",
      desc: "반대말 또는 비슷한 말을 고르세요",
      noKanjiPool: true,
      make() {
        const isTaigi = Math.random() < 0.5;
        const list = isTaigi ? D.TAIGI : D.RUIGI;
        const pair = pick(list);
        const flip = Math.random() < 0.5;
        const [a, b] = flip ? [pair[1], pair[0]] : pair;
        const cands = [...D.TAIGI, ...D.RUIGI].flat().filter((w) => w !== a && w !== b);
        return {
          key: null,
          q: a,
          sub: isTaigi ? "대의어(반대말)는?" : "유의어(비슷한 말)는?",
          choices: makeChoices(b, cands),
          answer: b,
          explain: `${a} ${isTaigi ? "⇔" : "≒"} ${b}`,
        };
      },
    },
  };

  if (isNode) {
    module.exports = { MODES, makeChoices, levelPool, shuffle };
    return;
  }

  // ---------- 저장소 (실패해도 동작하도록) ----------
  const store = {
    get(key, def) {
      try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 무시 */ }
    },
  };
  let wrongSet = new Set(store.get("kk3.wrong", []));
  let stats = store.get("kk3.stats", {});
  const saveWrong = () => store.set("kk3.wrong", [...wrongSet]);

  const $ = (id) => document.getElementById(id);

  // ---------- 탭 ----------
  function show(view) {
    document.querySelectorAll("#tabs button").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === view)
    );
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== `view-${view}`));
    if (view === "review") renderReview();
  }
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.addEventListener("click", () => show(b.dataset.view))
  );

  // ---------- 카드 ----------
  let deck = [];
  let pos = 0;
  function buildDeck() {
    const q = $("card-search").value.trim();
    deck = levelPool($("card-level").value).filter(
      (k) =>
        !q ||
        k.kanji.includes(q) ||
        [...k.on, ...k.kun].some((r) => r.replace(/[()]/g, "").includes(q)) ||
        k.examples.some((e) => e.word.includes(q) || e.yomi.includes(q))
    );
    if ($("card-shuffle").checked) deck = shuffle(deck);
    pos = 0;
    renderCard();
  }
  function renderCard() {
    const back = $("card-back");
    back.hidden = true;
    $("card-hint").hidden = false;
    if (!deck.length) {
      $("card-kanji").textContent = "—";
      $("card-pos").textContent = "0 / 0";
      return;
    }
    const k = deck[pos];
    $("card-kanji").textContent = k.kanji;
    $("card-pos").textContent = `${pos + 1} / ${deck.length}`;
    back.innerHTML = `
      <span class="badge">${k.level}급</span>
      <dl>
        <dt>음독</dt><dd>${k.on.join("・") || "—"}</dd>
        <dt>훈독</dt><dd>${k.kun.join("・") || "—"}</dd>
        <dt>부수</dt><dd>${k.bushu}</dd>
        <dt>예시어</dt><dd>${k.examples.map((e) => `${e.word}（${e.yomi}）`).join("<br>")}</dd>
      </dl>`;
  }
  function flip() {
    if (!deck.length) return;
    const back = $("card-back");
    back.hidden = !back.hidden;
    $("card-hint").hidden = !back.hidden;
  }
  const move = (d) => { if (deck.length) { pos = (pos + d + deck.length) % deck.length; renderCard(); } };
  $("card").addEventListener("click", flip);
  $("card-prev").addEventListener("click", () => move(-1));
  $("card-next").addEventListener("click", () => move(1));
  $("card-wrong").addEventListener("click", () => {
    if (!deck.length) return;
    wrongSet.add(deck[pos].kanji);
    saveWrong();
    move(1);
  });
  ["card-level", "card-shuffle"].forEach((id) => $(id).addEventListener("change", buildDeck));
  $("card-search").addEventListener("input", buildDeck);
  document.addEventListener("keydown", (ev) => {
    if (!$("view-cards").hidden && ev.target.tagName !== "INPUT" && ev.target.tagName !== "SELECT") {
      if (ev.key === " ") { ev.preventDefault(); flip(); }
      if (ev.key === "ArrowRight") move(1);
      if (ev.key === "ArrowLeft") move(-1);
    }
  });

  // ---------- 퀴즈 ----------
  let quiz = null;
  Object.entries(MODES).forEach(([id, m]) => {
    const b = document.createElement("button");
    b.className = "mode";
    b.innerHTML = `<b>${m.name}</b><small>${m.desc}</small>`;
    b.addEventListener("click", () => startQuiz(id));
    $("quiz-modes").appendChild(b);
  });

  function startQuiz(modeId, customPool) {
    const m = MODES[modeId];
    let pool = customPool || levelPool($("quiz-level").value);
    if (m.filter) pool = pool.filter(m.filter);
    const n = Number($("quiz-count").value);
    const questions = [];
    const seen = new Set();
    for (let tries = 0; questions.length < n && tries < n * 20; tries++) {
      const q = m.make(pool);
      const sig = q.q + q.answer;
      if (seen.has(sig) || q.choices.length < 2) continue;
      seen.add(sig);
      questions.push(q);
    }
    quiz = { modeId, customPool, questions, i: 0, correct: 0, wrong: [] };
    $("quiz-menu").hidden = true;
    $("quiz-result").hidden = true;
    $("quiz-play").hidden = false;
    renderQ();
  }

  function renderQ() {
    const q = quiz.questions[quiz.i];
    $("quiz-bar").style.width = `${(quiz.i / quiz.questions.length) * 100}%`;
    $("quiz-meta").textContent = `${MODES[quiz.modeId].name} · ${quiz.i + 1} / ${quiz.questions.length} · 정답 ${quiz.correct}`;
    $("quiz-q").innerHTML = q.q;
    $("quiz-sub").textContent = q.sub;
    $("quiz-explain").textContent = "";
    $("quiz-next").hidden = true;
    const box = $("quiz-choices");
    box.innerHTML = "";
    q.choices.forEach((c) => {
      const b = document.createElement("button");
      b.textContent = c;
      b.addEventListener("click", () => answer(b, c));
      box.appendChild(b);
    });
  }

  function answer(btn, choice) {
    const q = quiz.questions[quiz.i];
    const buttons = [...$("quiz-choices").children];
    if (buttons.some((b) => b.disabled)) return;
    buttons.forEach((b) => {
      b.disabled = true;
      if (b.textContent === q.answer) b.classList.add("ok");
    });
    const ok = choice === q.answer;
    const s = (stats[quiz.modeId] ||= { correct: 0, total: 0 });
    s.total++;
    if (ok) {
      quiz.correct++;
      s.correct++;
    } else {
      btn.classList.add("ng");
      quiz.wrong.push(q);
      if (q.key) { wrongSet.add(q.key); saveWrong(); }
    }
    store.set("kk3.stats", stats);
    $("quiz-explain").textContent = (ok ? "⭕ 정답! " : "❌ 오답 ") + q.explain;
    $("quiz-next").hidden = false;
    $("quiz-next").focus();
  }

  $("quiz-next").addEventListener("click", () => {
    quiz.i++;
    if (quiz.i < quiz.questions.length) renderQ();
    else finishQuiz();
  });
  $("quiz-quit").addEventListener("click", finishQuiz);

  function finishQuiz() {
    const answered = quiz.i + (quiz.i < quiz.questions.length && !$("quiz-next").hidden ? 1 : 0);
    const total = Math.min(answered, quiz.questions.length) || 0;
    const pct = total ? Math.round((quiz.correct / total) * 100) : 0;
    $("quiz-play").hidden = true;
    $("quiz-result").hidden = false;
    $("result-score").textContent = `${quiz.correct} / ${total} (${pct}%)`;
    $("result-msg").textContent =
      pct >= 70 ? "합격 기준(약 70%) 이상입니다. 좋아요!" : "합격 기준은 약 70%입니다. 틀린 문제를 복습해 보세요.";
    $("result-wrong").innerHTML = quiz.wrong.map((q) => `<li>${q.explain}</li>`).join("");
  }
  $("result-back").addEventListener("click", () => {
    $("quiz-result").hidden = true;
    $("quiz-menu").hidden = false;
  });
  $("result-retry").addEventListener("click", () => startQuiz(quiz.modeId, quiz.customPool));

  // ---------- 오답 노트 ----------
  function renderReview() {
    $("review-msg").textContent = "";
    const list = $("review-list");
    const items = D.KANJI.filter((k) => wrongSet.has(k.kanji));
    list.innerHTML = items.length ? "" : "<p>아직 오답이 없습니다.</p>";
    items.forEach((k) => {
      const s = document.createElement("span");
      s.textContent = k.kanji;
      s.title = `${readings(k)} · 클릭하면 목록에서 제거`;
      s.addEventListener("click", () => {
        wrongSet.delete(k.kanji);
        saveWrong();
        renderReview();
      });
      list.appendChild(s);
    });
    $("stats").innerHTML =
      "<tr><th>모드</th><th>정답 / 전체</th><th>정답률</th></tr>" +
      Object.entries(MODES)
        .map(([id, m]) => {
          const s = stats[id] || { correct: 0, total: 0 };
          const p = s.total ? Math.round((s.correct / s.total) * 100) + "%" : "—";
          return `<tr><td>${m.name}</td><td>${s.correct} / ${s.total}</td><td>${p}</td></tr>`;
        })
        .join("");
  }
  $("review-quiz").addEventListener("click", () => {
    const pool = D.KANJI.filter((k) => wrongSet.has(k.kanji));
    if (!pool.length) {
      $("review-msg").textContent = "오답 노트가 비어 있습니다. 퀴즈를 풀거나 카드에서 「모름」을 눌러 추가하세요.";
      return;
    }
    show("quiz");
    startQuiz("reading", pool);
  });
  // 두 번 눌러야 비워지도록 화면 안에서 확인
  let clearArmed = false;
  $("review-clear").addEventListener("click", () => {
    const btn = $("review-clear");
    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = "한 번 더 누르면 비워집니다";
      setTimeout(() => { clearArmed = false; btn.textContent = "오답 노트 비우기"; }, 3000);
      return;
    }
    clearArmed = false;
    btn.textContent = "오답 노트 비우기";
    wrongSet = new Set();
    saveWrong();
    renderReview();
    $("review-msg").textContent = "오답 노트를 비웠습니다.";
  });

  buildDeck();
})();
