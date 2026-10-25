// Unit tests for apps-script/Code.gs using simple mocks (node --test apps-script/test/).
import test from "node:test";
import assert from "node:assert/strict";
import { createGas, PRICE_LIST } from "./gas-mock.mjs";

const base = {
  type: "order.paid", via: "thank-you", environment: "sandbox", order_id: "PR-4827",
  square_order_id: "ORDER1", square_payment_id: "PAY1", paid_at: "2026-10-25T06:00:00Z",
  customer_name: "Alex Smith", email: "alex@example.org", phone: "+61412345678",
  service: "Resole: Vibram XS Grip 4.0mm + Toe cap (both shoes)",
  rubber: "Vibram XS Grip", thickness: "4.0mm", rand_repair: "Toe cap", rand_coverage: "Both shoes", pairs: 1,
  shoe_model: "La Sportiva Solution", shoe_size: "EU 41.5", amount_aud: 120,
  dropoff: "Drop off and Pick up at Urban Jungle Climbing Gym", dropoff_key: "urban-jungle",
  receipt_url: "https://squareupsandbox.com/receipt/preview/PAY1",
};
const post = (gas, body) => JSON.parse(gas.context.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());

test("rejects a wrong or missing secret, writes nothing", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  assert.deepEqual(post(gas, { ...base, auth: "nope" }), { ok: false, error: "unauthorized" });
  assert.deepEqual(post(gas, { ...base }), { ok: false, error: "unauthorized" });
  assert.equal(gas.sheets.get("Order Tracking").display(4, 1), "");
  assert.equal(gas.drafts.length, 0);
});

test("appends one row with exact column mapping, Price List service name, formula columns untouched", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  const res = post(gas, { ...base, auth: "test-secret" });
  assert.equal(res.ok, true); assert.equal(res.status, "appended"); assert.equal(res.sheet, "Order Tracking");
  assert.equal(res.row, 4, "goes right after the last Order ID, not after ARRAYFORMULA blanks (getLastRow=1000)");
  const s = gas.sheets.get("Order Tracking");
  const row = s.getRange(4, 1, 1, 22).getDisplayValues()[0];
  assert.deepEqual(row, ["PR-4827", "Alex Smith", "alex@example.org", "+61412345678", "2026-10-25",
    "Vibram XS Grip 4.0mm - Resole and Toe Cap Repair (pair)", "Vibram XS Grip", "4.0mm", "Toe cap", "Both shoes", "1",
    "La Sportiva Solution", "EU 41.5", "120", "120", "Drop off and Pick up at Urban Jungle Climbing Gym", "Paid", "", "", "",
    "https://squareupsandbox.com/receipt/preview/PAY1",
    "Website order via thank-you (SANDBOX TEST). Square order ORDER1, payment PAY1."]);
  assert.equal(s.get(4, 15).v, null, "O not written"); assert.equal(s.get(4, 19).v, null, "S not written");
});

test("duplicate Order ID with the same payment is skipped (webhook + thank-you page)", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  assert.equal(post(gas, { ...base, auth: "test-secret" }).status, "appended");
  const again = post(gas, { ...base, via: "webhook", auth: "test-secret" });
  assert.equal(again.status, "duplicate"); assert.equal(again.row, 4);
  assert.equal(gas.sheets.get("Order Tracking").display(5, 1), "");
  assert.equal(gas.drafts.length, 1, "only one draft");
});

test("same 4-digit number but a different Square payment = new row + warning", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  post(gas, { ...base, auth: "test-secret" });
  const res = post(gas, { ...base, square_payment_id: "PAY2", receipt_url: "https://squareupsandbox.com/receipt/preview/PAY2", auth: "test-secret" });
  assert.equal(res.status, "appended"); assert.equal(res.row, 5);
  const log = gas.sheets.get("Automation Log").toCSV();
  assert.match(log, /WARN,PR-4827,Order number reused/);
});

test("every website option maps to a real Price List service (all 28)", () => {
  const gas = createGas();
  const ss = gas.ss;
  const rubbers = [["Unparallel RH", "4.2mm"], ["Unparallel RH", "5.5mm"], ["Vibram XS Grip", "4.0mm"], ["Vibram XS Edge", "4.0mm"]];
  let n = 0;
  for (const [r, t] of rubbers) for (const rand of ["None", "Toe cap", "Half rand", "Full rand"])
    for (const cov of rand === "None" ? [""] : ["Both shoes", "Single shoe only"]) {
      const svc = gas.context.lookupService_(ss, r, t, rand, cov);
      const row = PRICE_LIST.find((p) => p[0] === svc);
      assert.ok(row, `no service for ${r} ${t} ${rand} ${cov}`);
      assert.deepEqual(row.slice(2, 6), [r, t, rand, cov]);
      n++;
    }
  assert.equal(n, 28);
});

