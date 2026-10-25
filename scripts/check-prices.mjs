// Fails if the prices shown in index.html drift from the server price table (src/prices.js).
import { readFileSync } from "node:fs";
import { RUBBERS, RAND_REPAIRS } from "../src/prices.js";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
let bad = 0;
const fail = (m) => { console.error("MISMATCH:", m); bad++; };
for (const [key, r] of Object.entries(RUBBERS)) {
  const m = html.match(new RegExp(`<option value="${key.replace(".", "\\.")}" data-price="(\\d+)"[^>]*>[^<]*\\$(\\d+)`));
  if (!m) fail(`rubber ${key} missing from index.html`);
  else if (+m[1] * 100 !== r.cents || +m[2] * 100 !== r.cents) fail(`rubber ${key}: page $${m[1]}/$${m[2]} vs table $${r.cents / 100}`);
}
for (const [key, a] of Object.entries(RAND_REPAIRS)) {
  const m = html.match(new RegExp(`<option value="${key}" data-both="(\\d+)" data-single="(\\d+)"`));
  if (!m) fail(`rand ${key} missing from index.html`);
  else if (+m[1] * 100 !== a.both || +m[2] * 100 !== a.single) fail(`rand ${key}: page $${m[1]}/$${m[2]} vs table $${a.both / 100}/$${a.single / 100}`);
}
// Pricing cards: max combos ($170 Vibram, $180 Unparallel) must appear.
const maxV = (RUBBERS["vibram-xs-grip"].cents + RAND_REPAIRS["full-rand"].both) / 100;
const maxU = (RUBBERS["unparallel-5.5"].cents + RAND_REPAIRS["full-rand"].both) / 100;
if (!html.includes(`$${maxV}.00`)) fail(`pricing card max $${maxV}`);
if (!html.includes(`$${maxU}.00`)) fail(`pricing card max $${maxU}`);
if (/hills/i.test(html)) fail("index.html mentions Perth Hills");
if (bad) process.exit(1);
console.log("Prices in index.html match src/prices.js");
