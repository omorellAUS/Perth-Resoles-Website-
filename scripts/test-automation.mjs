// End-to-end test of the order automation against Square SANDBOX + the mock sheet endpoint.
// Needs: wrangler dev on BASE (default http://127.0.0.1:8787) with SHEET_WEBHOOK_URL pointing at
// apps-script/test/mock-sheet-server.mjs, and env SQUARE_SANDBOX_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY,
// SQUARE_WEBHOOK_URL, MOCK_OUT (mock-sheet output dir). Never prints tokens or secrets.
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const SQ = "https://connect.squareupsandbox.com";
const TOKEN = process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
const OUT = process.env.MOCK_OUT || "/workspace/mock-sheet";
if (!TOKEN) { console.error("SQUARE_SANDBOX_ACCESS_TOKEN not set"); process.exit(2); }

const sq = async (method, path, body) => {
  const r = await fetch(SQ + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Square-Version": "2026-09-16", "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(path + " " + JSON.stringify(d.errors)); return d;
};
let fails = 0;
const check = (ok, name, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`); };
const received = (ref) => existsSync(OUT + "/received.jsonl")
  ? readFileSync(OUT + "/received.jsonl", "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter((x) => x.body.order_id === ref) : [];
const order = (extra = {}) => ({
  rubber: "vibram-xs-grip", rand: "toe-cap", rand_coverage: "both", shoe_model: "La Sportiva Solution", shoe_size: "EU 41.5",
  dropoff: "urban-jungle", customer_name: "Alex Smith", email: "test@perthresoles.com.au", phone: "0412 345 678", expected_total: 120, ...extra,
});

async function checkout(o) {
  const r = await fetch(BASE + "/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
  return r.json();
}
async function payInSandbox(url) {
  // Find the order behind the payment link, open it (DRAFT -> OPEN) and pay with Square's sandbox test nonce.
  let link, cursor;
  do { const d = await sq("GET", "/v2/online-checkout/payment-links?limit=100" + (cursor ? "&cursor=" + cursor : "")); link = (d.payment_links || []).find((l) => l.url === url); cursor = d.cursor; } while (!link && cursor);
  const o = (await sq("GET", `/v2/orders/${link.order_id}`)).order;
  const opened = (await sq("PUT", `/v2/orders/${o.id}`, { idempotency_key: crypto.randomUUID(), order: { version: o.version, state: "OPEN" } })).order;
  const p = (await sq("POST", "/v2/payments", {
    idempotency_key: crypto.randomUUID(), source_id: "cnon:card-nonce-ok", location_id: o.location_id, order_id: o.id,
    amount_money: opened.net_amount_due_money, buyer_email_address: "test@perthresoles.com.au",
  })).payment;
  return p;
}
const confirm = async (ref) => { const r = await fetch(`${BASE}/api/confirm?ref=${ref}`); return { http: r.status, ...(await r.json()) }; };
async function webhook(payment, { badSig = false } = {}) {
  const body = JSON.stringify({ merchant_id: "SANDBOX", type: "payment.updated", event_id: crypto.randomUUID(), created_at: new Date().toISOString(),
    data: { type: "payment", id: payment.id, object: { payment } } });
  let sig = crypto.createHmac("sha256", process.env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(process.env.SQUARE_WEBHOOK_URL + body).digest("base64");
  if (badSig) sig = sig.slice(0, -4) + "AAA=";
  const r = await fetch(BASE + "/api/square-webhook", { method: "POST", headers: { "content-type": "application/json", "x-square-hmacsha256-signature": sig }, body });
  return { http: r.status, ...(await r.json()) };
}

// ---- 1. thank-you page first, then the webhook ----
const a = await checkout(order());
check(/^PR-\d{4}$/.test(a.ref || ""), "checkout returns a short ref", `${a.ref} ${a.url}`);
const c0 = await confirm(a.ref);
check(c0.http === 200 && c0.status === "pending" && c0.forwarded === undefined, "unpaid order -> pending, nothing forwarded", JSON.stringify(c0));
const payA = await payInSandbox(a.url);
check(payA.status === "COMPLETED", "sandbox payment (cnon:card-nonce-ok) COMPLETED", payA.id);
const c1 = await confirm(a.ref);
check(c1.status === "paid" && c1.forwarded === "sent", "thank-you /api/confirm -> paid, forwarded once", JSON.stringify(c1));
const c2 = await confirm(a.ref);
check(c2.forwarded === "already", "second /api/confirm -> already (no duplicate)", JSON.stringify(c2));
const w1 = await webhook(payA);
check(w1.http === 200 && w1.forwarded === "already", "signed webhook after confirm -> already", JSON.stringify(w1));
const bad = await webhook(payA, { badSig: true });
check(bad.http === 401, "webhook with bad signature -> 401", JSON.stringify(bad));
check(received(a.ref).length === 1, `mock sheet received exactly ONE JSON for ${a.ref}`, `count=${received(a.ref).length}`);

// ---- 2. webhook first, then the thank-you page ----
const b = await checkout(order({ rubber: "unparallel-5.5", rand: "full-rand", rand_coverage: "single", expected_total: 135, customer_name: "Jo Bloggs", phone: "" }));
const payB = await payInSandbox(b.url);
const w2 = await webhook(payB);
check(w2.http === 200 && w2.forwarded === "sent", "webhook first -> sent", JSON.stringify(w2));
const c3 = await confirm(b.ref);
check(c3.forwarded === "already", "thank-you after webhook -> already", JSON.stringify(c3));
check(received(b.ref).length === 1, `mock sheet received exactly ONE JSON for ${b.ref}`, `count=${received(b.ref).length}`);

// ---- 2b. no rand repair (Square metadata has no rand_coverage) ----
const e = await checkout(order({ rubber: "vibram-xs-edge", rand: "none", rand_coverage: "", expected_total: 80, customer_name: "Nora Rand" }));
check(/^PR-\d{4}$/.test(e.ref || ""), "no-rand checkout created", `${e.ref}`);
await payInSandbox(e.url);
const c5 = await confirm(e.ref);
const rows = existsSync(OUT + "/Test_Orders.csv") ? readFileSync(OUT + "/Test_Orders.csv", "utf8") : "";
check(c5.forwarded === "sent" && rows.includes(`${e.ref},Nora Rand,`) && rows.includes("Basic Resole with Vibram XS Edge 4.0mm,Vibram XS Edge,4.0mm,None,,1"), "no-rand order -> 'Basic Resole with Vibram XS Edge 4.0mm', Rand None, coverage blank");

// ---- 3. home-address guard ----
const g = await checkout(order({ shoe_model: "Solution - drop at Perth Hills", customer_name: "Guard Test" }));
await payInSandbox(g.url);
const c4 = await confirm(g.ref);
check(c4.forwarded === "sent", "guard order forwarded to the sheet", JSON.stringify(c4));
const logCsv = existsSync(OUT + "/Automation_Log.csv") ? readFileSync(OUT + "/Automation_Log.csv", "utf8") : "";
check(new RegExp(`BLOCKED,${g.ref},Email draft blocked`).test(logCsv), "address guard BLOCKED the email draft and logged it");
check(!existsSync(`${OUT}/drafts/${g.ref}.html`), "no draft file for the blocked order");
check(existsSync(`${OUT}/drafts/${a.ref}.html`), "draft rendered for the normal order", `${OUT}/drafts/${a.ref}.html`);

// ---- 4. misc ----
const nf = await confirm("PR-0000");
check(nf.http === 404 && nf.status === "not_found", "unknown ref -> not_found", JSON.stringify(nf));
const inv = await fetch(BASE + "/api/confirm?ref=../../x"); check(inv.status === 400, "invalid ref -> 400");
const ignored = await (await fetch(BASE + "/api/square-webhook", { method: "POST", body: "{}" })).status;
check(ignored === 401, "unsigned webhook -> 401");

console.log(JSON.stringify({ refs: { thankyou_first: a.ref, webhook_first: b.ref, guard: g.ref, no_rand: e.ref } }));
process.exit(fails ? 1 : 0);
