// Minimal in-memory mocks of SpreadsheetApp / GmailApp / LockService / PropertiesService / ContentService
// so apps-script/Code.gs can be run and tested with Node (no Google account needed).
// Simulates the real Order Tracking layout: header ARRAYFORMULAs in O1 and S1 that "own" columns O and S.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PRICE_LIST = [ // Price List columns A..G exactly as in the owner's sheet (service names copied verbatim)
  ["Service (Square item name)", "Category", "Rubber", "Thickness", "Rand Repair", "Rand Coverage", "Price (AUD)"],
  ["Basic Resole with Unparallel 4.2mm RH", "Basic Resole", "Unparallel RH", "4.2mm", "None", "", 80],
  ["4.2mm Unparallel RH -  Resole and Toe Cap (pair)", "Resole + Toe Cap", "Unparallel RH", "4.2mm", "Toe cap", "Both shoes", 120],
  ["4.2mm Unparallel RH -  Resole and Half Rand Repair (pair)", "Resole + Half Rand", "Unparallel RH", "4.2mm", "Half rand", "Both shoes", 140],
  ["4.2mm Unparallel RH -  Resole and Full Rand Repair (pair)", "Resole + Full Rand", "Unparallel RH", "4.2mm", "Full rand", "Both shoes", 170],
  ["4.2mm Unparallel RH -  Resole and Toe Cap (single shoe)", "Resole + Toe Cap", "Unparallel RH", "4.2mm", "Toe cap", "Single shoe only", 100],
  ["4.2mm Unparallel RH -  Resole and Half Rand Repair (single shoe)", "Resole + Half Rand", "Unparallel RH", "4.2mm", "Half rand", "Single shoe only", 110],
  ["4.2mm Unparallel RH -  Resole and Full Rand Repair (single shoe)", "Resole + Full Rand", "Unparallel RH", "4.2mm", "Full rand", "Single shoe only", 125],
  ["Basic Resole Unparallel 5.5mm RH", "Basic Resole", "Unparallel RH", "5.5mm", "None", "", 90],
  ["5.5mm Unparallel RH Rubber - Resole and Toe Cap Repair (Pair)", "Resole + Toe Cap", "Unparallel RH", "5.5mm", "Toe cap", "Both shoes", 130],
  ["5.5mm Unparallel RH Rubber - Resole and Half Rand Repair (Pair)", "Resole + Half Rand", "Unparallel RH", "5.5mm", "Half rand", "Both shoes", 150],
  ["5.5mm Unparallel RH Rubber - Resole and Full Rand Repair (Pair)", "Resole + Full Rand", "Unparallel RH", "5.5mm", "Full rand", "Both shoes", 180],
  ["5.5mm Unparallel RH Rubber - Resole and Toe Cap Repair (single shoe)", "Resole + Toe Cap", "Unparallel RH", "5.5mm", "Toe cap", "Single shoe only", 110],
  ["5.5mm Unparallel RH Rubber - Resole and Half Rand Repair (single shoe)", "Resole + Half Rand", "Unparallel RH", "5.5mm", "Half rand", "Single shoe only", 120],
  ["5.5mm Unparallel RH Rubber - Resole and Full Rand Repair (single shoe)", "Resole + Full Rand", "Unparallel RH", "5.5mm", "Full rand", "Single shoe only", 135],
  ["Basic Resole with Vibram XS Grip 4.0mm", "Basic Resole", "Vibram XS Grip", "4.0mm", "None", "", 80],
  ["Vibram XS Grip 4.0mm - Resole and Toe Cap Repair (pair)", "Resole + Toe Cap", "Vibram XS Grip", "4.0mm", "Toe cap", "Both shoes", 120],
  ["Vibram XS Grip 4.0mm - Resole and Half Rand Repair (Pair)", "Resole + Half Rand", "Vibram XS Grip", "4.0mm", "Half rand", "Both shoes", 140],
  ["Vibram XS Grip 4.0mm - Resole and Full Rand Repair (Pair)", "Resole + Full Rand", "Vibram XS Grip", "4.0mm", "Full rand", "Both shoes", 170],
  ["Vibram XS Grip 4.0mm - Resole and Toe Cap Repair (single shoe)", "Resole + Toe Cap", "Vibram XS Grip", "4.0mm", "Toe cap", "Single shoe only", 100],
  ["Vibram XS Grip 4.0mm - Resole and Half Rand Repair (single shoe)", "Resole + Half Rand", "Vibram XS Grip", "4.0mm", "Half rand", "Single shoe only", 110],
  ["Vibram XS Grip 4.0mm - Resole and Full Rand Repair (single shoe)", "Resole + Full Rand", "Vibram XS Grip", "4.0mm", "Full rand", "Single shoe only", 125],
  ["Basic Resole with Vibram XS Edge 4.0mm", "Basic Resole", "Vibram XS Edge", "4.0mm", "None", "", 80],
  ["Vibram XS Edge 4.0mm - Resole and Toe Cap (pair)", "Resole + Toe Cap", "Vibram XS Edge", "4.0mm", "Toe cap", "Both shoes", 120],
  ["Vibram XS Edge 4.0mm - Resole and Half Rand Repair (pair)", "Resole + Half Rand", "Vibram XS Edge", "4.0mm", "Half rand", "Both shoes", 140],
  ["Vibram XS Edge 4.0mm - Resole and Full Rand Repair (pair)", "Resole + Full Rand", "Vibram XS Edge", "4.0mm", "Full rand", "Both shoes", 170],
  ["Vibram XS Edge 4.0mm - Resole and Toe Cap (single shoe)", "Resole + Toe Cap", "Vibram XS Edge", "4.0mm", "Toe cap", "Single shoe only", 100],
  ["Vibram XS Edge 4.0mm - Resole and Half Rand Repair (single)", "Resole + Half Rand", "Vibram XS Edge", "4.0mm", "Half rand", "Single shoe only", 110],
  ["Vibram XS Edge 4.0mm - Resole and Full Rand Repair (single shoe)", "Resole + Full Rand", "Vibram XS Edge", "4.0mm", "Full rand", "Single shoe only", 125],
  ["Stitch Repair", "Stitch Repair", "", "", "", "", ""],
];
export { PRICE_LIST };

