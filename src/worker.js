// Perth Resoles Cloudflare Worker.
// - Serves the static site (assets binding, see wrangler.jsonc).
// - POST /api/checkout validates the order, prices it SERVER-SIDE from src/prices.js
//   and creates a Square payment link (CreatePaymentLink), returning { url }.
// Secrets: env.SQUARE_ACCESS_TOKEN (Worker secret / .dev.vars). Never logged.
// Env vars: SQUARE_ENV = "sandbox" | "production", SQUARE_LOCATION_ID (optional in sandbox),
//           SQUARE_DRY_RUN = "true" to skip Square and return a mock checkout URL.
// Order automation (src/orders.js): POST /api/square-webhook, GET /api/confirm?ref=PR-1234
//   secrets: SQUARE_WEBHOOK_SIGNATURE_KEY, SHEET_WEBHOOK_SECRET; vars: SQUARE_WEBHOOK_URL, SHEET_WEBHOOK_URL
//   optional KV binding ORDER_STATE (order lookup + "already forwarded" markers).

import {
  CURRENCY, RUBBERS, RAND_REPAIRS, RAND_COVERAGE, DROPOFFS, priceCents, lineItemName,
} from "./prices.js";
import { SQUARE_VERSION, SQUARE_BASE, squareEnv as sqEnv, sq, getLocationId, searchOrders } from "./square.js";
import { newShortRef } from "./refs.js";
import { handleConfirm, handleWebhook } from "./orders.js";

// Dry-run requests kept in memory so the mock checkout page can show them (local trial only).
const dryRuns = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/checkout") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      try {
        return await handleCheckout(request, env, url);
      } catch (err) {
        console.error("checkout failed:", err && err.message ? err.message : "unknown error");
        return json({ error: "Sorry, we couldn't start the checkout. Please try again, or message us on Instagram." }, 500);
      }
    }
    if (url.pathname === "/api/confirm") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      try { return await handleConfirm(request, env, url); }
      catch (err) { console.error("confirm failed:", err.message); return json({ status: "error" }, 502); }
    }
    if (url.pathname === "/api/square-webhook") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      try { return await handleWebhook(request, env); }
      catch (err) { console.error("webhook failed:", err.message); return json({ error: "Webhook error" }, 500); }
    }
    if (url.pathname === "/api/mock-checkout") return mockCheckoutPage(url);
    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};

// ---------- validation ----------

const clean = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

function normalisePhone(raw) {
  const p = raw.replace(/[\s\-().]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(p)) return p;
  if (/^0[2-478]\d{8}$/.test(p)) return "+61" + p.slice(1); // AU mobile/landline
  if (/^61[2-478]\d{8}$/.test(p)) return "+" + p;
  return null;
}

export function validateOrder(body) {
  const errors = {};
  const o = {
    rubber: clean(body.rubber, 40),
    rand: clean(body.rand, 40) || "none",
    rand_coverage: clean(body.rand_coverage, 10),
    shoe_model: clean(body.shoe_model, 60),
    shoe_size: clean(body.shoe_size, 15),
    dropoff: clean(body.dropoff, 40),
    customer_name: clean(body.customer_name, 80),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 25),
  };
  if (!(o.rubber in RUBBERS)) errors.rubber = "Please choose a rubber.";
  if (!(o.rand in RAND_REPAIRS)) errors.rand = "Please choose a rand repair option.";
  if (o.rand !== "none" && !(o.rand_coverage in RAND_COVERAGE)) errors.rand_coverage = "Please choose both shoes or a single shoe.";
  if (o.rand === "none") o.rand_coverage = "";
  if (o.shoe_model.length < 2) errors.shoe_model = "Please enter your shoe brand and model.";
  if (o.shoe_size.length < 1) errors.shoe_size = "Please enter your shoe size.";
  if (!(o.dropoff in DROPOFFS)) errors.dropoff = "Please choose a drop-off option.";
  if (o.customer_name.length < 2) errors.customer_name = "Please enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(o.email)) errors.email = "Please enter a valid email address.";
  if (o.phone) {
    const p = normalisePhone(o.phone);
    if (!p) errors.phone = "Please check your phone number (e.g. 0412 345 678).";
    else o.phone_e164 = p;
  }
  return { order: o, errors };
}

