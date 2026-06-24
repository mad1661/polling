# Polls — Firebase polling, questions & comments with timed result reveal

Create polls (questions + voting + a comment section), embed them on **WordPress
or Wix**, collect responses in **Firebase**, and **reveal the results on a date you
choose** — so the public can't see the numbers until enough votes are in.

There are two pages:

| Page | Who uses it | What it does |
|------|-------------|--------------|
| `index.html` | **You / admins** (login required) | Create & edit polls, view **all** results of **every** poll at any time, get embed code |
| `poll.html`  | **The public** (no login) | Renders one poll, accepts votes & comments, shows results **after the reveal time** |

## How the timed reveal works

Each poll has two timestamps:

- **Results revealed at** (e.g. *+2 weeks*) — when the **public** can first see results.
- **Voting closes at** (e.g. *+3 weeks*) — when voting stops.

Before the reveal time, the public **literally cannot read the votes** — this is
enforced by Firestore security rules, not just hidden in the page, so the secrecy
is real. **Logged-in admins always see every result immediately.** Setting reveal
*before* close (2 vs 3 weeks) means people keep voting for a week after the numbers
go public — exactly your "enough time to get real numbers" idea.

---

## One-time setup

### 1. Install the Firebase CLI
```bash
npm install -g firebase-tools
firebase login
```

### 2. Enable the things this app uses (Firebase Console → your `polling-d51ee` project)
- **Build → Firestore Database → Create database** (Production mode is fine; the
  rules in this repo handle access).
- **Build → Authentication → Get started**, then enable **two** sign-in providers:
  - **Email/Password** — for admins (you).
  - **Anonymous** — lets the public vote once per browser and post comments.

### 3. Create your admin login(s)
There is **no public sign-up** (any account can see all results, so accounts are
invite-only). In the Console: **Authentication → Users → Add user**, enter an email
+ password. Anyone you add here can log in to `index.html` and see every poll's
results. Add one row per trusted person.

### 4. Deploy
From the repo root:
```bash
firebase deploy
```
This publishes:
- the **security rules** (`firestore.rules`), and
- the **website** (Firebase Hosting) at `https://polling-d51ee.web.app`.

> Deploy only rules: `firebase deploy --only firestore:rules`
> Deploy only the site: `firebase deploy --only hosting`

---

## Using it

1. Go to **`https://polling-d51ee.web.app`** and sign in with an admin account.
2. **Create a poll:** add a title, some questions (multiple-choice, checkboxes, or
   open text), tick "comment section" if you want one, then set the **reveal** and
   **close** times (handy `+1/2/3 week` buttons are provided). Click **Create poll**.
3. Click **Get embed code** on the poll. Copy the **iframe** snippet.
4. In **WordPress** (a *Custom HTML* block) or **Wix** (*Embed → Embed HTML / Embed a
   widget*), paste the snippet. The poll appears on your site; votes and comments flow
   into Firebase.
5. Watch results live in the admin dashboard via **View results** (you see them
   anytime; the public sees them only after the reveal time). **Download CSV** for raw
   numbers.

### Two embed options
- **iframe (recommended):** works in virtually every WordPress/Wix HTML block and
  auto-resizes to fit its content.
- **Inline widget:** a `<div>` + small module `<script>` that renders directly in the
  page (use where module scripts are allowed and you don't want an iframe).

Both load the poll from your Firebase-hosted `poll.html` / `assets/poll-widget.js`,
so **you must deploy (step 4)** before embeds work, and edits you make to a poll show
up everywhere it's embedded.

---

## Data model (Firestore)

```
polls/{pollId}
  title, description, questions[], allowComments,
  revealAt (Timestamp), closesAt (Timestamp), createdAt, ownerUid, ownerEmail
  responses/{userUid}      answers:{questionId: optionId | optionId[] | text}, createdAt
  comments/{auto}          name, text, createdAt
```
- **One vote per user** is enforced by using the voter's anonymous uid as the
  response document id (you can't create a second one).
- Results are tallied in the browser from the `responses` documents. Fine for
  hundreds/thousands of votes; for very large polls you'd add server-side aggregation.

## Files
```
index.html               Admin console (login, builder, results, embed codes)
poll.html                Public poll page (embedded via iframe)
assets/firebase-config.js  Your Firebase config + init (shared)
assets/poll-widget.js      Public widget logic (shared by poll.html and the inline embed)
firestore.rules          Security rules (reveal-gate + admin universal access)
firebase.json / .firebaserc  Deploy config (hosting + rules)
```

## Notes & limits
- The Firebase config / API key in `firebase-config.js` is public by design (that's
  how all client-side Firebase apps work). Your data is protected by the **security
  rules**, not by hiding the key — so keep the rules as written.
- The one-vote guard is per browser (clearing site data lets someone vote again).
  For stricter control you'd add real per-user accounts.
- Local testing: run `firebase emulators:start` or `firebase serve`, or just open
  `index.html` over `http://localhost` (email/password + popups need http(s), not
  the `file://` protocol).
