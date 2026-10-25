// Posts test orders to a running `wrangler dev` (default http://127.0.0.1:8787).
// Usage: node scripts/test-checkout.mjs [baseUrl]
const BASE = process.argv[2] || process.env.BASE_URL || "http://127.0.0.1:8787";
const valid = {
  rubber: "vibram-xs-grip", rand: "toe-cap", rand_coverage: "both",
  shoe_model: "La Sportiva Solution", shoe_size: "EU 41.5", dropoff: "urban-jungle",
  customer_name: "Test Customer", email: "test@perthresoles.com.au", phone: "0412 345 678",
  expected_total: 120,
};
const cases = [
  ["valid: XS Grip + toe cap (both) = $120", valid, 200],
  ["valid: Unparallel 5.5 + full rand (single) = $135, no phone", { ...valid, rubber: "unparallel-5.5", rand: "full-rand", rand_coverage: "single", phone: "", expected_total: 135 }, 200],
  ["valid: XS Edge, no rand = $80", { ...valid, rubber: "vibram-xs-edge", rand: "none", rand_coverage: "", expected_total: 80 }, 200],
  ["missing shoe size", { ...valid, shoe_size: "" }, 400],
  ["missing name + bad email", { ...valid, customer_name: "", email: "not-an-email" }, 400],
  ["rand chosen but no coverage", { ...valid, rand_coverage: "" }, 400],
  ["unknown rubber", { ...valid, rubber: "cheap-rubber" }, 400],
  ["tampered price (client says $1)", { ...valid, expected_total: 1 }, 409],
  ["Square-rejected prefill email (example.com) -> retried without prefill", { ...valid, email: "someone@example.com" }, 200],
  ["tampered price fields ignored (price/amount/total injected)", { ...valid, price: 1, amount: 100, total: 1 }, 200],
];
let fails = 0;
for (const [name, body, want] of cases) {
  const res = await fetch(BASE + "/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  const ok = res.status === want;
  if (!ok) fails++;
  const short = data.url ? { url: data.url, ref: data.ref, amount: data.amount, dry_run: !!data.dry_run } : data;
  console.log(`${ok ? "PASS" : "FAIL"} [${res.status}] ${name}\n      ${JSON.stringify(short)}`);
}
const get = await fetch(BASE + "/api/checkout");
console.log(`${get.status === 405 ? "PASS" : "FAIL"} [${get.status}] GET /api/checkout rejected`);
if (get.status !== 405) fails++;
process.exit(fails ? 1 : 0);
