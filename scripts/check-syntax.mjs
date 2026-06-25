// Lightweight syntax check used by CI (no npm dependencies — just Node).
// Verifies:
//   1. every assets/*.js module parses
//   2. every <script type="module"> block inside *.html parses
// Exits non-zero if anything fails, so it works as a PR status check.
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const failed = [];

function checkJs(label, code) {
  const file = join(mkdtempSync(join(tmpdir(), "synck-")), "snippet.mjs");
  writeFileSync(file, code);
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log(`  ok   ${label}`);
  } catch (e) {
    console.log(`  FAIL ${label}`);
    console.log(String(e.stderr || e.message).split("\n").map(l => "       " + l).join("\n"));
    failed.push(label);
  }
}

// 1) standalone JS modules
console.log("Checking assets/*.js");
for (const f of readdirSync("assets").filter(n => n.endsWith(".js"))) {
  checkJs(`assets/${f}`, readFileSync(join("assets", f), "utf8"));
}

// 2) inline module scripts inside HTML files.
// The script bodies escape their closing tag as "<\/script>" so the browser
// doesn't end the block early; un-escape that before parsing as JS.
console.log("Checking inline <script type=\"module\"> blocks in *.html");
for (const f of readdirSync(".").filter(n => n.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  const re = /<script type="module">([\s\S]*?)<\/script>/g;
  let m, i = 0;
  while ((m = re.exec(html))) {
    const js = m[1].replace(/<\\\/script>/g, "</script>");
    checkJs(`${f} [module #${++i}]`, js);
  }
  if (i === 0) console.log(`  --   ${f} (no module scripts)`);
}

if (failed.length) {
  console.error(`\n${failed.length} item(s) failed the syntax check.`);
  process.exit(1);
}
console.log("\nAll syntax checks passed.");
