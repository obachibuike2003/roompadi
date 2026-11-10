/* RoomPadi – single-page app in plain JavaScript.
   Routes live in the URL hash (#/quiz, #/matches, ...).
   There is no server yet: account, answers and chats are kept in this browser (localStorage). */

/* =========================================================
   Store
   ========================================================= */
const KEY = "roompadi";
const DEFAULTS = { theme: null, answers: {}, account: null, loggedIn: false, threads: {}, unread: {}, blocked: [], pendingCode: null };
let S = load();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch (e) { return { ...DEFAULTS }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: keep working in memory */ }
}

/* =========================================================
   Helpers
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $("#app");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const firstName = (n) => n.split(" ")[0];
const initials = (n) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const byId = (id) => PROFILES.find((p) => p.id === id);
const answeredCount = () => Object.keys(S.answers).length;
const quizDone = () => answeredCount() === QUESTIONS.length;
const safeNext = (n) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/matches");
const hash = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };

function avatar(p, size = "md") {
  if (p.photo) return `<img class="avatar avatar--${size}" src="${p.photo}" alt="" loading="lazy" decoding="async" style="--tone:${p.tone}">`;
  return `<span class="avatar avatar--${size}" style="--tone:${p.tone}" aria-hidden="true">${initials(p.name)}</span>`;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2800);
}

/* =========================================================
   Compatibility scoring
   ========================================================= */
function tier(pct) {
  if (pct >= 85) return { key: "great", label: "Great match" };
  if (pct >= 65) return { key: "good", label: "Good match" };
  if (pct >= 40) return { key: "some", label: "Some differences" };
  return { key: "low", label: "Low match" };
}

function qScore(item, mine, theirs) {
  if (item.categorical) return mine === theirs ? 1 : 0.5;
  const range = item.opts.length - 1;
  let s = 1 - Math.abs(mine - theirs) / range;
  if (item.id === "smoke" && Math.abs(mine - theirs) === range) s = 0; // non-smoker vs smoker
  return s;
}

function compare(mine, p) {
  const rows = [];
  let total = 0, weights = 0;
  QUESTIONS.forEach((item) => {
    if (!(item.id in mine)) return;
    const s = qScore(item, mine[item.id], p.a[item.id]);
    rows.push({ item, mine: mine[item.id], theirs: p.a[item.id], s });
    total += s * item.weight;
    weights += item.weight;
  });
  const pct = weights ? Math.round((total / weights) * 100) : 0;
  const cats = CATEGORIES.map((c) => {
    const r = rows.filter((x) => x.item.cat === c.id);
    const w = r.reduce((a, x) => a + x.item.weight, 0);
    return { ...c, rows: r, pct: w ? Math.round((r.reduce((a, x) => a + x.s * x.item.weight, 0) / w) * 100) : null };
  });
  const good = rows.filter((r) => r.s === 1).sort((a, b) => b.item.weight - a.item.weight);
  const diff = rows.filter((r) => r.s <= 0.5).sort((a, b) => b.item.weight - a.item.weight);
  return { pct, rows, cats, good, diff };
}

const label = (item, v) => (item.short ? item.short[v] : item.opts[v]);

/* =========================================================
   Compatibility Ring
   ========================================================= */
const RING_STOPS = { great: ["#22A35A", "#0B7A43"], good: ["#14A39A", "#0F766E"], some: ["#F0B43C", "#C27C0E"], low: ["#A8A29E", "#6B6F78"] };
let ringSeq = 0;
function ring(pct, size = "md") {
  const t = tier(pct);
  const id = `rg${++ringSeq}`;
  const [a, b] = RING_STOPS[t.key];
  return `
    <div class="ring ring--${size}" data-pct="${pct}" role="img" aria-label="${pct}% compatible: ${t.label}">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
        <circle class="ring__track" cx="60" cy="60" r="52"/>
        <circle class="ring__bar" cx="60" cy="60" r="52" pathLength="100" stroke="url(#${id})" stroke-dasharray="${pct} 100"/>
      </svg>
      <span class="ring__num"><b>${pct}</b><small>%</small></span>
    </div>`;
}
const tierPill = (pct) => { const t = tier(pct); return `<span class="tier tier--${t.key}">${t.label}</span>`; };

function animateRings(root = app) {
  const rings = $$(".ring[data-pct]:not(.ring-done)", root);
  const run = (el) => {
    el.classList.add("ring-done");
    const pct = Number(el.dataset.pct);
    const bar = $(".ring__bar", el), num = $(".ring__num b", el);
    if (reduceMotion) return; // already drawn at its final value
    // Rewind to 0, then animate up. A timeout guarantees the final state even if frames are throttled.
    bar.style.transition = "none";
    bar.setAttribute("stroke-dasharray", "0 100");
    num.textContent = "0";
    bar.getBoundingClientRect();
    bar.style.transition = "";
    const finish = () => { bar.setAttribute("stroke-dasharray", `${pct} 100`); num.textContent = pct; };
    requestAnimationFrame(() => bar.setAttribute("stroke-dasharray", `${pct} 100`));
    const start = performance.now(), dur = 900;
    (function tick(now) {
      const k = Math.min((now - start) / dur, 1);
      num.textContent = Math.round(pct * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    })(start);
    setTimeout(finish, dur + 150);
  };
  if (!("IntersectionObserver" in window)) return rings.forEach(run);
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: 0.4 });
  rings.forEach((r) => io.observe(r));
}

/* =========================================================
   Illustrations for empty / error states (simple line drawings)
   ========================================================= */
