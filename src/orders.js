// Paid-order automation:
//   POST /api/square-webhook  (Square payment.updated, signature-verified)
//   GET  /api/confirm?ref=PR-1234  (thank-you page fallback; works on localhost where webhooks can't reach)
// Both build the same clean JSON and forward it ONCE to env.SHEET_WEBHOOK_URL (Google Apps Script).
// Idempotency: in-flight lock per order (this isolate) + KV "fwd:<ref>" marker when ORDER_STATE is bound
// + the Apps Script itself skips duplicate Order IDs (authoritative, uses a script lock).

import { RUBBERS, RAND_REPAIRS, SHEET_COVERAGE, SHEET_DROPOFF } from "./prices.js";
import { sq, sqErrors, squareEnv, getLocationId, searchOrders } from "./square.js";
import { REF_RE } from "./refs.js";

const inflight = new Map();     // ref -> Promise (same isolate)
const forwardedMem = new Map(); // ref -> payment_id (fallback when no KV)

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// ---------- Square lookups ----------

async function findOrderByRef(env, ref) {
  if (env.ORDER_STATE) {
    const rec = await env.ORDER_STATE.get("ref:" + ref, "json");
    if (rec && rec.order_id) {
      const r = await sq(env, "GET", `/v2/orders/${encodeURIComponent(rec.order_id)}`);
      if (r.ok && r.data.order) return { order: r.data.order, rec };
    }
  }
  const loc = await getLocationId(env);
  if (loc.error) throw new Error(loc.error);
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const orders = await searchOrders(env, loc.id, since, 3);
  const order = orders.find((o) => o.reference_id === ref);
  return order ? { order, rec: null } : null;
}

async function completedPayment(env, order) {
  for (const t of order.tenders || []) {
    const id = t.payment_id || t.id;
    const r = await sq(env, "GET", `/v2/payments/${encodeURIComponent(id)}`);
    if (r.ok && r.data.payment && r.data.payment.status === "COMPLETED") return r.data.payment;
  }
  return null;
}

// ---------- the clean JSON sent to the sheet ----------

export async function buildPaidOrder(env, order, payment, rec, via) {
  const md = order.metadata || {};
  const li = (order.line_items || [])[0] || {};
  const rubber = RUBBERS[md.rubber_key] || {};
  const rand = RAND_REPAIRS[md.rand_key] || null;
  let customer = null;
  const custId = payment.customer_id || order.customer_id;
  if (custId) {
    const r = await sq(env, "GET", `/v2/customers/${encodeURIComponent(custId)}`);
    if (r.ok) customer = r.data.customer;
  }
  const noteName = ((li.note || "").match(/Customer: ([^|]+)$/) || [])[1];
  const custName = customer ? [customer.given_name, customer.family_name].filter(Boolean).join(" ") : "";
  const name = (rec && rec.customer_name) || custName ||
    (payment.card_details && payment.card_details.card && payment.card_details.card.cardholder_name) || (noteName || "").trim();
  return {
    type: "order.paid",
    via,
    environment: squareEnv(env),
    order_id: md.order_ref || order.reference_id,
    square_order_id: order.id,
    square_payment_id: payment.id,
    paid_at: payment.updated_at || payment.created_at,
    customer_name: name || "",
    email: payment.buyer_email_address || (rec && rec.email) || (customer && customer.email_address) || "",
    phone: (rec && rec.phone) || (customer && customer.phone_number) || "",
    service: li.name || "",
    rubber: rubber.sheetRubber || "Other",
    thickness: rubber.sheetThickness || "Other",
    rand_repair: rand ? rand.sheet : "None",
    rand_coverage: rand && md.rand_key !== "none" ? SHEET_COVERAGE[md.rand_coverage] || "" : "",
    pairs: Number(li.quantity || 1),
    shoe_model: md.shoe_model || "",
    shoe_size: md.shoe_size || "",
    amount_aud: Number(((payment.amount_money || order.total_money || {}).amount || 0) / 100),
    dropoff: SHEET_DROPOFF[md.dropoff_key] || "TBC",
    dropoff_key: md.dropoff_key || "",
    receipt_url: payment.receipt_url || "",
  };
}

// ---------- forward once ----------