const HEADERS = ["Order ID", "Customer Name", "Email", "Phone", "Order Date", "Service", "Rubber", "Thickness",
  "Rand Repair", "Rand Coverage", "Pairs", "Shoe Model", "Size", "Amount (AUD)", "List Price (x Pairs)",
  "Drop-off / Pick-up", "Status", "Shoes Received Date", "Due Date", "Returned Date", "Square Receipt", "Notes"];
const ARRAY_COLS = { 15: "List Price (x Pairs)", 19: "Due Date" };

class Sheet {
  constructor(name, rows = 1000) { this.name = name; this.cells = new Map(); this.maxRows = rows; this.arrayHeader = false; this.frozen = 0; }
  key(r, c) { return r + ":" + c; }
  get(r, c) { return this.cells.get(this.key(r, c)) || { v: null, f: "" }; }
  set(r, c, cell) { this.cells.set(this.key(r, c), cell); }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  setFrozenRows(n) { this.frozen = n; }
  // Like real Sheets with ARRAYFORMULA columns: cells holding "" from the array count as content.
  getLastRow() {
    let m = 0;
    for (const [k, cell] of this.cells) { const r = +k.split(":")[0]; if (cell.v !== null || cell.f) m = Math.max(m, r); }
    if (this.arrayHeader) m = Math.max(m, this.maxRows);
    return m;
  }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, i) => this.set(r, i + 1, { v, f: "" })); }
  display(r, c) {
    const cell = this.get(r, c);
    if (this.arrayHeader && ARRAY_COLS[c]) {
      if (r === 1) return ARRAY_COLS[c];
      if (cell.v !== null && cell.v !== "") return "#REF!";
      if (c === 15) { // List Price = VLOOKUP(Service) * Pairs
        const svc = this.get(r, 6).v; if (!svc) return "";
        const row = PRICE_LIST.find((p) => p[0] === svc); return row ? String(row[6] * (Number(this.get(r, 11).v) || 1)) : "";
      }
      const rec = this.get(r, 18).v; return rec ? "due+21" : "";
    }
    const v = cell.v;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return v === null || v === undefined ? "" : String(v);
  }
  toCSV(maxRow) {
    const last = maxRow || [...this.cells.keys()].reduce((m, k) => Math.max(m, +k.split(":")[0]), 1);
    const out = [];
    for (let r = 1; r <= last; r++) {
      const row = []; for (let c = 1; c <= 22; c++) row.push(this.display(r, c));
      if (row.some((x) => x !== "")) out.push(row.map((x) => /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x).join(","));
    }
    return out.join("\n");
  }
}