function illus(kind) {
  const common = `fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  if (kind === "chat") return `
    <svg class="illus" viewBox="0 0 200 140" aria-hidden="true">
      <rect x="22" y="22" width="104" height="64" rx="18" fill="var(--yellow)" ${common}/>
      <path d="M48 86l-10 20 26-20" fill="var(--yellow)" ${common}/>
      <rect x="86" y="54" width="94" height="56" rx="18" fill="var(--surface)" ${common}/>
      <path d="M156 110l10 18-24-18" fill="var(--surface)" ${common}/>
      <path d="M46 48h56M46 62h34M108 76h48M108 90h28" ${common}/>
    </svg>`;
  if (kind === "offline") return `
    <svg class="illus" viewBox="0 0 200 140" aria-hidden="true">
      <path d="M40 100h120" ${common}/>
      <path d="M60 100V58l40-30 40 30v42" fill="var(--surface)" ${common}/>
      <path d="M88 100V76h24v24" fill="var(--yellow)" ${common}/>
      <path d="M150 30l20 20M170 30l-20 20" ${common}/>
    </svg>`;
  if (kind === "search") return `
    <svg class="illus" viewBox="0 0 200 140" aria-hidden="true">
      <circle cx="88" cy="64" r="36" fill="var(--yellow)" ${common}/>
      <path d="M114 90l34 34" ${common}/>
      <path d="M74 64h28" ${common}/>
    </svg>`;
  return `
    <svg class="illus" viewBox="0 0 200 140" aria-hidden="true">
      <path d="M24 118h152" ${common}/>
      <path d="M46 118V62l54-40 54 40v56" fill="var(--surface)" ${common}/>
      <rect x="66" y="74" width="24" height="22" rx="3" fill="var(--yellow)" ${common}/>
      <rect x="110" y="74" width="24" height="22" rx="3" fill="var(--yellow)" ${common}/>
      <path d="M90 118v-10a10 10 0 0 1 20 0v10" ${common}/>
    </svg>`;
}

function emptyState({ kind = "home", title, text, actions = "" }) {
  return `<div class="empty">${illus(kind)}<h2>${title}</h2><p>${text}</p><div class="empty__actions">${actions}</div></div>`;
}

/* Pretend network call, so loading and error states are real */
function fetchProfiles() {
  const fail = new URLSearchParams(location.hash.split("?")[1] || "").get("fail");
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (!navigator.onLine || fail) reject(new Error("offline"));
      else resolve(PROFILES.filter((p) => !S.blocked.includes(p.id)));
    }, 650));
}

/* =========================================================
   Header, footer, bottom nav
   ========================================================= */
function renderHeader(path) {
  const unread = Object.keys(S.unread).length;
  const is = (p) => (p === "/" ? path === "/" : path.startsWith(p));
  const link = (href, ic, label, key, extra = "", cls = "") =>
    `<a href="${href}" class="hdr-link ${cls}${is(key) ? " is-active" : ""}"${is(key) ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${extra}</a>`;
  const countBadge = unread ? `<span class="count" aria-label="${unread} unread">${unread}</span>` : "";

  const ticker = [
    `${icon("gift", "ic--sm")} Free while we launch in <b>Awka</b>`,
    `${icon("users", "ic--sm")} <b>${PROFILES.length} people</b> looking around UNIZIK`,
    `${icon("phone", "ic--sm")} Every profile is <b>phone-verified</b>`,
    `${icon("lock", "ic--sm")} Your number stays <b>private</b>`,
    `${icon("sparkle", "ic--sm")} Matching on <b>${QUESTIONS.length} lifestyle questions</b>`,
    `${icon("flag", "ic--sm")} Reports reviewed within <b>24 hours</b>`,
  ].map((t) => `<span class="ticker-item">${t}</span>`).join("");

  const account = S.loggedIn
    ? `<details class="usermenu">
         <summary class="hdr-link" aria-label="Account menu">${avatar({ name: S.account.name, tone: "#FFC83D" }, "xs")}<span>${esc(firstName(S.account.name))}</span></summary>
         <div class="usermenu__panel">
           <p class="usermenu__who"><strong>${esc(S.account.name)}</strong><span>${S.account.phoneVerified ? `${icon("badge", "ic--sm")} Phone verified` : "Not verified yet"}</span></p>
           <a href="#/verify">${icon("shield")} Verification</a>
           <a href="#/quiz?restart=1">${icon("quiz")} Retake the quiz</a>
           <button type="button" id="logoutBtn">${icon("logout")} Log out</button>
         </div>
       </details>`
    : link("#/login", "user", "Log in", "/login", "", "hide-s");

  $("#header").innerHTML = `
    <div class="ticker" aria-label="RoomPadi highlights"><div class="ticker-track"><div class="ticker-group">${ticker}</div><div class="ticker-group" aria-hidden="true">${ticker}</div></div></div>
    <div class="hdr">
      <div class="container hdr-row">
        <a href="#/" class="logo" aria-label="RoomPadi home"><span class="logo-mark">${icon("logo")}</span><span>Room<span class="logo-accent">Padi</span></span></a>
        <form class="search" id="searchForm" role="search">
          <label class="sr-only" for="searchInput">Search people</label>
          <input id="searchInput" type="search" placeholder="Search by name, course, job or area" value="${esc(F.q)}">
          <button type="submit" aria-label="Search">${icon("search")}</button>
        </form>
        <nav class="hdr-actions" aria-label="Main">
          ${link("#/", "home", "Home", "/", "", "hide-m")}
          ${link("#/quiz", "quiz", "Quiz", "/quiz", "", "hide-m")}
          ${link("#/matches", "users", "Matches", "/match", "", "hide-s")}
          ${link("#/messages", "chat", "Messages", "/messages", countBadge, "hide-s")}
          ${account}
        </nav>
      </div>
    </div>`;

  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    F.q = $("#searchInput").value.trim();
    if (location.hash === "#/matches") viewMatches(new URLSearchParams());
    else location.hash = "#/matches";
  });
  const lo = $("#logoutBtn");
  if (lo) lo.onclick = () => { S.loggedIn = false; save(); toast("You've logged out."); location.hash = "#/"; };

  // Floating bottom nav on phones
  const b = (href, ic, label, key, extra = "") => `<a href="${href}" class="${is(key) ? "is-active" : ""}"${is(key) ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${extra}</a>`;
  $("#bottomNav").innerHTML =
    b("#/", "home", "Home", "/") + b("#/matches", "users", "Matches", "/match") + b("#/quiz", "quiz", "Quiz", "/quiz") +
    b("#/messages", "chat", "Messages", "/messages", countBadge) +
    (S.loggedIn ? b("#/verify", "user", "Me", "/verify") : b("#/login", "user", "Log in", "/login"));
}

function renderFooter(path) {
  const f = $("#footer");
  const hide = path.startsWith("/messages") || path === "/quiz";
  f.hidden = hide;
  $("#bottomNav").hidden = path === "/quiz";
  document.body.classList.toggle("no-bottom-nav", path === "/quiz");
  if (hide) { f.innerHTML = ""; return; }
  f.innerHTML = `
    <div class="container ftr-grid">
      <div>
        <a href="#/" class="logo logo-light"><span class="logo-mark">${icon("logo")}</span><span>Room<span class="logo-accent">Padi</span></span></a>
        <p>Don't just find a roommate. Find your kind of person. Starting in Awka, around UNIZIK.</p>
      </div>
      <div><h3>RoomPadi</h3><a href="#/quiz">Take the quiz</a><a href="#/matches">Browse matches</a><a href="#/messages">Messages</a><a href="#/signup">Create an account</a></div>
      <div><h3>Help</h3><a href="#/?s=how">How it works</a><a href="#/?s=safety">Safety tips</a><a href="#/?s=faq">FAQ</a></div>
      <div><h3>Contact</h3><a href="mailto:hello@roompadi.ng">hello@roompadi.ng</a><a href="mailto:hello@roompadi.ng?subject=Advertising">Advertise with us</a><a href="mailto:hello@roompadi.ng?subject=Listing">List an apartment</a></div>
    </div>
    <div class="container ftr-note">© ${new Date().getFullYear()} RoomPadi · Made in Awka · The profiles shown are samples; photos from Pexels.</div>`;
}

/* =========================================================
   Home page
   ========================================================= */
function personCard(p, i = 0) {
  const done = quizDone();
  const pct = done ? compare(S.answers, p).pct : null;
  const t = done ? tier(pct) : null;
  const href = done ? `#/match/${p.id}` : "#/quiz";
  return `
    <article class="pcard reveal" style="--i:${i}">
      <a href="${href}" class="pcard-link">
        <div class="pthumb" style="--tone:${p.tone}">
          ${done ? `<span class="badge badge-${t.key}">${pct}% match</span>` : `<span class="badge badge-quiz">Take the quiz to see your score</span>`}
          ${p.photo ? `<img class="pthumb-img" src="${p.photo}" alt="Photo of ${p.name}" loading="lazy" decoding="async">` : `<span class="pthumb-av">${initials(p.name)}</span>`}
          ${p.verified ? `<span class="pthumb-ver" title="Verified">${icon("badge", "ic--sm")} Verified</span>` : ""}
        </div>
        <div class="pbody">
          <h3 class="pname">${p.name}, ${p.age}</h3>
          <p class="prole">${p.role}</p>
          <div class="pmeta"><span>${icon("pin", "ic--sm")} ${p.area}</span><span>${p.hasRoom ? "Has a room" : "Looking too"}</span></div>
        </div>
      </a>
      <a href="${done ? `#/match/${p.id}` : "#/quiz"}" class="add-fab" aria-label="${done ? `View ${firstName(p.name)}'s profile` : "Take the quiz"}">${icon(done ? "chat" : "arrow")}</a>
    </article>`;
}

let sliderTimer = null;
function viewLanding() {
  const done = quizDone();
  const list = PROFILES.filter((p) => !S.blocked.includes(p.id));
  const scored = done ? list.map((p) => ({ p, pct: compare(S.answers, p).pct })).sort((a, b) => b.pct - a.pct) : [];
  const quizBtn = done ? `<a class="btn btn-white" href="#/matches">See your matches ${icon("arrow", "ic-arrow")}</a>` : `<a class="btn btn-white" href="#/quiz">Take the quiz – it's free ${icon("arrow", "ic-arrow")}</a>`;
  const floater = (p, pct, cls) => `
    <div class="floater ${cls}"><div class="fcard">${avatar(p, "sm")}<div><b>${firstName(p.name)}</b><span>${p.area}</span></div><span class="fpct">${pct}%</span></div></div>`;

  const side = done
    ? `<span class="kicker kicker-light">${icon("sparkle", "ic--sm")} Your best match</span>
       <div class="side-top">
         ${ring(scored[0].pct, "md")}
         <div><b>${scored[0].p.name}</b><span>${scored[0].p.role}</span>${tierPill(scored[0].pct)}</div>
       </div>
       <ul class="side-list">${scored.slice(1, 4).map(({ p, pct }) => `<li><a href="#/match/${p.id}">${avatar(p, "xs")}<span>${p.name}</span><b>${pct}%</b></a></li>`).join("")}</ul>
       <a href="#/matches" class="btn btn-primary btn-block">See all ${scored.length} matches</a>`
    : `<span class="kicker kicker-light">${icon("quiz", "ic--sm")} Compatibility quiz</span>
       <h2>How well would you live with them?</h2>
       <p class="small">${answeredCount() ? `You've answered ${answeredCount()} of ${QUESTIONS.length}.` : `${QUESTIONS.length} quick questions. About 2 minutes.`}</p>
       <div class="side-progress"><i style="width:${Math.round((answeredCount() / QUESTIONS.length) * 100)}%"></i></div>
       <ul class="side-cats">${CATEGORIES.map((c) => `<li>${icon(c.icon, "ic--sm")} ${c.name}</li>`).join("")}</ul>
       <a href="#/quiz" class="btn btn-primary btn-block">${answeredCount() ? "Continue the quiz" : "Start the quiz"} ${icon("arrow", "ic-arrow")}</a>`;

  const areaCounts = AREAS.map((a) => [a, list.filter((p) => p.area === a).length]);
  const hues = [222, 200, 245, 190, 212, 260, 232];

  app.innerHTML = `
  <div class="container home">
    <section class="hero">
      <div class="slider" id="slider" aria-roledescription="carousel" aria-label="Featured">
        <article class="slide slide-blue is-active" aria-roledescription="slide" aria-label="1 of 3">
          <span class="slide-ring" aria-hidden="true"></span>
          <div class="floaters" aria-hidden="true">
            ${floater(byId("chiamaka"), 92, "f1")}${floater(byId("tunde"), 81, "f2")}${floater(byId("aisha"), 88, "f3")}
          </div>
          <span class="eyebrow"><i></i>Now matching in Awka</span>
          <h1>Find a roommate, <em>not a stranger.</em></h1>
          <p>Answer ${QUESTIONS.length} quick questions. See exactly how well you'd live with someone before you ever say hello.</p>
          <div class="row">${quizBtn}<a class="btn btn-ghost-white" href="${done ? "#/matches" : "#/?s=people"}">Browse people</a></div>
        </article>
        <article class="slide slide-navy" aria-roledescription="slide" aria-label="2 of 3">
          <span class="slide-ring" aria-hidden="true"></span>
          <div class="floaters" aria-hidden="true"><div class="floater f1 shield-art">${icon("shield")}</div></div>
          <span class="eyebrow"><i></i>Safety</span>
          <h2>Know them <em>before you move in.</em></h2>
          <p>Phone-verified profiles, ID badges, private chat and one-tap reporting.</p>
          <div class="row"><a class="btn btn-white" href="${S.loggedIn ? "#/verify" : "#/signup"}">${S.loggedIn ? "Check your verification" : "Create a free account"}</a><a class="btn btn-ghost-white" href="#/?s=safety">Safety tips</a></div>
        </article>
        <article class="slide slide-sky" aria-roledescription="slide" aria-label="3 of 3">
          <span class="slide-ring" aria-hidden="true"></span>
          <div class="floaters" aria-hidden="true"><div class="floater f1 shield-art">${icon("key")}</div></div>
          <span class="eyebrow"><i></i>Have a room?</span>
          <h2>Got a spare room? <em>Fill it with the right person.</em></h2>
          <p>Tell us you have a room and people looking for a place will see it on your profile.</p>
          <div class="row"><a class="btn btn-white" href="${S.loggedIn ? "#/matches" : "#/signup"}">${S.loggedIn ? "See who's looking" : "List your room"}</a><a class="btn btn-ghost-white" href="#/?s=how">How it works</a></div>
        </article>
        <div class="slider-dots" id="sliderDots"></div>
        <div class="slider-arrows">
          <button type="button" id="slidePrev" aria-label="Previous slide">${icon("prev")}</button>
          <button type="button" id="slideNext" aria-label="Next slide">${icon("next")}</button>
        </div>
      </div>
      <aside class="side-card">${side}</aside>
    </section>

    <ul class="perks">
      ${[["gift", "Free to join", "No fees while we launch"], ["phone", "Phone-verified", "Everyone confirms their number"], ["lock", "Private chat", "Your number stays hidden"], ["flag", "Report & block", "Reviewed within 24 hours"]]
        .map(([ic, t, s], i) => `<li class="reveal" style="--i:${i}"><span class="perk-ic">${icon(ic)}</span><div><b>${t}</b><span>${s}</span></div></li>`).join("")}
    </ul>

    <section class="section" aria-labelledby="areas-h">
      <div class="section-head reveal">
        <div><span class="kicker">Browse</span><h2 id="areas-h">Find people by area</h2></div>
        <a href="#/matches">All areas ${icon("next", "ic--sm")}</a>
      </div>
      <div class="cat-bubbles">
        ${areaCounts.map(([a, n], i) => `
          <a class="cat-bubble reveal" style="--i:${i}" href="${done ? `#/matches?area=${encodeURIComponent(a)}` : "#/quiz"}">
            <span class="bubble" style="--h:${hues[i % hues.length]}">${icon("pin")}<em>${n}</em></span>${a}
          </a>`).join("")}
      </div>
    </section>

    <section class="section" id="people" aria-labelledby="people-h">
      <div class="section-head reveal">
        <div><span class="kicker">${done ? "For you" : "Near UNIZIK"}</span><h2 id="people-h">${done ? "Your top matches" : "People looking for roommates"}</h2></div>
        <a href="${done ? "#/matches" : "#/quiz"}">${done ? "See all" : "Get your scores"} ${icon("next", "ic--sm")}</a>
      </div>
      <div class="chips" id="homeChips" role="group" aria-label="Filter people">
        ${[["all", "Everyone"], ["has", "Has a room"], ["Student", "Students"], ["NYSC", "NYSC members"], ["Professional", "Professionals"]]
          .map(([v, l], i) => `<button type="button" class="chip${i === 0 ? " is-on" : ""}" data-v="${v}" aria-pressed="${i === 0}">${l}</button>`).join("")}
      </div>
      <div class="grid-people mt-12" id="homeGrid"></div>
    </section>

    <section class="section bento" aria-label="Get started">
      <a class="bento-tile bento-lg reveal" href="${done ? "#/matches" : "#/quiz"}">
        <span class="kicker">2 minutes</span>
        <h3>${done ? "Your matches are ready" : "Take the compatibility quiz"}</h3>
        <p>${done ? "See everyone ranked by how well you'd live together." : "Money, sleep, cleanliness, visitors and habits. No right or wrong answers."}</p>
        <span class="bento-cta">${done ? "See matches" : "Start now"} ${icon("arrow")}</span>
        <span class="bento-ring" aria-hidden="true">${ring(92, "lg")}</span>
      </a>
      <a class="bento-tile bento-soft reveal" style="--i:1" href="${S.loggedIn ? "#/matches" : "#/signup"}">
        <span class="kicker">Room owners</span>
        <h3>Have a spare room?</h3>
        <p>Choose who joins you, based on how they actually live.</p>
        <span class="bento-cta">${S.loggedIn ? "See who's looking" : "List your room"} ${icon("arrow")}</span>
        <span class="bento-ic" aria-hidden="true">${icon("key")}</span>
      </a>
      <a class="bento-tile bento-ink reveal" style="--i:2" href="#/?s=safety">
        <span class="kicker">Stay safe</span>
        <h3>Never pay before you view</h3>
        <p>Meet in public first and keep chats on RoomPadi until you trust each other.</p>
        <span class="bento-cta">Safety tips ${icon("arrow")}</span>
        <span class="bento-ic" aria-hidden="true">${icon("shield")}</span>
      </a>
    </section>

    <section class="section" id="how" aria-labelledby="how-h">
      <div class="section-head reveal"><div><span class="kicker">How it works</span><h2 id="how-h">Three steps to the right roommate</h2></div></div>
      <ol class="steps">
        ${[["quiz", "Take the quiz", `${QUESTIONS.length} questions about money, sleep, cleanliness, visitors and habits.`],
           ["sparkle", "See your scores", "Everyone gets a compatibility score, with exactly where you agree and where you'd clash."],
           ["chat", "Say hello", "Message privately, meet up, and only move in when you're both sure."]]
          .map(([ic, t, s], i) => `<li class="card reveal" style="--i:${i}"><span class="step-n">${i + 1}</span><span class="perk-ic">${icon(ic)}</span><h3>${t}</h3><p class="muted">${s}</p></li>`).join("")}
      </ol>
    </section>

    <section class="section" id="categories" aria-labelledby="cats-h">
      <div class="section-head reveal"><div><span class="kicker">What we match on</span><h2 id="cats-h">The things roommates actually fight about</h2></div></div>
      <div class="two-col">
        <div class="cat-list">
          ${CATEGORIES.map((c, i) => {
            const n = QUESTIONS.filter((q) => q.cat === c.id).length;
            return `<div class="cat-row reveal" style="--i:${i}"><span class="bubble" style="--h:${hues[i]}">${icon(c.icon)}</span><span class="cat-row-text"><b>${c.name}</b><small>${c.blurb}</small></span><span class="pill pill-blue">${n} question${n > 1 ? "s" : ""}</span></div>`;
          }).join("")}
        </div>
        <div class="card tier-card reveal">
          <h3>Reading your score</h3>
          <p class="muted small">Questions that cause the most problems, like budget, cleanliness and smoking, count more.</p>
          <ul class="tiers">
            <li>${tierPill(90)}<span>85–100%</span></li>
            <li>${tierPill(70)}<span>65–84%</span></li>
            <li>${tierPill(50)}<span>40–64%</span></li>
            <li>${tierPill(20)}<span>Under 40%</span></li>
          </ul>
        </div>
      </div>
    </section>

    <section class="section" id="safety" aria-labelledby="safety-h">
      <div class="safety-band reveal">
        <div>
          <span class="kicker kicker-light">Trust &amp; safety</span>
          <h2 id="safety-h">Safe by default</h2>
          <p>You're deciding who sleeps in the next room. We take that seriously.</p>
          <a href="${S.loggedIn ? "#/verify" : "#/signup"}" class="btn btn-white">${S.loggedIn ? "Check your verification" : "Create a free account"}</a>
        </div>
        <ul class="safety-list">
          <li>${icon("phone")}<div><b>Phone-verified accounts</b><span>Everyone confirms their number before they can message.</span></div></li>
          <li>${icon("id")}<div><b>ID badge</b><span>Student ID, NIN slip or NYSC ID for a verified badge.</span></div></li>
          <li>${icon("lock")}<div><b>Private chat</b><span>Your number is never shown unless you share it.</span></div></li>
          <li>${icon("flag")}<div><b>Report and block</b><span>One tap. We review every report within 24 hours.</span></div></li>
        </ul>
      </div>
    </section>

    <section class="section" id="stories" aria-labelledby="stories-h">
      <div class="section-head reveal"><div><span class="kicker">Sound familiar?</span><h2 id="stories-h">What students in Awka told us</h2></div></div>
      <div class="stories">
        ${[["By second semester her boyfriend had basically moved in. I was paying half the rent for a third of the room.", "300L student, Ifite"],
           ["I found someone in a WhatsApp group. Two months later he stopped contributing to light bill and just ignored me.", "Corps member, Amawbia"],
           ["I sleep at ten. My roommate started making calls at 1am. Every night. We didn't talk for a whole session.", "200L student, Okpuno"]]
          .map(([q, w], i) => `<figure class="card story reveal" style="--i:${i}"><blockquote>"${q}"</blockquote><figcaption>${w}</figcaption></figure>`).join("")}
      </div>
    </section>

    <section class="section" id="faq" aria-labelledby="faq-h">
      <div class="section-head reveal"><div><span class="kicker">FAQ</span><h2 id="faq-h">Questions people ask</h2></div><a href="mailto:hello@roompadi.ng">Email us ${icon("next", "ic--sm")}</a></div>
      <div class="card faq-card">
        ${[
          ["Is RoomPadi free?", "Yes. Taking the quiz, seeing your matches and messaging are free while we launch in Awka."],
          ["How is the score worked out?", "We compare your answers question by question. Budget, cleanliness and smoking count more. You always see the breakdown, not just a number."],
          ["Can people see my phone number?", "No. Numbers stay private. You chat inside RoomPadi and only share your number when you're ready."],
          ["Is this a dating app?", "No. RoomPadi is only for finding someone to share accommodation with. Profiles that use it for anything else get removed."],
          ["I already have a room. Can I use it?", "Yes. When you sign up, say you have a room. People looking for a place will see that on your profile."],
          ["Where does RoomPadi work?", "Awka, around UNIZIK: Ifite, Amansea, Temp Site, Okpuno, Awka town, Agu Awka and Amawbia. More cities are coming."],
        ].map(([q, a]) => `<details class="faq-item"><summary>${q}${icon("plus")}</summary><p>${a}</p></details>`).join("")}
      </div>
    </section>
  </div>`;

  // People grid with chip filters
  const drawPeople = (v) => {
    let ps = done ? scored.map((x) => x.p) : list;
    if (v === "has") ps = ps.filter((p) => p.hasRoom);
    else if (v !== "all") ps = ps.filter((p) => p.type === v);
    $("#homeGrid").innerHTML = ps.slice(0, 10).map((p, i) => personCard(p, i)).join("") ||
      `<p class="muted">No one in this group yet.</p>`;
    reveal($("#homeGrid"));
  };
  $$("#homeChips .chip").forEach((c) => c.addEventListener("click", () => {
    $$("#homeChips .chip").forEach((x) => { x.classList.toggle("is-on", x === c); x.setAttribute("aria-pressed", String(x === c)); });
    drawPeople(c.dataset.v);
  }));
  drawPeople("all");

  setupSlider();
  animateRings();
  reveal();
}

function setupSlider() {
  const slider = $("#slider");
  const slides = $$(".slide", slider);
  const dots = $("#sliderDots");
  let cur = 0;
  dots.innerHTML = slides.map((_, i) => `<button type="button" aria-label="Show slide ${i + 1}" ${i === 0 ? 'aria-current="true"' : ""}><span><i></i></span></button>`).join("");
  const go = (n) => {
    cur = (n + slides.length) % slides.length;
    slides.forEach((s, i) => { s.classList.toggle("is-active", i === cur); s.setAttribute("aria-hidden", String(i !== cur)); $$("a, button", s).forEach((el) => (el.tabIndex = i === cur ? 0 : -1)); });
    $$("button", dots).forEach((d, i) => { if (i === cur) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
    restart();
  };
  const restart = () => {
    clearInterval(sliderTimer);
    if (reduceMotion) return;
    sliderTimer = setInterval(() => { if (!slider.classList.contains("is-paused")) go(cur + 1); }, 6000);
  };
  $$("button", dots).forEach((d, i) => d.addEventListener("click", () => go(i)));
  $("#slidePrev").onclick = () => go(cur - 1);
  $("#slideNext").onclick = () => go(cur + 1);
  slider.addEventListener("mouseenter", () => slider.classList.add("is-paused"));
  slider.addEventListener("mouseleave", () => slider.classList.remove("is-paused"));
  slider.addEventListener("focusin", () => slider.classList.add("is-paused"));
  slider.addEventListener("focusout", () => slider.classList.remove("is-paused"));
  go(0);
  cleanups.push(() => clearInterval(sliderTimer));
}

/* Scroll reveal: the class is added by JS so content still shows without it */
function reveal(root = app) {
  const els = $$(".reveal:not(.in)", root);
  if (reduceMotion || !("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("in"));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
  els.forEach((e) => io.observe(e));
  setTimeout(() => els.forEach((e) => e.classList.add("in")), 2500); // never leave content hidden
}

/* =========================================================
   Quiz – one question per screen
   ========================================================= */
function viewQuiz(q) {
  if (q.get("restart")) { S.answers = {}; save(); history.replaceState(null, "", "#/quiz"); }
  let i = QUESTIONS.findIndex((x) => !(x.id in S.answers));
  if (i === -1) i = QUESTIONS.length; // finished

  const draw = () => {
    if (i >= QUESTIONS.length) return drawDone();
    const item = QUESTIONS[i];
    const cat = CATEGORIES.find((c) => c.id === item.cat);
    const pct = Math.round((i / QUESTIONS.length) * 100);
    app.innerHTML = `
      <section class="quiz">
        <div class="quiz__top container-narrow">
          <a href="#/" class="link-quiet">${icon("x")} Exit</a>
          <span class="quiz__count">Question ${i + 1} of ${QUESTIONS.length}</span>
        </div>
        <div class="progress container-narrow" role="progressbar" aria-valuemin="0" aria-valuemax="${QUESTIONS.length}" aria-valuenow="${i}" aria-label="Quiz progress"><span style="width:${pct}%"></span></div>
        <div class="quiz__card container-narrow" id="qcard">
          <p class="quiz__cat">${icon(cat.icon, "ic--sm")} ${cat.name}</p>
          <h1 id="qtitle">${item.q}</h1>
          ${item.hint ? `<p class="quiz__hint">${item.hint}</p>` : ""}
          <div class="choices" role="radiogroup" aria-labelledby="qtitle">
            ${item.opts.map((o, v) => `
              <button type="button" class="choice${S.answers[item.id] === v ? " on" : ""}" role="radio" aria-checked="${S.answers[item.id] === v}" data-v="${v}">
                <span class="choice__key">${v + 1}</span><span>${o}</span>${icon("check", "choice__tick")}
              </button>`).join("")}
          </div>
          <div class="quiz__nav">
            <button type="button" class="btn btn--quiet" id="prevBtn" ${i === 0 ? "disabled" : ""}>${icon("back")} Back</button>
            <span class="quiz__tip">Tip: press 1–${item.opts.length}</span>
          </div>
        </div>
      </section>`;
    $$(".choice").forEach((b) => b.addEventListener("click", () => pick(Number(b.dataset.v))));
    $("#prevBtn").onclick = () => { if (i > 0) { i--; draw(); } };
    const first = $(".choice.on") || $(".choice");
    first && first.focus({ preventScroll: true });
  };

  const pick = (v) => {
    const item = QUESTIONS[i];
    S.answers[item.id] = v; save();
    $$(".choice").forEach((b) => { const on = Number(b.dataset.v) === v; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
    setTimeout(() => { i++; draw(); }, reduceMotion ? 0 : 260);
  };

  const onKey = (e) => {
    if (location.hash.split("?")[0] !== "#/quiz" || i >= QUESTIONS.length) return;
    const n = Number(e.key);
    if (n >= 1 && n <= QUESTIONS[i].opts.length) pick(n - 1);
  };
  document.addEventListener("keydown", onKey);
  cleanups.push(() => document.removeEventListener("keydown", onKey));

  const drawDone = () => {
    const top = PROFILES.filter((p) => !S.blocked.includes(p.id)).map((p) => compare(S.answers, p).pct).filter((x) => x >= 85).length;
    app.innerHTML = `
      <section class="quiz quiz--done">
        <div class="container-narrow">
          <div class="progress" aria-hidden="true"><span style="width:100%"></span></div>
          <div class="done">
            <p class="kicker">${icon("check", "ic--sm")} Quiz complete</p>
            <h1>Here's how you live</h1>
            <p class="muted">${top ? `${top} ${top === 1 ? "person is" : "people are"} a great match for you in Awka right now.` : "We found people you could live with in Awka."}</p>
            <div class="you">
              ${CATEGORIES.map((c) => `
                <div class="you__row">
                  <span class="you__cat">${icon(c.icon, "ic--sm")} ${c.name}</span>
                  <span class="you__chips">${QUESTIONS.filter((x) => x.cat === c.id).map((x) => `<span class="chip">${label(x, S.answers[x.id])}</span>`).join("")}</span>
                </div>`).join("")}
            </div>
            <div class="done__cta">
              <a href="#/matches" class="btn btn--primary btn--lg">See my matches ${icon("arrow")}</a>
              <a href="#/quiz?restart=1" class="btn btn--quiet btn--lg">Start again</a>
            </div>
            ${S.loggedIn ? "" : `<p class="muted small">You can browse matches as a guest. To message someone, you'll need a free account.</p>`}
          </div>
        </div>
      </section>`;
  };

  draw();
}

/* =========================================================
   Matches dashboard
   ========================================================= */
const F = { q: "", min: 0, area: "", type: "", gender: "", room: "", verified: false, sort: "score" };

function viewMatches(q) {
  if (q && q.has("area")) { F.area = AREAS.includes(q.get("area")) ? q.get("area") : ""; history.replaceState(null, "", "#/matches"); }
  if (!quizDone()) {
    app.innerHTML = `<section class="page container">${emptyState({
      title: "Take the quiz to see your matches",
      text: `It's ${QUESTIONS.length} questions and takes about 2 minutes. We need your answers to work out who you'd live well with.`,
      actions: `<a href="#/quiz" class="btn btn--primary">${answeredCount() ? "Finish the quiz" : "Take the quiz"} ${icon("arrow")}</a>`,
    })}</section>`;
    return;
  }

  app.innerHTML = `
    <section class="page container">
      ${S.loggedIn ? "" : `<div class="notice">${icon("lock")}<p><strong>You're browsing as a guest.</strong> Create a free account to message people.</p><a href="#/signup" class="btn btn--primary btn--sm">Sign up</a></div>`}
      <div class="page__head">
        <div>
          <h1>Your matches</h1>
          <p class="muted" id="matchCount">Finding people in Awka…</p>
        </div>
        <div class="page__tools">
          <button class="btn btn--quiet btn--sm filters-toggle" id="filtersToggle" aria-expanded="false" aria-controls="filters">${icon("sliders")} Filters</button>
          <label class="select-inline">Sort
            <select id="sort">
              <option value="score">Best match</option>
              <option value="name">Name A–Z</option>
              <option value="age">Age</option>
            </select>
          </label>
        </div>
      </div>

      <div class="dash">
        <aside class="filters" id="filters" aria-label="Filters">
          <div class="field">
            <label for="fq">Search</label>
            <div class="input-ic">${icon("search")}<input id="fq" type="search" placeholder="Name, course or job"></div>
          </div>
          <div class="field">
            <label for="fmin">Minimum score <output id="fminOut">0%</output></label>
            <input id="fmin" type="range" min="0" max="95" step="5" value="0">
          </div>
          <div class="field">
            <label for="farea">Area</label>
            <select id="farea"><option value="">Anywhere in Awka</option>${AREAS.map((a) => `<option>${a}</option>`).join("")}</select>
          </div>
          <fieldset class="field">
            <legend>Room</legend>
            <div class="seg" id="froom">
              <button type="button" data-v="" class="on">Any</button>
              <button type="button" data-v="has">Has a room</button>
              <button type="button" data-v="looking">Looking too</button>
            </div>
          </fieldset>
          <div class="field">
            <label for="ftype">They are a</label>
            <select id="ftype"><option value="">Anyone</option>${TYPES.map((t) => `<option value="${t}">${t === "NYSC" ? "NYSC member" : t === "Professional" ? "Working professional" : t}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label for="fgender">Gender</label>
            <select id="fgender"><option value="">Any</option><option value="F">Women</option><option value="M">Men</option></select>
          </div>
          <label class="check"><input type="checkbox" id="fver"><span>Verified profiles only</span></label>
          <button type="button" class="link-btn" id="freset">Reset filters</button>
        </aside>

        <div class="grid-wrap"><div class="mgrid" id="mgrid" aria-busy="true">${Array.from({ length: 6 }, () => skeletonCard()).join("")}</div></div>
      </div>
    </section>`;

  // Restore filter values
  $("#fq").value = F.q; $("#fmin").value = F.min; $("#fminOut").textContent = F.min + "%";
  $("#farea").value = F.area; $("#ftype").value = F.type; $("#fgender").value = F.gender; $("#fver").checked = F.verified; $("#sort").value = F.sort;
  $$("#froom button").forEach((b) => b.classList.toggle("on", b.dataset.v === F.room));

  let list = null;
  const draw = () => list && drawGrid(list);
  $("#fq").addEventListener("input", (e) => { F.q = e.target.value; draw(); });
  $("#fmin").addEventListener("input", (e) => { F.min = Number(e.target.value); $("#fminOut").textContent = F.min + "%"; draw(); });
  $("#farea").addEventListener("change", (e) => { F.area = e.target.value; draw(); });
  $("#ftype").addEventListener("change", (e) => { F.type = e.target.value; draw(); });
  $("#fgender").addEventListener("change", (e) => { F.gender = e.target.value; draw(); });
  $("#fver").addEventListener("change", (e) => { F.verified = e.target.checked; draw(); });
  $("#sort").addEventListener("change", (e) => { F.sort = e.target.value; draw(); });
  $$("#froom button").forEach((b) => b.addEventListener("click", () => {
    F.room = b.dataset.v; $$("#froom button").forEach((x) => x.classList.toggle("on", x === b)); draw();
  }));
  $("#freset").onclick = () => { Object.assign(F, { q: "", min: 0, area: "", type: "", gender: "", room: "", verified: false }); viewMatches(); };
  $("#filtersToggle").onclick = (e) => {
    const open = $("#filters").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  };

  const loadList = () => {
    $("#mgrid").innerHTML = Array.from({ length: 6 }, () => skeletonCard()).join("");
    fetchProfiles()
      .then((ps) => { list = ps.map((p) => ({ p, ...compare(S.answers, p) })); draw(); })
      .catch(() => {
        $("#matchCount").textContent = "";
        $("#mgrid").removeAttribute("aria-busy");
        $("#mgrid").innerHTML = `<div class="span-all">${emptyState({
          kind: "offline", title: "We couldn't load your matches",
          text: "Check your internet connection and try again.",
          actions: `<button class="btn btn--primary" id="retry">Try again</button>`,
        })}</div>`;
        $("#retry").onclick = () => { history.replaceState(null, "", "#/matches"); loadList(); };
      });
  };
  loadList();
}

function skeletonCard() {
  return `<div class="mcard mcard--skel" aria-hidden="true"><div class="sk sk--circle"></div><div class="sk sk--line w70"></div><div class="sk sk--line w50"></div><div class="sk sk--line w90"></div><div class="sk sk--line w60"></div></div>`;
}

function drawGrid(list) {
  const q = F.q.trim().toLowerCase();
  let rows = list.filter(({ p, pct }) =>
    pct >= F.min &&
    (!q || (p.name + " " + p.role).toLowerCase().includes(q)) &&
    (!F.area || p.area === F.area) &&
    (!F.type || p.type === F.type) &&
    (!F.gender || p.gender === F.gender) &&
    (!F.room || (F.room === "has" ? p.hasRoom : !p.hasRoom)) &&
    (!F.verified || p.verified));
  rows.sort((a, b) => F.sort === "name" ? a.p.name.localeCompare(b.p.name) : F.sort === "age" ? a.p.age - b.p.age : b.pct - a.pct);

  const grid = $("#mgrid");
  grid.removeAttribute("aria-busy");
  $("#matchCount").textContent = `${rows.length} ${rows.length === 1 ? "person" : "people"} · sorted by ${F.sort === "score" ? "best match" : F.sort === "name" ? "name" : "age"}`;

  if (!rows.length) {
    grid.innerHTML = `<div class="span-all">${emptyState({
      kind: "search", title: "No one matches these filters",
      text: "Try a lower minimum score or a different area.",
      actions: `<button class="btn btn--primary" id="clearF">Reset filters</button>`,
    })}</div>`;
    $("#clearF").onclick = () => $("#freset").click();
    return;
  }

  grid.innerHTML = rows.map(({ p, pct, good, diff }) => `
    <article class="mcard">
      <div class="mcard__top">
        ${avatar(p)}
        <div class="mcard__who">
          <h2><a href="#/match/${p.id}" class="stretch">${p.name}</a>, ${p.age} ${p.verified ? `<span class="verified" title="Verified">${icon("badge", "ic--sm")}</span>` : ""}</h2>
          <p>${p.role}</p>
        </div>
        ${ring(pct, "sm")}
      </div>
      <div class="mcard__tags">
        ${tierPill(pct)}
        <span class="tag">${icon("pin", "ic--sm")} ${p.area}</span>
        <span class="tag">${icon(p.hasRoom ? "key" : "search", "ic--sm")} ${p.hasRoom ? "Has a room" : "Looking too"}</span>
      </div>
      <ul class="reasons">
        ${good.slice(0, 2).map((r) => `<li class="good">${icon("check", "ic--sm")} ${r.item.same}</li>`).join("")}
        ${diff.slice(0, 1).map((r) => `<li class="diff"><span class="dot"></span> ${r.item.diff}</li>`).join("")}
      </ul>
    </article>`).join("");
  animateRings(grid);
}

/* =========================================================
   Match profile
   ========================================================= */
function viewProfile(id) {
  if (!quizDone()) return viewMatches();
  app.innerHTML = `<section class="page container"><div class="profile profile--skel" aria-busy="true"><div class="sk sk--block"></div><div class="sk sk--block"></div></div></section>`;

  fetchProfiles().then((ps) => {
    const p = ps.find((x) => x.id === id);
    if (!p) {
      app.innerHTML = `<section class="page container">${emptyState({
        kind: "search", title: "We couldn't find that profile",
        text: "They may have found a roommate already, or the link is wrong.",
        actions: `<a href="#/matches" class="btn btn--primary">Back to matches</a>`,
      })}</section>`;
      return;
    }
    const m = compare(S.answers, p);
    const t = tier(m.pct);
    app.innerHTML = `
      <section class="page container">
        <a href="#/matches" class="back">${icon("back")} All matches</a>
        <div class="profile">
          <div class="profile__main">
            <article class="panel profile__card">
              <div class="profile__id">
                ${avatar(p, "xl")}
                <div>
                  <h1>${p.name}, ${p.age} ${p.verified ? `<span class="verified" title="Verified">${icon("badge")}</span>` : ""}</h1>
                  <p>${p.role}</p>
                  <div class="mcard__tags">
                    <span class="tag">${icon("pin", "ic--sm")} ${p.area}</span>
                    <span class="tag">${icon(p.hasRoom ? "key" : "search", "ic--sm")} ${p.hasRoom ? "Has a room" : "Looking for a room too"}</span>
                    <span class="tag">${icon("clock", "ic--sm")} Moving ${p.moveIn === "Flexible" ? "date flexible" : "in " + p.moveIn}</span>
                    ${p.verified ? "" : `<span class="tag tag--muted">Not ID-verified yet</span>`}
                  </div>
                </div>
              </div>
              <h2 class="h3">About ${firstName(p.name)}</h2>
              <p class="profile__bio">${p.bio}</p>
            </article>

            <article class="panel">
              <h2 class="h3">How you compare</h2>
              <div class="breakdown">
                ${m.cats.filter((c) => c.pct !== null).map((c) => `
                  <details class="bd" ${c.pct < 65 ? "open" : ""}>
                    <summary>
                      <span class="bd__name">${icon(c.icon, "ic--sm")} ${c.name}</span>
                      <span class="bd__bar"><i class="bar--${tier(c.pct).key}" style="width:${c.pct}%"></i></span>
                      <span class="bd__pct">${c.pct}%</span>
                      ${icon("down", "ic--sm bd__chev")}
                    </summary>
                    <table class="bd__table">
                      <thead><tr><th scope="col">Question</th><th scope="col">You</th><th scope="col">${firstName(p.name)}</th></tr></thead>
                      <tbody>
                      ${c.rows.map((r) => `
                        <tr class="${r.s === 1 ? "same" : r.s <= 0.5 ? "apart" : "close"}">
                          <td>${r.item.q}</td>
                          <td>${label(r.item, r.mine)}</td>
                          <td>${label(r.item, r.theirs)} <span class="bd__mark">${r.s === 1 ? "Same" : r.s <= 0.5 ? "Different" : "Close"}</span></td>
                        </tr>`).join("")}
                      </tbody>
                    </table>
                  </details>`).join("")}
              </div>
            </article>
          </div>

          <aside class="profile__side">
            <article class="panel score-panel">
              ${ring(m.pct, "xl")}
              ${tierPill(m.pct)}
              <p class="score-panel__text">${t.key === "great" ? `You and ${firstName(p.name)} want very similar things from a home.` : t.key === "good" ? `You'd mostly get along. Talk about the differences before you move in.` : t.key === "some" ? `A few big differences. Worth a frank conversation first.` : `You want quite different things from a home.`}</p>
              <ul class="reasons">
                ${m.good.slice(0, 3).map((r) => `<li class="good">${icon("check", "ic--sm")} ${r.item.same}</li>`).join("")}
                ${m.diff.slice(0, 2).map((r) => `<li class="diff"><span class="dot"></span> ${r.item.diff}</li>`).join("")}
              </ul>
              <button class="btn btn--primary btn--block btn--lg" id="msgBtn">${icon("chat")} Send message</button>
              <p class="muted small center">${S.loggedIn ? (S.account.phoneVerified ? "Your number stays private." : "You'll confirm your phone number first.") : "Free account needed to message."}</p>
            </article>
            <article class="panel tips">
              <h2 class="h3">${icon("shield", "ic--sm")} Before you meet</h2>
              <ul>
                <li>Meet in a public place first, or bring a friend to the viewing.</li>
                <li>Never pay rent or "inspection fees" before you've seen the room.</li>
                <li>Keep chats on RoomPadi until you trust each other.</li>
              </ul>
            </article>
          </aside>
        </div>
      </section>`;
    animateRings();
    $("#msgBtn").onclick = () => {
      const next = `/messages/${p.id}`;
      if (!S.loggedIn) location.hash = `#/signup?next=${encodeURIComponent(next)}`;
      else if (!S.account.phoneVerified) location.hash = `#/verify?next=${encodeURIComponent(next)}`;
      else location.hash = "#" + next;
    };
  }).catch(() => {
    app.innerHTML = `<section class="page container">${emptyState({
      kind: "offline", title: "This profile didn't load", text: "Check your internet connection and try again.",
      actions: `<button class="btn btn--primary" onclick="location.reload()">Try again</button>`,
    })}</section>`;
  });
}

/* =========================================================
   Messages
   ========================================================= */
const GENERIC_REPLIES = [
  "That sounds good to me.",
  "Okay, let's plan a time to meet and see the place.",
  "Thanks for asking. Let me think about it and get back to you today.",
];
const typing = {}; // profileId -> true while a reply is on the way

function viewMessages(id) {
  if (!S.loggedIn) {
    app.innerHTML = `<section class="page container">${emptyState({
      kind: "chat", title: "Log in to see your messages",
      text: "Your conversations are private and only visible to you.",
      actions: `<a href="#/signup?next=/messages" class="btn btn--primary">Create an account</a><a href="#/login?next=/messages" class="btn btn--quiet">Log in</a>`,
    })}</section>`;
    return;
  }
  if (id && !S.account.phoneVerified) { location.hash = `#/verify?next=${encodeURIComponent("/messages/" + id)}`; return; }
  if (id && byId(id) && !S.blocked.includes(id) && !S.threads[id]) { S.threads[id] = []; save(); }
  if (id && (!byId(id) || S.blocked.includes(id))) id = null;
  if (id) { delete S.unread[id]; save(); renderHeader("/messages"); }

  const ids = Object.keys(S.threads).filter((k) => byId(k) && !S.blocked.includes(k))
    .sort((a, b) => (last(b)?.t || 0) - (last(a)?.t || 0));

  if (!ids.length) {
    app.innerHTML = `<section class="page container">${emptyState({
      kind: "chat", title: "No conversations yet",
      text: "When you message a match, your chat will show up here.",
      actions: `<a href="#/matches" class="btn btn--primary">Browse matches ${icon("arrow")}</a>`,
    })}</section>`;
    return;
  }

  app.innerHTML = `
    <section class="chat container ${id ? "chat--open" : ""}">
      <aside class="threads" aria-label="Conversations">
        <h1 class="threads__title">Messages</h1>
        <ul>
          ${ids.map((k) => {
            const p = byId(k), l = last(k);
            return `<li><a href="#/messages/${k}" class="thread ${k === id ? "on" : ""}" ${k === id ? 'aria-current="true"' : ""}>
              ${avatar(p, "sm")}
              <span class="thread__body"><strong>${p.name}</strong><span>${l ? (l.from === "me" ? "You: " : "") + esc(l.text) : "Say hello"}</span></span>
              ${S.unread[k] ? `<span class="count" aria-label="unread">1</span>` : ""}
            </a></li>`;
          }).join("")}
        </ul>
      </aside>
      <div class="convo" id="convo">${id ? "" : `<div class="convo__empty">${illus("chat")}<p>Pick a conversation.</p></div>`}</div>
    </section>`;

  if (id) drawConvo(id);
}

const last = (k) => (S.threads[k] || [])[S.threads[k].length - 1];

function drawConvo(id) {
  const p = byId(id);
  const pct = compare(S.answers, p).pct;
  const msgs = S.threads[id];
  $("#convo").innerHTML = `
    <header class="convo__head">
      <a href="#/messages" class="icon-btn convo__back" aria-label="Back to conversations">${icon("back")}</a>
      ${avatar(p, "sm")}
      <div class="convo__who"><strong>${p.name}</strong><span>${pct}% · ${tier(pct).label}</span></div>
      <a href="#/match/${p.id}" class="btn btn--quiet btn--sm">Profile</a>
      <details class="kebab">
        <summary class="icon-btn" aria-label="More options">${icon("flag")}</summary>
        <div class="kebab__panel">
          <button type="button" id="reportBtn">Report ${firstName(p.name)}</button>
          <button type="button" id="blockBtn" class="danger">Block ${firstName(p.name)}</button>
        </div>
      </details>
    </header>
    <div class="convo__msgs" id="msgs" aria-live="polite">
      <p class="safety-note">${icon("shield", "ic--sm")} Keep chats on RoomPadi until you've met. Never send money before you've seen the room.</p>
      ${msgs.length ? msgs.map(bubble).join("") : `
        <div class="starter">
          <p>Not sure what to say? Try one of these:</p>
          ${[`Hi ${firstName(p.name)}! We matched ${pct}%. Are you still looking for a roommate?`,
             p.hasRoom ? "Is the room still available? I'd love to come and see it." : "Have you found a place yet? Maybe we could look together.",
             "What's a normal day like for you?"].map((s) => `<button type="button" class="chip chip--btn">${esc(s)}</button>`).join("")}
        </div>`}
      ${typing[id] ? `<div class="msg them typing" aria-label="${firstName(p.name)} is typing"><span></span><span></span><span></span></div>` : ""}
    </div>
    <form class="composer" id="composer" autocomplete="off">
      <label class="sr-only" for="msgInput">Message ${firstName(p.name)}</label>
      <input id="msgInput" type="text" maxlength="500" placeholder="Write a message…">
      <button type="submit" class="btn btn--primary btn--icon" aria-label="Send">${icon("send")}</button>
    </form>`;

  const box = $("#msgs");
  box.scrollTop = box.scrollHeight;
  $$(".chip--btn", box).forEach((c) => c.addEventListener("click", () => { $("#msgInput").value = c.textContent; $("#msgInput").focus(); }));
  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#msgInput").value.trim();
    if (!text) return;
    S.threads[id].push({ from: "me", text, t: Date.now() }); save();
    queueReply(id);
    drawConvo(id);
    $("#msgInput").focus();
    refreshThreadPreview(id);
  });
  $("#reportBtn").onclick = () => openReport(p);
  $("#blockBtn").onclick = () => {
    if (!confirm(`Block ${p.name}? You won't see each other on RoomPadi any more.`)) return;
    S.blocked.push(p.id); delete S.threads[p.id]; delete S.unread[p.id]; save();
    toast(`${p.name} has been blocked.`);
    location.hash = "#/messages";
  };
  if (window.innerWidth > 760) $("#msgInput").focus({ preventScroll: true });
}

function bubble(m) {
  const time = new Date(m.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `<div class="msg ${m.from === "me" ? "me" : "them"}"><p>${esc(m.text)}</p><time>${time}</time></div>`;
}

function refreshThreadPreview(id) {
  const a = $(`.thread[href="#/messages/${id}"] .thread__body span`);
  const l = last(id);
  if (a && l) a.textContent = (l.from === "me" ? "You: " : "") + l.text;
}

function queueReply(id) {
  if (typing[id]) return;
  const p = byId(id);
  const theirs = S.threads[id].filter((m) => m.from === "them").length;
  const text = p.replies[theirs] || GENERIC_REPLIES[theirs % GENERIC_REPLIES.length];
  setTimeout(() => {
    typing[id] = true;
    if (location.hash === `#/messages/${id}`) drawConvo(id);
    setTimeout(() => {
      typing[id] = false;
      if (!S.threads[id]) return; // blocked meanwhile
      S.threads[id].push({ from: "them", text, t: Date.now() });
      const viewing = location.hash === `#/messages/${id}`;
      if (!viewing) { S.unread[id] = true; toast(`New message from ${firstName(p.name)}`); }
      save();
      if (viewing) { drawConvo(id); refreshThreadPreview(id); } else renderHeader(location.hash.slice(1));
    }, 1400 + Math.random() * 900);
  }, 600);
}

function openReport(p) {
  const d = document.createElement("dialog");
  d.className = "dialog";
  d.innerHTML = `
    <form method="dialog" class="dialog__body">
      <h2>Report ${p.name}</h2>
      <p class="muted">Your report is private. ${firstName(p.name)} won't know it was you.</p>
      ${["Fake profile or photos", "Asking for money", "Harassment or inappropriate messages", "Using RoomPadi for dating", "Something else"]
        .map((r, i) => `<label class="radio"><input type="radio" name="r" value="${r}" ${i === 0 ? "checked" : ""}><span>${r}</span></label>`).join("")}
      <div class="dialog__actions">
        <button value="cancel" class="btn btn--quiet">Cancel</button>
        <button value="ok" class="btn btn--primary">Send report</button>
      </div>
    </form>`;
  document.body.appendChild(d);
  d.addEventListener("close", () => {
    if (d.returnValue === "ok") toast("Thanks. Our team will review this within 24 hours.");
    d.remove();
  });
  d.showModal();
}

/* =========================================================
   Sign up / Log in / Verify
   ========================================================= */
const PHONE_RE = /^(\+234|0)[789][01]\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fieldErr(form, name, msg) {
  const input = form.elements[name];
  let el = document.getElementById(`${name}-err`);
  if (!el) {
    el = document.createElement("p"); el.className = "err"; el.id = `${name}-err`;
    const field = input.closest(".field");
    if (field) field.appendChild(el); else input.closest("label").after(el);
  }
  el.textContent = msg || "";
  if (input.setAttribute) { input.setAttribute("aria-invalid", msg ? "true" : "false"); if (msg) input.setAttribute("aria-describedby", el.id); }
  return !msg;
}

function viewSignup(q) {
  const next = safeNext(q.get("next"));
  if (S.loggedIn) { location.hash = "#" + next; return; }
  app.innerHTML = `
    <section class="auth container">
      <div class="auth__side">
        <h1>Create your free account</h1>
        <p class="muted">You'll need an account to message people. It takes a minute.</p>
        <ul class="auth__points">
          <li>${icon("lock")} Your phone number is never shown to anyone</li>
          <li>${icon("shield")} Everyone verifies their number before chatting</li>
          <li>${icon("check")} Free while we launch in Awka</li>
        </ul>
      </div>
      <form class="panel auth__form" id="signupForm" novalidate>
        <div class="field"><label for="sName">Full name</label><input id="sName" name="name" autocomplete="name" placeholder="Ngozi Okafor"></div>
        <div class="field"><label for="sEmail">Email</label><input id="sEmail" name="email" type="email" autocomplete="email" placeholder="you@example.com"></div>
        <div class="field"><label for="sPhone">Phone number</label><input id="sPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0803 123 4567"><p class="help">We'll text you a code. It stays private.</p></div>
        <div class="field"><label for="sPass">Password</label><input id="sPass" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
        <div class="field-row">
          <div class="field"><label for="sType">I am a</label>
            <select id="sType" name="type"><option value="Student">Student</option><option value="NYSC">NYSC member</option><option value="Professional">Working professional</option><option value="Graduate">Graduate</option></select></div>
          <div class="field"><label for="sRoom">Right now I</label>
            <select id="sRoom" name="room"><option value="looking">Need a room</option><option value="has">Have a room</option></select></div>
        </div>
        <label class="check"><input type="checkbox" name="terms"><span>I'll use RoomPadi only to find accommodation, and I agree to the community rules.</span></label>
        <button class="btn btn--primary btn--block btn--lg" type="submit">Create account</button>
        <p class="muted small center">Already have an account? <a href="#/login?next=${encodeURIComponent(next)}">Log in</a></p>
      </form>
    </section>`;

  const f = $("#signupForm");
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const phone = (v.phone || "").replace(/[\s-]/g, "");
    let ok = true;
    ok = fieldErr(f, "name", v.name.trim().length < 2 ? "Enter your full name." : "") && ok;
    ok = fieldErr(f, "email", !EMAIL_RE.test(v.email.trim()) ? "Enter a valid email, like you@example.com." : S.account && S.account.email === v.email.trim().toLowerCase() ? "There's already an account with this email. Log in instead." : "") && ok;
    ok = fieldErr(f, "phone", !PHONE_RE.test(phone) ? "Enter a Nigerian number, like 0803 123 4567." : "") && ok;
    ok = fieldErr(f, "password", v.password.length < 8 ? "Use at least 8 characters." : "") && ok;
    ok = fieldErr(f, "terms", !v.terms ? "Please agree to continue." : "") && ok;
    if (!ok) { const first = $('[aria-invalid="true"]', f); first && first.focus(); return; }

    S.account = { name: v.name.trim(), email: v.email.trim().toLowerCase(), phone, pass: hash(v.password), type: v.type, room: v.room, phoneVerified: false, idStatus: "none" };
    S.loggedIn = true; save();
    toast(`Welcome, ${firstName(S.account.name)}!`);
    location.hash = `#/verify?next=${encodeURIComponent(next)}`;
  });
}

function viewLogin(q) {
  const next = safeNext(q.get("next"));
  if (S.loggedIn) { location.hash = "#" + next; return; }
  app.innerHTML = `
    <section class="auth auth--single container">
      <form class="panel auth__form" id="loginForm" novalidate>
        <h1>Welcome back</h1>
        <div class="form-error" id="loginErr" role="alert" hidden></div>
        <div class="field"><label for="lEmail">Email</label><input id="lEmail" name="email" type="email" autocomplete="email"></div>
        <div class="field"><label for="lPass">Password</label><input id="lPass" name="password" type="password" autocomplete="current-password"></div>
        <button class="btn btn--primary btn--block btn--lg" type="submit">Log in</button>
        <p class="muted small center">New here? <a href="#/signup?next=${encodeURIComponent(next)}">Create an account</a></p>
      </form>
    </section>`;
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim().toLowerCase(), pass = e.target.password.value;
    const err = $("#loginErr");
    if (!email || !pass) { err.hidden = false; err.textContent = "Enter your email and password."; return; }
    if (!S.account || S.account.email !== email || S.account.pass !== hash(pass)) {
      err.hidden = false;
      err.textContent = !S.account || S.account.email !== email ? "We can't find an account with that email." : "That password isn't right.";
      return;
    }
    S.loggedIn = true; save();
    toast(`Welcome back, ${firstName(S.account.name)}.`);
    location.hash = "#" + next;
  });
}

function viewVerify(q) {
  const next = safeNext(q.get("next"));
  if (!S.loggedIn) { location.hash = `#/signup?next=${encodeURIComponent(next)}`; return; }
  const A = S.account;
  const step = !A.phoneVerified ? 1 : A.idStatus === "none" && !q.get("done") ? 2 : 3;

  const stepper = `
    <ol class="stepper" aria-label="Verification steps">
      <li class="${step > 1 ? "done" : "on"}"><span>${step > 1 ? icon("check", "ic--sm") : 1}</span> Phone</li>
      <li class="${step > 2 ? "done" : step === 2 ? "on" : ""}"><span>${step > 2 ? icon("check", "ic--sm") : 2}</span> ID <em>(optional)</em></li>
    </ol>`;

  if (step === 1) {
    if (!S.pendingCode) { S.pendingCode = String(Math.floor(100000 + Math.random() * 900000)); save(); }
    const masked = A.phone.replace(/^(\+234|0)(\d{3})\d{4}(\d{3})$/, (_, a, b, c) => `${a}${b} *** *${c}`);
    app.innerHTML = `
      <section class="auth auth--single container">
        <form class="panel auth__form" id="otpForm" novalidate>
          ${stepper}
          <h1>Confirm your number</h1>
          <p class="muted">Enter the 6-digit code we sent to <strong>${esc(masked)}</strong>.</p>
          <p class="demo-note">${icon("phone", "ic--sm")} Preview mode: text messages aren't connected yet. Your code is <strong>${S.pendingCode}</strong>.</p>
          <div class="otp" role="group" aria-label="6-digit code">
            ${Array.from({ length: 6 }, (_, k) => `<input inputmode="numeric" maxlength="1" aria-label="Digit ${k + 1}" autocomplete="${k === 0 ? "one-time-code" : "off"}">`).join("")}
          </div>
          <p class="err" id="otpErr" role="alert"></p>
          <button class="btn btn--primary btn--block btn--lg" type="submit">Verify</button>
          <p class="muted small center"><button type="button" class="link-btn" id="resend" disabled>Resend code in <span id="cd">30</span>s</button></p>
        </form>
      </section>`;
    const boxes = $$(".otp input");
    boxes.forEach((b, k) => {
      b.addEventListener("input", () => { b.value = b.value.replace(/\D/g, "").slice(-1); if (b.value && boxes[k + 1]) boxes[k + 1].focus(); });
      b.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !b.value && boxes[k - 1]) boxes[k - 1].focus(); });
      b.addEventListener("paste", (e) => {
        e.preventDefault();
        const d = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6).split("");
        d.forEach((c, j) => { if (boxes[j]) boxes[j].value = c; });
        (boxes[d.length] || boxes[5]).focus();
      });
    });
    boxes[0].focus();
    let left = 30;
    const timer = setInterval(() => {
      left--; const cd = $("#cd");
      if (!cd) return clearInterval(timer);
      cd.textContent = left;
      if (left <= 0) { clearInterval(timer); $("#resend").disabled = false; $("#resend").textContent = "Resend code"; }
    }, 1000);
    cleanups.push(() => clearInterval(timer));
    $("#resend").onclick = () => { S.pendingCode = null; save(); toast("We've sent a new code."); viewVerify(q); };
    $("#otpForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const code = boxes.map((b) => b.value).join("");
      const err = $("#otpErr");
      if (code.length < 6) { err.textContent = "Enter all 6 digits."; return; }
      if (code !== S.pendingCode) { err.textContent = "That code isn't right. Check it and try again."; boxes.forEach((b) => (b.value = "")); boxes[0].focus(); return; }
      A.phoneVerified = true; S.pendingCode = null; save();
      toast("Phone number confirmed.");
      viewVerify(q);
      renderHeader("/verify");
    });
    return;
  }

  if (step === 2) {
    app.innerHTML = `
      <section class="auth auth--single container">
        <form class="panel auth__form" id="idForm" novalidate>
          ${stepper}
          <h1>Get a verified badge</h1>
          <p class="muted">People are more likely to reply to verified profiles. We only use your ID to confirm who you are. It's never shown to anyone.</p>
          <div class="field"><label for="idType">Document</label>
            <select id="idType" name="idType"><option>Student ID card</option><option>NIN slip</option><option>NYSC ID card</option><option>Voter's card</option><option>Driver's licence</option></select></div>
          <label class="drop" for="idFile">
            ${icon("upload")}
            <span id="dropText"><strong>Choose a photo</strong> of the front of your ID<br><small>JPG, PNG or PDF, up to 5 MB</small></span>
            <input id="idFile" name="file" type="file" accept="image/*,.pdf" class="sr-only">
          </label>
          <p class="err" id="idErr" role="alert"></p>
          <button class="btn btn--primary btn--block btn--lg" type="submit">Submit for review</button>
          <p class="center"><a href="#/verify?done=1&next=${encodeURIComponent(next)}" class="link-quiet">Skip for now</a></p>
        </form>
      </section>`;
    $("#idFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      $("#idErr").textContent = "";
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { $("#idErr").textContent = "That file is over 5 MB. Try a smaller photo."; e.target.value = ""; return; }
      $("#dropText").innerHTML = `<strong>${esc(file.name)}</strong><br><small>Tap to choose a different file</small>`;
      $(".drop").classList.add("has-file");
    });
    $("#idForm").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!$("#idFile").files[0]) { $("#idErr").textContent = "Choose a photo of your ID first, or skip for now."; return; }
      const btn = e.submitter || $("#idForm button[type=submit]");
      btn.disabled = true; btn.textContent = "Uploading…";
      setTimeout(() => { A.idStatus = "pending"; save(); viewVerify(q); }, 900);
    });
    return;
  }

  app.innerHTML = `
    <section class="auth auth--single container">
      <div class="panel auth__form center">
        ${stepper}
        <div class="done-badge">${icon("badge")}</div>
        <h1>You're ready to chat</h1>
        <ul class="status-list">
          <li>${icon("check", "ic--sm")} Phone number confirmed</li>
          <li>${A.idStatus === "pending" ? `${icon("clock", "ic--sm")} ID under review. Usually within 24 hours.` : A.idStatus === "verified" ? `${icon("check", "ic--sm")} ID verified` : `<a href="#/verify">Add your ID later</a> for a verified badge.`}</li>
        </ul>
        <a href="#${next}" class="btn btn--primary btn--block btn--lg">Continue ${icon("arrow")}</a>
      </div>
    </section>`;
  if (A.idStatus === "none") {
    // Let "Add your ID later" reopen step 2
    const a = $(".status-list a");
    a.onclick = (e) => { e.preventDefault(); history.replaceState(null, "", `#/verify?next=${encodeURIComponent(next)}`); viewVerify(new URLSearchParams(`next=${next}`)); };
  }
}

