// Public poll widget
// -------------------
// renderPoll(container, pollId) draws a poll's questions + comment box into a
// container, accepts a submission, and reveals results per the poll's
// revealAt / closesAt timestamps. Used by poll.html and the embed snippets.
//
// Question types:
//   single   - multiple choice, pick one      (aggregated, public after reveal)
//   multiple - checkboxes, pick many           (aggregated, public after reveal)
//   rank     - click options in preferred order (aggregated, public after reveal)
//   short    - one-line text (name, member #…)  (PRIVATE: admin-only)
//   text     - long free text                   (PRIVATE: admin-only)
//
// Vote-type answers go to polls/{id}/responses/{uid} (publicly readable only
// after revealAt, for tallying). Text answers go to polls/{id}/details/{uid},
// which is NEVER public — only admins (and the author) can read it. That keeps
// names / member numbers out of the public results.
import { db, auth } from "./firebase-config.js";
import {
  doc, getDoc, getDocs, setDoc, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore-lite.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const VOTE_TYPES = ["single", "multiple", "rank"];
const TEXT_TYPES = ["short", "text"];

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
  .pollx .pollx-closes{color:#33405e;font-size:.9rem;margin:.1rem 0 1.1rem;font-weight:600}
  .pollx .pollx-q{background:#fff;border:1px solid #e6e6e6;border-radius:12px;padding:1rem 1.15rem;margin:0 0 1rem}
  .pollx .pollx-q h3{margin:0 0 .6rem;font-size:1.05rem}
  .pollx .pollx-req{color:#c0392b}
  .pollx .pollx-hint{font-size:.85rem;color:#666;margin:.1rem 0 .6rem}
  .pollx label.pollx-opt,.pollx .pollx-opt{display:flex;align-items:center;gap:.6rem;padding:.55rem .65rem;border:1px solid #e6e6e6;border-radius:9px;margin:.4rem 0;cursor:pointer;transition:border-color .15s,background .15s}
  .pollx label.pollx-opt:hover,.pollx .pollx-opt:hover{border-color:#9db4ff;background:#f6f8ff}
  .pollx input[type=radio],.pollx input[type=checkbox]{width:18px;height:18px;accent-color:#3b5bdb;flex:0 0 auto}
  .pollx textarea,.pollx input[type=text]{width:100%;padding:.6rem .7rem;border:1px solid #d8d8d8;border-radius:9px;font:inherit;resize:vertical}
  .pollx textarea:focus,.pollx input[type=text]:focus{outline:none;border-color:#3b5bdb;box-shadow:0 0 0 3px rgba(59,91,219,.15)}
  .pollx .pollx-rankopt{user-select:none}
  .pollx .pollx-rankopt.selected{border-color:#3b5bdb;background:#eef2ff}
  .pollx .pollx-rankbadge{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;border:2px solid #c9d2f0;color:#3b5bdb;font-weight:700;font-size:.8rem;flex:0 0 auto}
  .pollx .pollx-rankopt.selected .pollx-rankbadge{background:#3b5bdb;color:#fff;border-color:#3b5bdb}
  .pollx .pollx-btn{display:inline-block;background:#3b5bdb;color:#fff;border:0;border-radius:9px;padding:.65rem 1.2rem;font:inherit;font-weight:600;cursor:pointer}
  .pollx .pollx-btn:hover{background:#2f49b3}
  .pollx .pollx-btn:disabled{opacity:.55;cursor:not-allowed}
  .pollx .pollx-note{background:#f1f3f9;border:1px solid #e0e4f2;border-radius:10px;padding:.8rem 1rem;color:#33405e;margin:1rem 0}
  .pollx .pollx-err{background:#fff1f0;border:1px solid #ffccc7;color:#a8071a}
  .pollx .pollx-ok{background:#f0fbf4;border:1px solid #c6efd3;color:#0b6b32}
  .pollx .pollx-bar{position:relative;background:#eef0f4;border-radius:8px;height:34px;margin:.45rem 0;overflow:hidden}
  .pollx .pollx-bar > span{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#5878f0,#3b5bdb);border-radius:8px;transition:width .5s ease}
  .pollx .pollx-bar > em{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 .7rem;font-style:normal;font-size:.9rem;font-weight:600;color:#1a1a1a}
  .pollx .pollx-section-title{font-size:1.15rem;margin:1.75rem 0 .75rem;padding-top:1.25rem;border-top:1px solid #ececec}
  .pollx .pollx-comment{border:1px solid #eee;border-radius:10px;padding:.65rem .8rem;margin:.5rem 0}
  .pollx .pollx-comment .pollx-cmeta{font-size:.8rem;color:#888;margin-bottom:.2rem}
  .pollx .pollx-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-start}
  .pollx .pollx-row input[type=text]{flex:1;min-width:160px}
  .pollx .pollx-muted{color:#888;font-size:.9rem}
  .pollx .pollx-thanks{font-size:1.1rem;padding:1rem 1.15rem;display:flex;gap:.5rem;align-items:center;position:sticky;bottom:8px}`;
  document.head.appendChild(style);
}

const reqMark = (q) => q.required ? ` <span class="pollx-req" title="required">*</span>` : "";

// ---------- main entry ----------
export async function renderPoll(root, pollId) {
  injectStyles();
  root.classList.add("pollx");
  root.innerHTML = `<p class="pollx-muted">Loading…</p>`;

  if (!pollId) { root.innerHTML = notice("No poll id was provided.", "err"); return; }

  // Start anonymous sign-in immediately, in parallel with loading the poll, so
  // there's no extra round-trip before the form is ready to submit.
  const authPromise = auth.currentUser
    ? Promise.resolve(auth.currentUser)
    : signInAnonymously(auth).then(c => c.user).catch(() => null);

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

  // Anonymous sign-in was kicked off above; await its result here.
  const authedUser = await authPromise;
  let uid = authedUser?.uid ?? null;
  let authReady = !!uid;

  const votedKey = `pollx_voted_${pollId}`;
  let alreadyVoted = localStorage.getItem(votedKey) === "1";
  // The server is the source of truth: if an admin deletes this person's vote,
  // they should see the form again even though localStorage remembered voting.
  if (uid) {
    try {
      const own = await getDoc(doc(db, "polls", pollId, "responses", uid));
      alreadyVoted = own.exists();
      if (alreadyVoted) localStorage.setItem(votedKey, "1"); else localStorage.removeItem(votedKey);
    } catch (e) { /* read not allowed / offline — keep the localStorage hint */ }
  }

  // Ranking-question state: qid -> ordered array of chosen option ids.
  const rankState = {};
  function paintRank(container, qid) {
    const arr = rankState[qid] || [];
    container.querySelectorAll("[data-rank-opt]").forEach((el) => {
      const pos = arr.indexOf(el.dataset.rankOpt);
      const badge = el.querySelector(".pollx-rankbadge");
      if (pos === -1) { el.classList.remove("selected"); badge.textContent = ""; }
      else { el.classList.add("selected"); badge.textContent = String(pos + 1); }
    });
  }

  render();

  function render() {
    root.innerHTML = `
      <h1>${esc(poll.title || "Poll")}</h1>
      ${poll.description ? `<p class="pollx-desc">${esc(poll.description)}</p>` : ""}
      ${isOpen && closesAt ? `<p class="pollx-closes">🗳️ Voting closes ${fmt(closesAt)}</p>` : ""}
      <div id="pollx-body"></div>
      <div id="pollx-results"></div>
    `;
    renderBody();
    renderResults();
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

    // Wire up ranking questions (click options in order of preference).
    body.querySelectorAll("[data-rank-q]").forEach((container) => {
      const qid = container.dataset.rankQ;
      const pick = (el) => {
        const oid = el?.dataset.rankOpt; if (!oid) return;
        const arr = rankState[qid] || (rankState[qid] = []);
        const i = arr.indexOf(oid);
        if (i === -1) arr.push(oid); else arr.splice(i, 1);
        paintRank(container, qid);
      };
      container.addEventListener("click", (e) => pick(e.target.closest("[data-rank-opt]")));
      container.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e.target.closest("[data-rank-opt]")); }
      });
      paintRank(container, qid);
    });

    // Conditional questions: re-evaluate which questions show whenever an answer
    // changes, and once on first render.
    const formEl = body.querySelector("#pollx-form");
    formEl.addEventListener("change", applyConditions);
    formEl.addEventListener("input", applyConditions);
    applyConditions();
  }

  // Show/hide conditional questions based on current answers. A question with
  // showIf appears only when its controlling question is visible AND the chosen
  // option is selected. Hidden questions are cleared so they don't carry stale
  // answers (and don't trigger downstream conditions or get submitted).
  function applyConditions() {
    const form = root.querySelector("#pollx-form");
    if (!form) return;
    const visible = {}, selected = {};
    for (const q of questions) {
      let show = true;
      if (q.showIf && q.showIf.questionId) {
        const sel = selected[q.showIf.questionId];
        show = !!visible[q.showIf.questionId] && !!sel && sel.has(q.showIf.optionId);
      }
      visible[q.id] = show;
      const el = form.querySelector(`[data-qid="${cssEscape(q.id)}"]`);
      if (el) el.style.display = show ? "" : "none";
      if (!show) clearQuestion(form, q);
      selected[q.id] = (show && (q.type === "single" || q.type === "multiple"))
        ? new Set([...form.querySelectorAll(`input[name="${cssEscape(q.id)}"]:checked`)].map(i => i.value))
        : new Set();
    }
  }

  function clearQuestion(form, q) {
    if (q.type === "single" || q.type === "multiple") {
      form.querySelectorAll(`input[name="${cssEscape(q.id)}"]`).forEach(i => { i.checked = false; });
    } else if (q.type === "rank") {
      rankState[q.id] = [];
      const c = form.querySelector(`[data-rank-q="${cssEscape(q.id)}"]`);
      if (c) paintRank(c, q.id);
    } else {
      const el = form.elements[q.id];
      if (el) el.value = "";
    }
  }

  function renderQuestionInput(q) {
    const opts = Array.isArray(q.options) ? q.options : [];
    let inner = "";
    if (q.type === "short") {
      inner = `<input type="text" name="${esc(q.id)}" placeholder="Your answer…" maxlength="200">`;
    } else if (q.type === "text") {
      inner = `<textarea name="${esc(q.id)}" rows="3" placeholder="Your answer…"></textarea>`;
    } else if (q.type === "rank") {
      inner = `<p class="pollx-hint">Click options in your order of preference — 1 = most preferred. Click again to remove.</p>
        <div class="pollx-rank" data-rank-q="${esc(q.id)}">
          ${opts.map((o) => `
          <div class="pollx-opt pollx-rankopt" data-rank-opt="${esc(o.id)}" role="button" tabindex="0">
            <span class="pollx-rankbadge"></span><span>${esc(o.label)}</span>
          </div>`).join("")}
        </div>`;
    } else {
      const inputType = q.type === "multiple" ? "checkbox" : "radio";
      inner = opts.map((o) => `
        <label class="pollx-opt">
          <input type="${inputType}" name="${esc(q.id)}" value="${esc(o.id)}">
          <span>${esc(o.label)}</span>
        </label>`).join("");
    }
    return `<div class="pollx-q" data-qid="${esc(q.id)}"${q.showIf ? ' style="display:none"' : ''}><h3>${esc(q.title)}${reqMark(q)}</h3>${inner}</div>`;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = form.querySelector("#pollx-form-msg");
    const btn = form.querySelector("button");

    const votes = {};    // single / multiple / rank  -> responses doc
    const details = {};  // short / text              -> admin-only details doc
    for (const q of questions) {
      const qEl = form.querySelector(`[data-qid="${cssEscape(q.id)}"]`);
      if (qEl && qEl.style.display === "none") continue; // skip hidden conditional questions
      if (q.type === "short" || q.type === "text") {
        const v = (form.elements[q.id]?.value || "").trim();
        if (v) details[q.id] = v.slice(0, q.type === "short" ? 200 : 2000);
      } else if (q.type === "rank") {
        const arr = rankState[q.id] || [];
        if (arr.length) votes[q.id] = arr.slice();
      } else if (q.type === "multiple") {
        const checked = [...form.querySelectorAll(`input[name="${cssEscape(q.id)}"]:checked`)].map(i => i.value);
        if (checked.length) votes[q.id] = checked;
      } else {
        const picked = form.querySelector(`input[name="${cssEscape(q.id)}"]:checked`);
        if (picked) votes[q.id] = picked.value;
      }
    }

    const answered = new Set([...Object.keys(votes), ...Object.keys(details)]);
    const missing = questions.filter(q => {
      if (!q.required || answered.has(q.id)) return false;
      const qEl = form.querySelector(`[data-qid="${cssEscape(q.id)}"]`);
      return !(qEl && qEl.style.display === "none"); // hidden conditional → not required
    });
    if (missing.length) {
      msg.textContent = `Please answer: ${missing.map(q => q.title).join(", ")}`;
      return;
    }
    if (answered.size === 0) {
      msg.textContent = "Please answer at least one question.";
      return;
    }

    btn.disabled = true; msg.textContent = "Submitting…";
    try {
      await setDoc(doc(db, "polls", pollId, "responses", uid), {
        answers: votes,
        createdAt: serverTimestamp()
      });
      if (Object.keys(details).length) {
        await setDoc(doc(db, "polls", pollId, "details", uid), {
          answers: details,
          createdAt: serverTimestamp()
        });
      }
      localStorage.setItem(votedKey, "1");
      alreadyVoted = true;
      confirmSubmitted(form);
    } catch (err) {
      btn.disabled = false;
      if (String(err?.code).includes("permission-denied")) {
        localStorage.setItem(votedKey, "1");
        alreadyVoted = true;
        confirmSubmitted(form);
      } else {
        msg.textContent = "Something went wrong. Please try again.";
      }
    }
  }

  // ----- results (reveal-gated; aggregates only, no private text) -----
  async function renderResults() {
    const el = root.querySelector("#pollx-results");
    const voteQs = questions.filter(q => VOTE_TYPES.includes(q.type));
    if (!voteQs.length) { el.innerHTML = ""; return; }

    // Poll owner chose to keep results private: show the public nothing at all
    // here — no "Results" heading, no placeholder. The voting-close date is
    // already shown at the top of the poll, which is all the public needs.
    if (poll.hideResults) { el.innerHTML = ""; return; }

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
      voteQs.map(q => renderQuestionResult(q, responses)).join("");
  }

  function renderQuestionResult(q, responses) {
    if (q.type === "rank") {
      const opts = Array.isArray(q.options) ? q.options : [];
      const N = opts.length;
      const points = Object.fromEntries(opts.map(o => [o.id, 0]));
      const rankSum = Object.fromEntries(opts.map(o => [o.id, 0]));
      const rankCount = Object.fromEntries(opts.map(o => [o.id, 0]));
      let voters = 0;
      for (const r of responses) {
        const order = r.answers?.[q.id];
        if (!Array.isArray(order) || !order.length) continue;
        voters++;
        order.forEach((oid, i) => {
          if (oid in points) { points[oid] += (N - i); rankSum[oid] += (i + 1); rankCount[oid]++; }
        });
      }
      const maxPoints = Math.max(1, ...opts.map(o => points[o.id]));
      const sorted = [...opts].sort((a, b) => points[b.id] - points[a.id]);
      const bars = sorted.map(o => {
        const w = Math.round(points[o.id] / maxPoints * 100);
        const avg = rankCount[o.id] ? (rankSum[o.id] / rankCount[o.id]).toFixed(1) : "—";
        return `<div>
          <div class="pollx-muted">${esc(o.label)}<span style="float:right">avg #${avg}</span></div>
          <div class="pollx-bar"><span style="width:${w}%"></span><em><span>${points[o.id]} pts</span><span>${rankCount[o.id]}</span></em></div>
        </div>`;
      }).join("");
      return `<div class="pollx-q"><h3>${esc(q.title)}</h3>
        <p class="pollx-hint">Ranked by ${voters} ${voters === 1 ? "person" : "people"} · sorted by preference (points = Borda count; “avg #” = average position)</p>
        ${bars}</div>`;
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

}

function notice(text, kind) {
  const cls = kind === "err" ? "pollx-note pollx-err"
    : kind === "ok" ? "pollx-note pollx-ok" : "pollx-note";
  return `<div class="${cls}">${esc(text)}</div>`;
}

// Confirm a submission right where the user is (just under the Submit button),
// so it's visible no matter how far down a long form they scrolled.
function confirmSubmitted(form) {
  form.querySelectorAll("input, textarea, button").forEach(el => { el.disabled = true; });
  form.querySelectorAll("[data-rank-opt]").forEach(el => { el.style.pointerEvents = "none"; });
  form.style.opacity = ".6";
  form.style.pointerEvents = "none";
  const banner = document.createElement("div");
  banner.className = "pollx-note pollx-ok pollx-thanks";
  banner.setAttribute("role", "status");
  banner.innerHTML = "✓ <strong>Thank you!</strong> Your response has been submitted.";
  form.insertAdjacentElement("afterend", banner);
  try { banner.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}
