// SINGLE SOURCE OF TRUTH for Perth Resoles prices (AUD, in cents).
// Must match the Google Sheet "Price List" and what index.html shows.
// `npm run check-prices` fails if index.html drifts from this table.

export const CURRENCY = "AUD";

export const RUBBERS = {
  // sheetRubber / sheetThickness = the dropdown values in the Order Tracker sheet.
  "unparallel-4.2": { name: "Unparallel RH 4.2mm", cents: 8000, sheetRubber: "Unparallel RH", sheetThickness: "4.2mm" },
  "unparallel-5.5": { name: "Unparallel RH 5.5mm", cents: 9000, sheetRubber: "Unparallel RH", sheetThickness: "5.5mm" },
  "vibram-xs-grip": { name: "Vibram XS Grip 4.0mm", cents: 8000, sheetRubber: "Vibram XS Grip", sheetThickness: "4.0mm" },
  "vibram-xs-edge": { name: "Vibram XS Edge 4.0mm", cents: 8000, sheetRubber: "Vibram XS Edge", sheetThickness: "4.0mm" },
};

// Rand add-ons: price for both shoes / a single shoe.
export const RAND_REPAIRS = {
  none: { name: "No rand repair", sheet: "None", both: 0, single: 0 },
  "toe-cap": { name: "Toe cap", sheet: "Toe cap", both: 4000, single: 2000 },
  "half-rand": { name: "Half rand", sheet: "Half rand", both: 6000, single: 3000 },
  "full-rand": { name: "Full rand", sheet: "Full rand", both: 9000, single: 4500 },
};

export const RAND_COVERAGE = {
  both: "both shoes",
  single: "single shoe",
};
// Sheet dropdown values for Rand Coverage.
export const SHEET_COVERAGE = { both: "Both shoes", single: "Single shoe only" };

// Drop-off options. Public gym counter only. Never put a home address here.
export const DROPOFFS = {
  "urban-jungle": "Urban Jungle Climbing Gym (counter)",
  arrange: "Other - arrange handover via Instagram",
};

// Sheet "Drop-off / Pick-up" values (match the Price List tab wording).
export const SHEET_DROPOFF = {
  "urban-jungle": "Drop off and Pick up at Urban Jungle Climbing Gym",
  arrange: "TBC",
};

export function priceCents(rubber, rand, coverage) {
  const r = RUBBERS[rubber];
  const a = RAND_REPAIRS[rand];
  if (!r || !a) return null;
  if (rand === "none") return r.cents;
  if (!(coverage in RAND_COVERAGE)) return null;
  return r.cents + a[coverage];
}

export function lineItemName(rubber, rand, coverage) {
  const base = "Resole: " + RUBBERS[rubber].name;
  if (rand === "none") return base;
  return `${base} + ${RAND_REPAIRS[rand].name} (${RAND_COVERAGE[coverage]})`;
}