/* =========================================================
   Router
   ========================================================= */
let cleanups = [];
const ROUTES = [
  [/^\/$/, (m, q) => viewLanding(q)],
  [/^\/quiz$/, (m, q) => viewQuiz(q)],
  [/^\/matches$/, (m, q) => viewMatches(q)],
  [/^\/match\/([\w-]+)$/, (m) => viewProfile(m[1])],
  [/^\/messages(?:\/([\w-]+))?$/, (m) => viewMessages(m[1])],
  [/^\/signup$/, (m, q) => viewSignup(q)],
  [/^\/login$/, (m, q) => viewLogin(q)],
  [/^\/verify$/, (m, q) => viewVerify(q)],
];

function render() {
  cleanups.forEach((fn) => fn()); cleanups = [];
  const raw = location.hash.slice(1) || "/";
  const [path, qs] = raw.split("?");
  const q = new URLSearchParams(qs || "");
  $("#header").classList.remove("open");
  renderHeader(path);
  renderFooter(path);
  document.body.dataset.route = path.split("/")[1] || "home";

  const route = ROUTES.find(([re]) => re.test(path));
  if (route) route[1](path.match(route[0]), q);
  else app.innerHTML = `<section class="page container">${emptyState({ title: "Page not found", text: "That link doesn't go anywhere.", actions: `<a href="#/" class="btn btn--primary">Go home</a>` })}</section>`;

  const section = q.get("s");
  if (section && document.getElementById(section)) document.getElementById(section).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  else window.scrollTo(0, 0);
  if (!section && path !== "/") app.focus({ preventScroll: true });
}

/* Same-page section links (#/?s=faq) when already on the landing page */
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#/?s="]');
  if (!a || (location.hash.split("?")[0] || "#/") !== "#/" && location.hash !== "") return;
  const id = new URLSearchParams(a.getAttribute("href").split("?")[1]).get("s");
  const el = document.getElementById(id);
  if (el) { e.preventDefault(); el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); $("#header").classList.remove("open"); }
});

/* Close open menus when clicking elsewhere */
document.addEventListener("click", (e) => {
  $$("details.usermenu[open], details.kebab[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});

window.addEventListener("hashchange", render);
render();
