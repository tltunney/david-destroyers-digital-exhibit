// ─────────────────────────────────────────────────────────────
//  AGO — store settings and product catalogue.
//  Edit this file to change products, prices, drop date, links.
// ─────────────────────────────────────────────────────────────

export const STORE = {
  name: "AGO",
  instagram: "https://www.instagram.com/ago.shop_",
  handle: "@ago.shop_",
  currency: "USD",
  freeShippingAt: 150,           // free-shipping threshold shown in the cart bar
  // Next drop. Countdown shows on the home page; switches to "LIVE NOW" once passed.
  nextDrop: { name: "DROP 004 — 'AFTER HOURS'", date: "2026-10-24T18:00:00-04:00" },
  // Where the Checkout button sends people. Point this at your Shopify / Stripe checkout.
  checkoutUrl: "https://ago-shop.com/cart",
  announcements: [
    "FREE SHIPPING ON ORDERS OVER $150",
    "DROP 004 LANDS 10.24 — JOIN THE LIST FOR EARLY ACCESS",
    "LIMITED RUNS. NO RESTOCKS.",
  ],
};

// type: hoodie | tee | pants | shorts | cap | beanie | crew  (picks the placeholder artwork)
// image / imageBack: optional real photo paths, e.g. "images/hoodie-front.jpg" — overrides the artwork.
// stock: units per size. 0 = sold out in that size.
export const PRODUCTS = [
  { id: "after-hours-hoodie", name: "After Hours Heavyweight Hoodie", type: "hoodie", category: "hoodies",
    price: 110, color: "Washed Black", hex: "#1c1c1c", ink: "#ff3b1f", drop: "004", tag: "NEW",
    stock: { S: 4, M: 9, L: 2, XL: 6, XXL: 0 },
    desc: "500gsm brushed-back fleece, boxy fit, dropped shoulders. Puff-print AGO wordmark on chest, oversized back hit." },
  { id: "after-hours-hoodie-bone", name: "After Hours Heavyweight Hoodie", type: "hoodie", category: "hoodies",
    price: 110, color: "Bone", hex: "#e7dfcf", ink: "#141414", drop: "004", tag: "NEW",
    stock: { S: 3, M: 1, L: 5, XL: 2, XXL: 2 },
    desc: "500gsm brushed-back fleece, boxy fit, dropped shoulders. Puff-print AGO wordmark on chest, oversized back hit." },
  { id: "signal-tee", name: "Signal Boxy Tee", type: "tee", category: "tees",
    price: 48, color: "Black", hex: "#141414", ink: "#f2f0eb", drop: "004", tag: "NEW",
    stock: { S: 10, M: 12, L: 8, XL: 4, XXL: 3 },
    desc: "260gsm combed cotton, cropped boxy cut, ribbed collar. Screen-printed front and back." },
  { id: "signal-tee-red", name: "Signal Boxy Tee", type: "tee", category: "tees",
    price: 48, color: "Signal Red", hex: "#c4241a", ink: "#f2f0eb", drop: "004",
    stock: { S: 0, M: 2, L: 1, XL: 0, XXL: 0 },
    desc: "260gsm combed cotton, cropped boxy cut, ribbed collar. Screen-printed front and back." },
  { id: "utility-cargo", name: "Utility Parachute Cargo", type: "pants", category: "bottoms",
    price: 125, color: "Charcoal", hex: "#34343a", ink: "#ff3b1f", drop: "004", tag: "NEW",
    stock: { S: 5, M: 7, L: 6, XL: 3, XXL: 1 },
    desc: "Ripstop nylon, drawcord hem, six-pocket build. Relaxed through the leg, stacks over sneakers." },
  { id: "core-sweatpant", name: "Core Heavyweight Sweatpant", type: "pants", category: "bottoms",
    price: 90, color: "Heather Grey", hex: "#9b9a98", ink: "#141414", drop: "003",
    stock: { S: 6, M: 8, L: 8, XL: 5, XXL: 2 },
    desc: "Matches the After Hours hoodie. Open hem, wide leg, embroidered AGO hit on left thigh." },
  { id: "mesh-short", name: "Night Run Mesh Short", type: "shorts", category: "bottoms",
    price: 58, color: "Black / Red", hex: "#151515", ink: "#ff3b1f", drop: "003",
    stock: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 },
    desc: "Double-layer mesh, 7\" inseam, contrast piping. Sold out — tap Notify Me for restock news." },
  { id: "logo-crew", name: "Archive Logo Crewneck", type: "crew", category: "hoodies",
    price: 95, color: "Forest", hex: "#24382c", ink: "#e7dfcf", drop: "003",
    stock: { S: 2, M: 4, L: 4, XL: 1, XXL: 0 },
    desc: "450gsm loopback fleece, vintage wash, cracked-print arch logo." },
  { id: "signature-cap", name: "Signature 6-Panel Cap", type: "cap", category: "headwear",
    price: 42, color: "Black", hex: "#161616", ink: "#f2f0eb", drop: "004",
    stock: { OS: 14 },
    desc: "Washed cotton twill, curved brim, 3D-embroidered AGO. Brass strap-back." },
  { id: "rib-beanie", name: "Ribbed Logo Beanie", type: "beanie", category: "headwear",
    price: 36, color: "Signal Red", hex: "#c4241a", ink: "#f2f0eb", drop: "004", tag: "NEW",
    stock: { OS: 3 },
    desc: "Chunky acrylic rib knit, fold-over cuff, woven AGO label." },
  { id: "static-tee", name: "Static Graphic Tee", type: "tee", category: "tees",
    price: 52, color: "Off-White", hex: "#ece8de", ink: "#141414", drop: "003",
    stock: { S: 4, M: 6, L: 6, XL: 2, XXL: 1 },
    desc: "Heavy cotton jersey, faded wash. Distorted static graphic across the back." },
  { id: "zip-hoodie", name: "Full-Zip Hoodie", type: "hoodie", category: "hoodies",
    price: 120, color: "Slate", hex: "#4a5560", ink: "#e7dfcf", drop: "003",
    stock: { S: 1, M: 3, L: 2, XL: 2, XXL: 0 },
    desc: "Two-way metal zip, heavyweight fleece, tonal embroidered logo on hood." },
];

export const CATEGORIES = [
  { id: "hoodies", label: "Hoodies & Crews" },
  { id: "tees", label: "Tees" },
  { id: "bottoms", label: "Bottoms" },
  { id: "headwear", label: "Headwear" },
];

export const SIZE_GUIDE = {
  note: "Boxy fit. Size down for a regular fit. Measurements in inches, laid flat.",
  rows: [
    ["Size", "Chest", "Length", "Sleeve"],
    ["S", "23", "26.5", "22"],
    ["M", "24", "27.5", "22.5"],
    ["L", "25", "28.5", "23"],
    ["XL", "26", "29.5", "23.5"],
    ["XXL", "27", "30.5", "24"],
  ],
};