test("values outside the dropdowns fall back to Other/None and are logged", () => {
  const gas = createGas();
  const m = gas.context.mapOrder_({ ...base, rubber: "Cheap rubber", thickness: "3mm", rand_repair: "Patch" }, gas.ss);
  assert.equal(m.row[6], "Other"); assert.equal(m.row[7], "Other"); assert.equal(m.row[8], "None"); assert.equal(m.row[9], "");
  assert.equal(m.warnings.length >= 3, true);
});

test("TEST_MODE (default) writes to 'Test Orders', created with the same headers", () => {
  const gas = createGas(); // TEST_MODE unset => true
  const res = post(gas, { ...base, auth: "test-secret" });
  assert.equal(res.sheet, "Test Orders"); assert.equal(res.row, 2);
  const t = gas.sheets.get("Test Orders");
  assert.equal(t.getRange(1, 1, 1, 22).getDisplayValues()[0].join("|"),
    "Order ID|Customer Name|Email|Phone|Order Date|Service|Rubber|Thickness|Rand Repair|Rand Coverage|Pairs|Shoe Model|Size|Amount (AUD)|List Price (x Pairs)|Drop-off / Pick-up|Status|Shoes Received Date|Due Date|Returned Date|Square Receipt|Notes");
  assert.equal(gas.sheets.get("Order Tracking").display(4, 1), "", "real tab untouched");
});

test("Gmail DRAFT only (never sent), built from template fields with the new wording", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  const res = post(gas, { ...base, auth: "test-secret" });
  assert.equal(res.draft, "created");
  const d = gas.drafts[0];
  assert.equal(d.to, "alex@example.org");
  assert.equal(d.subject, "Thanks for your order - here is what happens next (PR-4827)");
  for (const s of ["Grab a tag and note from the Perth Resoles wooden board at the gym.",
    "Write your name and order number (PR-4827) on the note, attach the tag to your shoes, and hand them in at the counter.",
    "Let us know once they're dropped off by replying to this email or messaging us on Instagram.",
    "3 weeks from when we collect your shoes", "perthresoles@gmail.com", "@perthresoles", "Hi Alex,", "$120.00 AUD"])
    assert.ok(d.text.includes(s), "text missing: " + s);
  assert.ok(d.html.includes("Write your name and order number (<strong>PR-4827</strong>)"));
  assert.ok(!/hills/i.test(d.html + d.text));
});

test("HOME-ADDRESS GUARD: 'Perth Hills' in the shoe model blocks the draft and logs it", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  const res = post(gas, { ...base, shoe_model: "Solution from perth hills", auth: "test-secret" });
  assert.equal(res.status, "appended"); assert.equal(res.draft, "blocked");
  assert.equal(gas.drafts.length, 0);
  assert.match(gas.sheets.get("Automation Log").toCSV(), /BLOCKED,PR-4827,Email draft blocked by address guard,"?Matched blocked word ""?Perth Hills/);
});

test("owner's own blocked word (e.g. street name) blocks too; Perth Hills always stays on", () => {
  const gas = createGas({ props: { TEST_MODE: "false", BLOCKED_WORDS: "Example Street" } });
  assert.equal(post(gas, { ...base, shoe_model: "Solution, Example Street", auth: "test-secret" }).draft, "blocked");
  assert.ok(gas.context.props_().blocked.includes("Perth Hills"));
});

test("Notes are never used in the email; HTML is escaped", () => {
  const gas = createGas();
  const e = gas.context.renderConfirmationEmail_({ ...base, shoe_model: "<script>x</script>", notes: "18 Secret Road Perth Hills" }, "Svc");
  assert.ok(!e.html.includes("<script>x"));
  assert.ok(!e.html.includes("Secret Road") && !e.text.includes("Secret Road"));
});

test("non-Urban-Jungle drop-off: row added, no automated email (manual)", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  const res = post(gas, { ...base, dropoff: "TBC", dropoff_key: "arrange", auth: "test-secret" });
  assert.equal(res.draft, "skipped (not Urban Jungle)");
  assert.equal(gas.drafts.length, 0);
});

test("header mismatch stops the write", () => {
  const gas = createGas({ props: { TEST_MODE: "false" } });
  gas.sheets.get("Order Tracking").set(1, 4, { v: "Mobile", f: "" });
  const res = post(gas, { ...base, auth: "test-secret" });
  assert.equal(res.ok, false); assert.match(res.error, /Column 4/);
});
