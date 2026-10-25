// Local stand-in for the deployed Apps Script web app (for trials without touching the real sheet).
// Runs the REAL apps-script/Code.gs against in-memory mock sheets and a mock GmailApp, and records:
//   OUT/received.jsonl     every JSON body received (secret redacted)
//   OUT/drafts/PR-xxxx.html/.txt   the email that WOULD be drafted
//   OUT/<tab>.csv          the mock sheet tabs after each request
// Like real Apps Script, POST /exec answers with a 302 redirect to a one-time URL holding the result.
// Usage: SHARED_SECRET=... TEST_MODE=true OUT=/tmp/mock-sheet node apps-script/test/mock-sheet-server.mjs [port]
import http from "node:http";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { createGas } from "./gas-mock.mjs";

const PORT = Number(process.argv[2] || process.env.PORT || 8799);
const OUT = process.env.OUT || "./mock-sheet-output";
mkdirSync(OUT + "/drafts", { recursive: true });
const gas = createGas({ props: { SHARED_SECRET: process.env.SHARED_SECRET || "test-secret", TEST_MODE: process.env.TEST_MODE || "true" } });
const results = new Map();
let n = 0;

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/echo") {
    const body = results.get(url.searchParams.get("id")) || '{"ok":false,"error":"expired"}';
    results.delete(url.searchParams.get("id"));
    res.writeHead(200, { "content-type": "application/json" }); return res.end(body);
  }
  if (req.method !== "POST" || url.pathname !== "/exec") { res.writeHead(404); return res.end(); }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let rec; try { rec = JSON.parse(raw); } catch { rec = { unparsable: raw.slice(0, 200) }; }
    const logged = { received_at: new Date().toISOString(), header_secret_present: !!req.headers["x-perth-resoles-secret"], body: { ...rec, auth: rec.auth ? "[redacted]" : rec.auth } };
    appendFileSync(OUT + "/received.jsonl", JSON.stringify(logged) + "\n");
    const before = gas.drafts.length;
    let out;
    try { out = gas.context.doPost({ postData: { contents: raw } }).getContent(); }
    catch (e) { out = JSON.stringify({ ok: false, error: String(e.message) }); }
    for (const d of gas.drafts.slice(before)) {
      const ref = (d.subject.match(/\((PR-\d{4})\)/) || [])[1] || "draft";
      writeFileSync(`${OUT}/drafts/${ref}.html`, d.html);
      writeFileSync(`${OUT}/drafts/${ref}.txt`, `To: ${d.to}\nFrom name: ${d.name}\nSubject: ${d.subject}\n\n${d.text}\n`);
    }
    for (const [name, sheet] of gas.sheets) if (name !== "Price List") writeFileSync(`${OUT}/${name.replace(/\s+/g, "_")}.csv`, sheet.toCSV() + "\n");
    console.log(`[mock-sheet] ${rec.order_id || "?"} via ${rec.via || "?"} -> ${out}`);
    const id = String(++n);
    results.set(id, out);
    res.writeHead(302, { location: `http://127.0.0.1:${PORT}/echo?id=${id}` }); res.end();
  });
}).listen(PORT, "127.0.0.1", () => console.log(`[mock-sheet] listening on http://127.0.0.1:${PORT}/exec, output in ${OUT}`));