// ---------- checkout ----------

async function handleCheckout(request, env, url) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return json({ error: "Expected JSON." }, 415);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400);

  const { order: o, errors } = validateOrder(body);
  if (Object.keys(errors).length) {
    return json({ error: "Please fix the highlighted fields.", fields: errors }, 400);
  }

  // Price is ALWAYS computed here. The client's displayed total is only compared, never used.
  const amount = priceCents(o.rubber, o.rand, o.rand_coverage);
  if (amount == null) return json({ error: "Invalid options." }, 400);
  if (body.expected_total !== undefined && body.expected_total !== null && body.expected_total !== "") {
    const shown = Math.round(Number(body.expected_total) * 100);
    if (!Number.isFinite(shown) || shown !== amount) {
      return json({
        error: `The price on the page doesn't match our price list ($${(amount / 100).toFixed(2)}). Please refresh the page and try again.`,
        expected_total: amount / 100,
      }, 409);
    }
  }

  const itemName = lineItemName(o.rubber, o.rand, o.rand_coverage);
  const dropoffName = DROPOFFS[o.dropoff];
  const siteUrl = (env.SITE_URL || url.origin).replace(/\/$/, "");
  const squareEnv = sqEnv(env);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const dryRun = env.SQUARE_DRY_RUN === "true" || !env.SQUARE_ACCESS_TOKEN;

  // Safety: never create real (production) payment links from a local trial.
  if (squareEnv === "production" && isLocal && !dryRun) {
    return json({ error: "Production Square is disabled on localhost. Use SQUARE_ENV=sandbox for local trials." }, 403);
  }

  let locationId = "";
  if (!dryRun) {
    const loc = await getLocationId(env);
    if (loc.error) return json({ error: loc.error }, 502);
    locationId = loc.id;
  }
  const { ref } = await newShortRef(env, { locationId, searchOrders, dryRun });

  const summary =
    `Order ${ref} | ${itemName} | Shoe: ${o.shoe_model} | Size: ${o.shoe_size} | ` +
    `Drop-off: ${dropoffName} | Customer: ${o.customer_name}`;

  const meta = (v) => String(v).slice(0, 255);
  const reqBody = {
    idempotency_key: crypto.randomUUID(),
    description: `Perth Resoles web order ${ref}`,
    order: {
      location_id: locationId || "SANDBOX_LOCATION_ID",
      reference_id: ref,
      line_items: [{
        name: itemName,
        quantity: "1",
        base_price_money: { amount, currency: CURRENCY },
        note: summary.slice(0, 2000),
      }],
      // Order-level metadata (Square's Order object has no order-level note field).
      // No personal info here, per Square's guidance on metadata.
      metadata: {
        order_ref: meta(ref),
        shoe_model: meta(o.shoe_model),
        shoe_size: meta(o.shoe_size),
        dropoff: meta(dropoffName),
        rubber: meta(RUBBERS[o.rubber].name),
        rand_repair: meta(o.rand === "none" ? "None" : `${RAND_REPAIRS[o.rand].name} (${RAND_COVERAGE[o.rand_coverage]})`),
        // Machine-readable keys for the order automation (10 entries max per Square).
        rubber_key: o.rubber,
        rand_key: o.rand,
        rand_coverage: o.rand_coverage || "",
        dropoff_key: o.dropoff,
      },
    },
    checkout_options: {
      redirect_url: `${siteUrl}/thank-you?ref=${encodeURIComponent(ref)}`,
      ask_for_shipping_address: false,
    },
    pre_populated_data: { buyer_email: o.email },
    payment_note: summary.slice(0, 500),
  };
  // Square rejects empty metadata values (e.g. rand_coverage when there is no rand repair).
  for (const [k, v] of Object.entries(reqBody.order.metadata)) if (v === "") delete reqBody.order.metadata[k];
  if (o.phone_e164) reqBody.pre_populated_data.buyer_phone_number = o.phone_e164;

  const endpoint = `${SQUARE_BASE[squareEnv]}/v2/online-checkout/payment-links`;

  if (dryRun) {
    dryRuns.set(ref, { endpoint, body: reqBody, redirect: reqBody.checkout_options.redirect_url });
    if (dryRuns.size > 50) dryRuns.delete(dryRuns.keys().next().value);
    return json({
      url: `${url.origin}/api/mock-checkout?ref=${encodeURIComponent(ref)}`,
      ref,
      amount: amount / 100,
      dry_run: true,
      square_request: { method: "POST", url: endpoint, headers: { "Square-Version": SQUARE_VERSION, Authorization: "Bearer [REDACTED]" }, body: reqBody },
    });
  }

  let { ok: resOk, status: resStatus, data } = await sq(env, "POST", "/v2/online-checkout/payment-links", reqBody);
  // If Square rejects only the optional pre-filled email/phone, retry once without it:
  // the customer simply types it on Square's page instead of being blocked here.
  const errFields = (data.errors || []).map((e) => e.field || "");
  if (!resOk && errFields.length && errFields.every((f) => f.startsWith("pre_populated_data"))) {
    console.warn("Square rejected pre-filled buyer details; retrying without them.");
    delete reqBody.pre_populated_data;
    reqBody.idempotency_key = crypto.randomUUID();
    ({ ok: resOk, status: resStatus, data } = await sq(env, "POST", "/v2/online-checkout/payment-links", reqBody));
  }
  if (!resOk || !data.payment_link || !data.payment_link.url) {
    const codes = (data.errors || []).map((e) => `${e.code}${e.field ? " (" + e.field + ")" : ""}`).join(", ");
    console.error(`Square CreatePaymentLink failed: HTTP ${resStatus} ${codes}`);
    return json({ error: "Sorry, we couldn't start the checkout. Please try again, or message us on Instagram." }, 502);
  }
  if (env.ORDER_STATE) {
    // Lets /api/confirm find the order fast, and keeps the customer's typed name/phone (not stored in
    // Square metadata, per Square's guidance). Expires after 90 days.
    await env.ORDER_STATE.put("ref:" + ref, JSON.stringify({
      order_id: data.payment_link.order_id, payment_link_id: data.payment_link.id,
      customer_name: o.customer_name, email: o.email, phone: o.phone_e164 || "", created: new Date().toISOString(),
    }), { expirationTtl: 90 * 86400 });
  }
  return json({ url: data.payment_link.url, ref, amount: amount / 100 });
}