async function forwardOnce(env, paid) {
  const ref = paid.order_id;
  if (!env.SHEET_WEBHOOK_URL) return "not_configured";
  const done = env.ORDER_STATE ? await env.ORDER_STATE.get("fwd:" + ref, "json") : forwardedMem.get(ref);
  if (done) return "already";
  if (inflight.has(ref)) { await inflight.get(ref).catch(() => {}); return "already"; }

  const p = (async () => {
    const res = await fetch(env.SHEET_WEBHOOK_URL, {
      method: "POST",
      redirect: "follow", // Apps Script web apps answer via a 302 to googleusercontent.com
      headers: {
        "content-type": "application/json",
        "x-perth-resoles-secret": env.SHEET_WEBHOOK_SECRET || "",
      },
      // Apps Script doPost(e) can't read request headers, so the secret is also sent in the body.
      body: JSON.stringify({ ...paid, auth: env.SHEET_WEBHOOK_SECRET || "" }),
    });
    const text = await res.text();
    let out = {};
    try { out = JSON.parse(text); } catch { /* Apps Script returned HTML = error page */ }
    if (!res.ok || !out.ok) throw new Error(`sheet endpoint HTTP ${res.status} ${out.error || ""}`.trim());
    const marker = { payment_id: paid.square_payment_id, at: new Date().toISOString(), via: paid.via, sheet: out.status || "ok" };
    if (env.ORDER_STATE) await env.ORDER_STATE.put("fwd:" + ref, JSON.stringify(marker), { expirationTtl: 400 * 864e5 / 1000 });
    forwardedMem.set(ref, marker);
    return out.status === "duplicate" ? "already" : "sent";
  })();
  inflight.set(ref, p);
  try { return await p; } finally { inflight.delete(ref); }
}

// ---------- GET /api/confirm?ref= ----------

export async function handleConfirm(request, env, url) {
  const ref = (url.searchParams.get("ref") || "").trim().toUpperCase();
  if (!REF_RE.test(ref)) return json({ error: "Invalid order number." }, 400);
  if (env.SQUARE_DRY_RUN === "true" || !env.SQUARE_ACCESS_TOKEN) return json({ ref, status: "dry_run" });
  const found = await findOrderByRef(env, ref);
  if (!found) return json({ ref, status: "not_found" }, 404);
  const payment = await completedPayment(env, found.order);
  if (!payment) return json({ ref, status: "pending" });
  let forwarded;
  try {
    forwarded = await forwardOnce(env, await buildPaidOrder(env, found.order, payment, found.rec, "thank-you"));
  } catch (err) {
    console.error("confirm forward failed:", err.message);
    forwarded = "failed";
  }
  // No personal details in this public response.
  return json({ ref, status: "paid", forwarded });
}

// ---------- POST /api/square-webhook ----------

async function hmacBase64(key, message) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
export async function verifySquareSignature(env, request, rawBody) {
  const key = env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const given = request.headers.get("x-square-hmacsha256-signature") || "";
  if (!key || !given) return false;
  // Must be EXACTLY the notification URL registered in the Square Developer Console.
  const notificationUrl = env.SQUARE_WEBHOOK_URL || new URL(request.url).toString();
  return timingSafeEqual(await hmacBase64(key, notificationUrl + rawBody), given);
}

export async function handleWebhook(request, env) {
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) return json({ error: "Webhook not configured" }, 503);
  const raw = await request.text();
  if (!(await verifySquareSignature(env, request, raw))) return json({ error: "Invalid signature" }, 401);
  let evt;
  try { evt = JSON.parse(raw); } catch { return json({ error: "Bad JSON" }, 400); }
  if (evt.type !== "payment.updated" && evt.type !== "payment.created") return json({ ok: true, ignored: evt.type });
  const p = evt.data && evt.data.object && evt.data.object.payment;
  if (!p || p.status !== "COMPLETED" || !p.order_id) return json({ ok: true, ignored: "not a completed payment" });

  // Re-fetch from Square rather than trusting the payload.
  const [po, oo] = await Promise.all([
    sq(env, "GET", `/v2/payments/${encodeURIComponent(p.id)}`),
    sq(env, "GET", `/v2/orders/${encodeURIComponent(p.order_id)}`),
  ]);
  if (!po.ok || !oo.ok) {
    console.error("webhook lookup failed:", sqErrors(po.data), sqErrors(oo.data));
    return json({ error: "Lookup failed" }, 502); // Square retries
  }
  const order = oo.data.order, payment = po.data.payment;
  const ref = (order.metadata && order.metadata.order_ref) || order.reference_id || "";
  if (!REF_RE.test(ref)) return json({ ok: true, ignored: "not a website order" }); // e.g. in-person sales
  if (payment.status !== "COMPLETED") return json({ ok: true, ignored: "payment not completed" });
  const rec = env.ORDER_STATE ? await env.ORDER_STATE.get("ref:" + ref, "json") : null;
  try {
    const forwarded = await forwardOnce(env, await buildPaidOrder(env, order, payment, rec, "webhook"));
    return json({ ok: true, ref, forwarded });
  } catch (err) {
    console.error("webhook forward failed:", err.message);
    return json({ error: "Forward failed" }, 500); // non-2xx => Square retries later
  }
}
