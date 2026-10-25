// Short order references: "PR-" + 4 digits (1000-9999), e.g. PR-4827.
// Digits only, so nothing can be misread on a hand-written tag (no O/0, I/1, etc.).
//
// Collision handling:
//  - Square's SearchOrders can't filter by reference_id, so we fetch this location's orders from the
//    last REF_WINDOW_DAYS (all states, incl. unpaid DRAFT checkouts) and avoid every reference in use.
//  - Refs we issued are also remembered in KV (ref:PR-xxxx) when the ORDER_STATE binding exists.
//  - Up to 40 random tries. 9,000 numbers vs a few hundred orders a year => a retry is rare and
//    running out is practically impossible. If it ever happens, checkout returns a friendly error.
//  - Residual risk: a number can repeat after REF_WINDOW_DAYS (an old, finished order). The Apps Script
//    treats "same Order ID + different Square payment" as a NEW order and logs a warning.

export const REF_RE = /^PR-\d{4}$/;
const REF_WINDOW_DAYS = 365;
const CACHE_MS = 5 * 60 * 1000;
let recent = { at: 0, refs: new Set() };

const randomRef = () => "PR-" + (1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));

async function recentRefs(env, locationId, searchOrders) {
  if (Date.now() - recent.at < CACHE_MS) return recent.refs;
  const since = new Date(Date.now() - REF_WINDOW_DAYS * 864e5).toISOString();
  const orders = await searchOrders(env, locationId, since);
  recent = { at: Date.now(), refs: new Set(orders.map((o) => o.reference_id).filter(Boolean)) };
  return recent.refs;
}

// dryRun: no Square lookups (no token), only the in-memory/KV checks.
export async function newShortRef(env, { locationId, searchOrders, dryRun }) {
  const used = dryRun ? recent.refs : await recentRefs(env, locationId, searchOrders);
  for (let i = 0; i < 40; i++) {
    const ref = randomRef();
    if (used.has(ref)) continue;
    if (env.ORDER_STATE && (await env.ORDER_STATE.get("ref:" + ref))) continue;
    used.add(ref); // reserve immediately so a parallel checkout in this isolate can't take it
    return { ref, tries: i + 1 };
  }
  throw new Error("Could not find a free order number");
}
