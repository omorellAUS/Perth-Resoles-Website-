// SINGLE SOURCE OF TRUTH for Perth Resoles prices (AUD, in cents).
// Must match the Google Sheet "Price List" and what index.html shows.
// `npm run check-prices` fails if index.html drifts from this table.

export const CURRENCY = "AUD";

export const RUBBERS = {
  "unparallel-4.2": { name: "Unparallel RH 4.2mm", cents: 8000 },
  "unparallel-5.5": { name: "Unparallel RH 5.5mm", cents: 9000 },
  "vibram-xs-grip": { name: "Vibram XS Grip 4.0mm", cents: 8000 },
  "vibram-xs-edge": { name: "Vibram XS Edge 4.0mm", cents: 8000 },
};

// Rand add-ons: price for both shoes / a single shoe.
export const RAND_REPAIRS = {
  none: { name: "No rand repair", both: 0, single: 0 },
  "toe-cap": { name: "Toe cap", both: 4000, single: 2000 },
  "half-rand": { name: "Half rand", both: 6000, single: 3000 },
  "full-rand": { name: "Full rand", both: 9000, single: 4500 },
};

export const RAND_COVERAGE = {
  both: "both shoes",
  single: "single shoe",
};

// Drop-off options. Public gym counter only. Never put a home address here.
export const DROPOFFS = {
  "urban-jungle": "Urban Jungle Climbing Gym (counter)",
  arrange: "Other - arrange handover via Instagram",
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
