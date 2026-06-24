// Public poll widget
// -------------------
// renderPoll(container, pollId) draws a poll's questions + comment box into a
// container element, accepts a submission, and reveals results according to the
// poll's revealAt / closesAt timestamps. It is used by poll.html and by the
// copy-paste embed snippet the admin console generates.
//
// The reveal rules are ALSO enforced server-side in firestore.rules — the JS
// here just reflects them. If results aren't readable yet, Firestore denies the
// read and we show the "results hidden" notice.
import { db, auth } from "./firebase-config.js";
import {
  doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// ---------- small helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const toDate = (ts) => (ts && typeof ts.toDate === "function") ? ts.toDate()
  : (ts ? new Date(ts) : null);
const fmt = (d) => d ? d.toLocaleString(undefined, {
  dateStyle: "medium", timeStyle: "short"
}) : "";
const pct = (n, total) => total > 0 ? Math.round((n / total) * 100) : 0;

function injectStyles() {
  if (document.getElementById("pollx-styles")) return;
  const style = document.createElement("style");
  style.id = "pollx-styles";
  style.textContent = `
  .pollx{max-width:680px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.5;box-sizing:border-box}
  .pollx *{box-sizing:border-box}
  .pollx h1{font-size:1.5rem;margin:0 0 .25rem}
  .pollx .pollx-desc{color:#555;margin:0 0 1.25rem}
  .pollx .pollx-q{background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:1rem 1.15rem;margin:0 0 1rem}
  .pollx .pollx-q h3{margin:0 0 .6rem;font-size:1.05rem}
  .pollx label.pollx-opt{display:flex;align-items:center;gap:.6rem;padding:.55rem .65rem;border:1px solid #e6e6e6;border-radius:9px;margin:.4rem 0;cursor:pointer;transition:border-color .15s,background .15s}
  .pollx label.pollx-opt:hover{border-color:#9db4ff;background:#f6f8ff}
  .pollx input[type=radio],.pollx input[type=checkbox]{width:18px;height:18px;accent-color:#3b5bdb;flex:0 0 auto}
  .pollx textarea,.pollx input[type=text]{width:100%;padding:.6rem .7rem;border:1px solid #d8d8d8;border-radius:9px;font:inherit;resize:vertical}
  .pollx textarea:focus,.pollx input[type=text]:focus{outline:none;border-color:#3b5bdb;box-shadow:0 0 0 3px rgba(59,91,219,.15)}
  .pollx .pollx-btn{display:inline-block;background:#3b5bdb;color:#fff;border:0;border-radius:9px;padding:.65rem 1.2rem;font:inherit;font-weight:600;cursor:pointer}
  .pollx .pollx-btn:hover{background:#2f49b3}
  .pollx .pollx-btn:disabled{opacity:.55;cursor:not-allowed}
  .pollx .pollx-note{background:#f1f3f9;border:1px solid #e0e4f2;border-radius:10px;padding:.8rem 1rem;color:#33405e;margin:1rem 0}
  .pollx .pollx-err{background:#fff1f0;border:1px solid #ffccc7;color:#a8071a}
  .pollx .pollx-ok{background:#f0fbf4;border:1px solid #c6efd3;color:#0b6b32}
  .pollx .pollx-bar{position:relative;background:#eef0f4;border-radius:8px;height:34px;margin:.45rem 0;overflow:hidden}
  .pollx .pollx-bar > span{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#5878f0,#3b5bdb);border-radius:8px;transition:width .5s ease}
  .pollx .pollx-bar > em{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 .7rem;font-style:normal;font-size:.9rem;font-weight:600;color:#1a1a1a;mix-blend-mode:normal}
  .pollx .pollx-section-title{font-size:1.15rem;margin:1.75rem 0 .75rem;padding-top:1.25rem;border-top:1px solid #ececec}
  .pollx .pollx-comment{border:1px solid #eee;border-radius:10px;padding:.65rem .8rem;margin:.5rem 0}
  .pollx .pollx-comment .pollx-cmeta{font-size:.8rem;color:#888;margin-bottom:.2rem}
  .pollx .pollx-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-start}
  .pollx .pollx-row input[type=text]{flex:1;min-width:160px}
  .pollx .pollx-muted{color:#888;font-size:.9rem}
  .pollx .pollx-textans{background:#f7f8fa;border-radius:8px;padding:.5rem .7rem;margin:.4rem 0}`;
  document.head.appendChild(style);
}

// ---------- main entry ----------
export async function renderPoll(root, pollId) {
  injectStyles();
  root.classList.add("pollx");
  root.innerHTML = `<p class="pollx-muted">Loading…</p>`;

  if (!pollId) { root.innerHTML = notice("No poll id was provided.", "err"); return; }

  let snap;
  try {
    snap = await getDoc(doc(db, "polls", pollId));
  } catch (e) {
    root.innerHTML = notice("Could not load this poll. Check your connection.", "err");
    return;
  }
  if (!snap.exists()) { root.innerHTML = notice("This poll could not be found.", "err"); return; }

  const poll = snap.data();
  const questions = Array.isArray(poll.questions) ? poll.questions : [];
  const closesAt = toDate(poll.closesAt);
  const revealAt = toDate(poll.revealAt);
  const now = new Date();
  const isOpen = !closesAt || now < closesAt;

  // Sign in anonymously so the user can vote/comment (one vote per anon user).
  // If an admin is already signed in (same browser), keep their session.
  let uid = auth.currentUser?.uid ?? null;
  let authReady = !!uid;
  if (!uid) {
    try { const cred = await signInAnonymously(auth); uid = cred.user.uid; authReady = true; }
    catch (e) { authReady = false; } // anonymous auth not enabled — voting disabled
  }

  // Did this browser already vote? (instant UX; the server rule is the real guard)
  const votedKey = `pollx_voted_${pollId}`;
  let alreadyVoted = localStorage.getItem(votedKey) === "1";

  render();

  function render() {
    root.innerHTML = `
      <h1>${esc(poll.title || "Poll")}</h1>
      ${poll.description ? `<p class="pollx-desc">${esc(poll.description)}</p>` : ""}
      <div id="pollx-body"></div>
      <div id="pollx-results"></div>
      ${poll.allowComments ? `<div id="pollx-comments"></div>` : ""}
    `;
    renderBody();
    renderResults();
    if (poll.allowComments) renderComments();
  }

  // ----- voting form / status -----
  function renderBody() {
    const body = root.querySelector("#pollx-body");
    if (!questions.length) { body.innerHTML = ""; return; }

    if (!isOpen) {
      body.innerHTML = notice(`This poll closed on ${fmt(closesAt)}.`, "");
      return;
    }
    if (alreadyVoted) {
      body.innerHTML = notice("Thanks — your response has been recorded.", "ok");
      return;
    }
    if (!authReady) {
      body.innerHTML = notice(
        "Voting is temporarily unavailable. (The site owner needs to enable Anonymous sign-in in Firebase.)",
        "err");
      return;
    }

    body.innerHTML = `
      <form id="pollx-form">
        ${questions.map(renderQuestionInput).join("")}
        <button type="submit" class="pollx-btn">Submit</button>
        <span id="pollx-form-msg" class="pollx-muted"></span>
      </form>`;
    body.querySelector("#pollx-form").addEventListener("submit", onSubmit);
  }

  function renderQuestionInput(q) {
    const opts = Array.isArray(q.options) ? q.options : [];
    let inner = "";
    if (q.type === "text") {
      inner = `<textarea name="${esc(q.id)}" rows="3" placeholder="Your answer…"></textarea>`;
    } else {
      const inputType = q.type === "multiple" ? "checkbox" : "radio";
      inner = opts.map((o) => `
        <label class="pollx-opt">
          <input type="${inputType}" name="${esc(q.id)}" value="${esc(o.id)}">
          <span>${esc(o.label)}</span>
        </label>`).join("");
    }
    return `<div class="pollx-q"><h3>${esc(q.title)}</h3>${inner}</div>`;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = form.querySelector("#pollx-form-msg");
    const btn = form.querySelector("button");
    const answers = {};
    for (const q of questions) {
      if (q.type === "text") {
        const v = (form.elements[q.id]?.value || "").trim();
        if (v) answers[q.id] = v.slice(0, 2000);
      } else if (q.type === "multiple") {
        const checked = [...form.querySelectorAll(`input[name="${cssEscape(q.id)}"]:checked`)].map(i => i.value);
        if (checked.length) answers[q.id] = checked;
      } else {
        const picked = form.querySelector(`input[name="${cssEscape(q.id)}"]:checked`);
        if (picked) answers[q.id] = picked.value;
      }
    }
    if (Object.keys(answers).length === 0) {
      msg.textContent = "Please answer at least one question.";
      return;
    }

    btn.disabled = true; msg.textContent = "Submitting…";
    try {
      await setDoc(doc(db, "polls", pollId, "responses", uid), {
        answers,
        createdAt: serverTimestamp()
      });
      localStorage.setItem(votedKey, "1");
      alreadyVoted = true;
      render();
    } catch (err) {
      btn.disabled = false;
      if (String(err?.code).includes("permission-denied")) {
        // Either the poll just closed, or this user already voted.
        localStorage.setItem(votedKey, "1");
        alreadyVoted = true;
        render();
      } else {
        msg.textContent = "Something went wrong. Please try again.";
      }
    }
  }

  // ----- results (reveal-gated) -----
  async function renderResults() {
    const el = root.querySelector("#pollx-results");
    if (!questions.length) { el.innerHTML = ""; return; }

    let responses = null;
    try {
      const rs = await getDocs(collection(db, "polls", pollId, "responses"));
      responses = rs.docs.map(d => d.data());
    } catch (e) {
      responses = null; // read denied -> results still hidden
    }

    if (responses === null) {
      el.innerHTML = `<h2 class="pollx-section-title">Results</h2>` +
        notice(`Results are hidden until ${fmt(revealAt)}.`, "");
      return;
    }

    const total = responses.length;
    el.innerHTML = `<h2 class="pollx-section-title">Results</h2>` +
      `<p class="pollx-muted">${total} ${total === 1 ? "response" : "responses"} so far.</p>` +
      questions.map(q => renderQuestionResult(q, responses)).join("");
  }

  function renderQuestionResult(q, responses) {
    if (q.type === "text") {
      const answers = responses.map(r => r.answers?.[q.id]).filter(Boolean);
      const list = answers.length
        ? answers.map(a => `<div class="pollx-textans">${esc(a)}</div>`).join("")
        : `<p class="pollx-muted">No answers yet.</p>`;
      return `<div class="pollx-q"><h3>${esc(q.title)}</h3>${list}</div>`;
    }
    const opts = Array.isArray(q.options) ? q.options : [];
    const counts = Object.fromEntries(opts.map(o => [o.id, 0]));
    let answered = 0;
    for (const r of responses) {
      const a = r.answers?.[q.id];
      if (a == null) continue;
      answered++;
      const picks = Array.isArray(a) ? a : [a];
      for (const p of picks) if (p in counts) counts[p]++;
    }
    const bars = opts.map(o => {
      const c = counts[o.id];
      const p = pct(c, answered);
      return `<div>
        <div class="pollx-muted">${esc(o.label)}</div>
        <div class="pollx-bar"><span style="width:${p}%"></span>
          <em><span>${p}%</span><span>${c}</span></em></div>
      </div>`;
    }).join("");
    return `<div class="pollx-q"><h3>${esc(q.title)}</h3>${bars}</div>`;
  }

  // ----- comments -----
  async function renderComments() {
    const el = root.querySelector("#pollx-comments");
    el.innerHTML = `<h2 class="pollx-section-title">Comments</h2><div id="pollx-clist"><p class="pollx-muted">Loading…</p></div>`;

    if (isOpen && authReady) {
      el.insertAdjacentHTML("beforeend", `
        <form id="pollx-cform" style="margin-top:.75rem">
          <div class="pollx-row">
            <input type="text" id="pollx-cname" placeholder="Name (optional)" maxlength="60">
          </div>
          <textarea id="pollx-ctext" rows="2" placeholder="Add a comment…" maxlength="2000" style="margin-top:.5rem"></textarea>
          <div style="margin-top:.5rem"><button class="pollx-btn" type="submit">Post comment</button>
            <span id="pollx-cmsg" class="pollx-muted"></span></div>
        </form>`);
      el.querySelector("#pollx-cform").addEventListener("submit", onComment);
    } else if (!isOpen) {
      el.insertAdjacentHTML("beforeend", `<p class="pollx-muted" style="margin-top:.5rem">Commenting is closed.</p>`);
    }

    await loadComments();
  }

  async function loadComments() {
    const list = root.querySelector("#pollx-clist");
    if (!list) return;
    try {
      const q = query(collection(db, "polls", pollId, "comments"), orderBy("createdAt", "desc"));
      const cs = await getDocs(q);
      if (cs.empty) { list.innerHTML = `<p class="pollx-muted">No comments yet. Be the first!</p>`; return; }
      list.innerHTML = cs.docs.map(d => {
        const c = d.data();
        return `<div class="pollx-comment">
          <div class="pollx-cmeta">${esc(c.name || "Anonymous")} · ${fmt(toDate(c.createdAt) || now)}</div>
          <div>${esc(c.text)}</div></div>`;
      }).join("");
    } catch (e) {
      list.innerHTML = notice("Could not load comments.", "err");
    }
  }

  async function onComment(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.querySelector("#pollx-cname").value.trim().slice(0, 60);
    const text = form.querySelector("#pollx-ctext").value.trim();
    const msg = form.querySelector("#pollx-cmsg");
    if (!text) { msg.textContent = "Please write something first."; return; }
    const btn = form.querySelector("button");
    btn.disabled = true; msg.textContent = "Posting…";
    try {
      await addDoc(collection(db, "polls", pollId, "comments"), {
        name: name || "Anonymous",
        text: text.slice(0, 2000),
        createdAt: serverTimestamp()
      });
      form.querySelector("#pollx-ctext").value = "";
      msg.textContent = "";
      btn.disabled = false;
      await loadComments();
    } catch (err) {
      btn.disabled = false;
      msg.textContent = "Could not post your comment.";
    }
  }
}

function notice(text, kind) {
  const cls = kind === "err" ? "pollx-note pollx-err"
    : kind === "ok" ? "pollx-note pollx-ok" : "pollx-note";
  return `<div class="${cls}">${esc(text)}</div>`;
}

// CSS.escape isn't available everywhere for attribute selectors; ids we make are
// uuid-safe, but guard anyway.
function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}
