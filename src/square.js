// Small Square REST helper. The access token is only ever sent in the Authorization header.
export const SQUARE_VERSION = "2026-09-16";
export const SQUARE_BASE = {
  sandbox: "https://connect.squareupsandbox.com",
  production: "https://connect.squareup.com",
};

export const squareEnv = (env) => (env.SQUARE_ENV === "production" ? "production" : "sandbox");

export async function sq(env, method, path, body) {
  const res = await fetch(SQUARE_BASE[squareEnv(env)] + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const sqErrors = (data) =>
  (data.errors || []).map((e) => `${e.code}${e.field ? " (" + e.field + ")" : ""}`).join(", ");

let cachedLocation = null;
export async function getLocationId(env) {
  if (env.SQUARE_LOCATION_ID) return { id: env.SQUARE_LOCATION_ID };
  if (cachedLocation) return cachedLocation;
  const r = await sq(env, "GET", "/v2/locations");
  const loc = (r.data.locations || []).find((l) => l.status === "ACTIVE");
  if (!loc) return { error: "Square location not found. Set SQUARE_LOCATION_ID." };
  if (loc.currency !== "AUD") {
    return { error: `Square ${squareEnv(env)} location uses ${loc.currency}, not AUD. Use an Australian sandbox test account.` };
  }
  cachedLocation = { id: loc.id };
  return cachedLocation;
}

// Search this location's orders (all states, newest first) created since `sinceIso`.
export async function searchOrders(env, locationId, sinceIso, maxPages = 5) {
  const orders = [];
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const r = await sq(env, "POST", "/v2/orders/search", {
      location_ids: [locationId],
      limit: 500,
      cursor,
      query: {
        filter: {
          state_filter: { states: ["DRAFT", "OPEN", "COMPLETED", "CANCELED"] },
          date_time_filter: { created_at: { start_at: sinceIso } },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
      },
    });
    if (!r.ok) throw new Error("SearchOrders failed: " + sqErrors(r.data));
    orders.push(...(r.data.orders || []));
    cursor = r.data.cursor;
    if (!cursor) break;
  }
  return orders;
}