// ---------- dry-run mock checkout (local trial only) ----------

function mockCheckoutPage(url) {
  const ref = url.searchParams.get("ref") || "";
  const run = dryRuns.get(ref);
  if (!run) return new Response("Dry-run order not found (the dev server may have restarted).", { status: 404 });
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const amt = (run.body.order.line_items[0].base_price_money.amount / 100).toFixed(2);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>DRY RUN - mock Square checkout</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;max-width:760px;margin:0 auto;padding:24px}
h1{color:#e3b93c;font-size:1.4rem}.box{border:2px solid #e3b93c;border-radius:16px;padding:16px;margin:16px 0}
pre{background:#000;padding:12px;border-radius:12px;overflow:auto;font-size:12px;white-space:pre-wrap}
a.btn{display:inline-block;background:#e3b93c;color:#111;padding:12px 24px;border-radius:999px;font-weight:600;text-decoration:none}</style></head>
<body><h1>DRY RUN: mock Square checkout</h1>
<div class="box"><p><strong>${esc(run.body.order.line_items[0].name)}</strong></p><p>Total: <strong>$${amt} ${esc(run.body.order.line_items[0].base_price_money.currency)}</strong> &middot; Order ${esc(ref)}</p>
<p>No Square request was sent and nothing was charged. With a sandbox token, the customer would now be on Square's hosted checkout page.</p>
<a class="btn" href="${esc(run.redirect)}&dry_run=1">Simulate successful payment &rarr;</a></div>
<p>Exact request that would be sent: <code>POST ${esc(run.endpoint)}</code></p>
<pre>${esc(JSON.stringify(run.body, null, 2))}</pre></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