class Range {
  constructor(s, r, c, nr, nc) { Object.assign(this, { s, r, c, nr, nc }); }
  getDisplayValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.s.display(this.r + i, this.c + j)); o.push(row); } return o; }
  getValues() { return this.getDisplayValues(); }
  getFormula() { return this.s.get(this.r, this.c).f || ""; }
  setValues(vals) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      const r = this.r + i, c = this.c + j;
      if (this.s.arrayHeader && ARRAY_COLS[c] && r >= 2) throw new Error(`WROTE INTO ARRAYFORMULA COLUMN ${c} row ${r} (would break the sheet with #REF!)`);
      this.s.set(r, c, { v: vals[i][j], f: "" });
    }
    this.s.writes = (this.s.writes || 0) + 1;
    return this;
  }
  copyTo(target, type) {
    const t = type || "ALL";
    for (let i = 0; i < target.nr; i++) for (let j = 0; j < target.nc; j++) {
      const src = this.s.get(this.r + (i % this.nr), this.c + (j % this.nc));
      const tr = target.r + i, tc = target.c + j;
      if (t === "PASTE_FORMAT" || t === "PASTE_DATA_VALIDATION") { (target.s.meta ||= {})[tr + ":" + tc + ":" + t] = true; continue; }
      if (t === "PASTE_FORMULA" && target.s.arrayHeader && ARRAY_COLS[tc] && tr >= 2) throw new Error("copied formula into ARRAYFORMULA column");
      target.s.set(tr, tc, { ...src });
      if (tr === 1 && this.s.arrayHeader) target.s.arrayHeader = true;
    }
  }
}

export function createGas({ props = {}, seedRows = true } = {}) {
  const sheets = new Map();
  const tracking = new Sheet("Order Tracking"); tracking.arrayHeader = true;
  HEADERS.forEach((h, i) => tracking.set(1, i + 1, ARRAY_COLS[i + 1]
    ? { v: null, f: i + 1 === 15 ? '={"List Price (x Pairs)";ARRAYFORMULA(...)}' : '={"Due Date";ARRAYFORMULA(...)}' } : { v: h, f: "" }));
  if (seedRows) { // two fake existing orders (no real customer data)
    [["#AAAA", "Existing One", "one@example.org", "", new Date("2026-10-01"), "Basic Resole with Vibram XS Grip 4.0mm", "Vibram XS Grip", "4.0mm", "None", "", 1, "TC Pro", "44", 80],
     ["#BBBB", "Existing Two", "two@example.org", "", new Date("2026-10-05"), "Vibram XS Edge 4.0mm - Resole and Toe Cap (pair)", "Vibram XS Edge", "4.0mm", "Toe cap", "Both shoes", 1, "", "", 120]]
      .forEach((row, k) => row.forEach((v, i) => tracking.set(k + 2, i + 1, { v, f: "" })));
    [2, 3].forEach((r) => { tracking.set(r, 16, { v: "Drop off and Pick up at Urban Jungle Climbing Gym", f: "" }); tracking.set(r, 17, { v: "Paid", f: "" }); });
  }
  const price = new Sheet("Price List");
  PRICE_LIST.forEach((row, i) => row.forEach((v, j) => price.set(i + 1, j + 1, { v, f: "" })));
  sheets.set(tracking.name, tracking); sheets.set(price.name, price);

  const drafts = [], logs = [];
  const propStore = { SHARED_SECRET: "test-secret", ...props };
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
  };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, CopyPasteType: { PASTE_FORMAT: "PASTE_FORMAT", PASTE_DATA_VALIDATION: "PASTE_DATA_VALIDATION", PASTE_FORMULA: "PASTE_FORMULA" } },
    GmailApp: { createDraft: (to, subject, text, opts) => { drafts.push({ to, subject, text, html: opts.htmlBody, name: opts.name }); return { getId: () => "draft-" + drafts.length }; },
                sendEmail: () => { throw new Error("sendEmail must never be called"); } },
    MailApp: { sendEmail: () => { throw new Error("MailApp.sendEmail must never be called"); } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in propStore ? propStore[k] : null), setProperty: (k, v) => { propStore[k] = v; } }) },
    ContentService: { MimeType: { JSON: "JSON" }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return this.text; } }) },
    Logger: { log: (m) => logs.push(String(m)) },
    Utilities: { getUuid: () => crypto.randomUUID() },
    Session: { getActiveUser: () => ({ getEmail: () => "owner@example.org" }) },
    console, Date, JSON, Math, String, Number, Object, Array, Error, RegExp,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../Code.gs", import.meta.url), "utf8"), context, { filename: "Code.gs" });
  return { context, sheets, drafts, logs, props: propStore, ss };
}
