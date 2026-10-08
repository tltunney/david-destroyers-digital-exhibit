// ─────────────────────────────────────────────────────────────
//  AGO — store settings and product catalogue.
//  Edit this file to change products, prices, drop date, links.
// ─────────────────────────────────────────────────────────────

export const STORE = {
  name: "AGO",
  instagram: "https://www.instagram.com/ago.shop_",
  tiktok: "https://www.tiktok.com/@ago.shop_",
  handle: "@ago.shop_",
  currency: "USD",
  freeShippingAt: 150,           // free-shipping threshold shown in the cart bar
  // Next release. Countdown shows on the home page; switches to "OUT NOW" once passed.
  nextDrop: { name: "THE BEANIE COLLECTION", date: "2026-11-21T12:00:00-05:00" },
  // Where the Checkout button sends people. Point this at your Shopify / Stripe checkout.
  checkoutUrl: "https://ago-shop.com/cart",
  announcements: [
    "SPIDER-MAN × SUPERMAN REVERSIBLE ZIP-UP — OUT NOW",
    "ORDERS SHIP DAILY",
    "JOIN THE LIST FOR RESTOCK ALERTS",
  ],
};

// Product artwork is drawn from `sides` until real photos are added.
//   sides: one entry per side of the garment. Reversible pieces have two.
//     base  – main color     trim – sleeves / hood / cuff color
//     pattern – "web" | "star" | "plain"     eyes – true draws mask eyes (beanies)
// image / imageBack: optional real photo paths, e.g. "images/zip-front.jpg" — overrides the artwork.
// stock: units per size. 0 = sold out in that size.
//
// The first two products and the Spidey beanies come from AGO's own posts.
// Prices, stock and the other products are PLACEHOLDERS — replace with the real catalogue.
export const PRODUCTS = [
  { id: "spider-super-zip", name: "Spider-Man × Superman Reversible Zip-Up", collab: "AGO × AVIANCE",
    type: "zip", category: "zip-ups", price: 120, drop: "02", tag: "OUT NOW", reversible: true,
    sides: [
      { name: "Spider side", base: "#d42a2a", trim: "#1d3f9e", pattern: "web" },
      { name: "Super side", base: "#1d3f9e", trim: "#d42a2a", pattern: "star" },
    ],
    stock: { S: 6, M: 9, L: 4, XL: 3, XXL: 1 },
    desc: "Two heroes, one zip-up. Wear it Spider-Man red with the web print, flip it inside out for Superman blue. Full-length two-way zip, heavyweight fleece, made with Aviance." },
  { id: "symbiote-zip", name: "Symbiote Reversible Zip-Up",
    type: "zip", category: "zip-ups", price: 120, drop: "02", tag: "NEW", reversible: true,
    sides: [
      { name: "Black side", base: "#121212", trim: "#121212", pattern: "web", web: "#f4f1e8" },
      { name: "White side", base: "#f4f1e8", trim: "#121212", pattern: "plain" },
    ],
    stock: { S: 2, M: 3, L: 1, XL: 0, XXL: 0 },
    desc: "Placeholder product. Black web side, clean white side. Reversible full-zip in heavyweight fleece." },
  { id: "spidey-beanie-red", name: "Spidey Beanie", type: "beanie", category: "beanies",
    price: 40, drop: "03", tag: "NEW",
    sides: [{ name: "Red", base: "#d42a2a", trim: "#d42a2a", pattern: "web", eyes: true }],
    stock: { OS: 12 },
    desc: "Knit beanie with an all-over web and mask eyes. From the AGO beanie collection." },
  { id: "spidey-beanie-black", name: "Spidey Beanie", type: "beanie", category: "beanies",
    price: 40, drop: "03",
    sides: [{ name: "Black", base: "#151515", trim: "#151515", pattern: "web", web: "#9a9a9a", eyes: true }],
    stock: { OS: 3 },
    desc: "Knit beanie with an all-over web and mask eyes. From the AGO beanie collection." },
  { id: "spidey-beanie-blue", name: "Spidey Beanie", type: "beanie", category: "beanies",
    price: 40, drop: "03",
    sides: [{ name: "Blue", base: "#1d3f9e", trim: "#d42a2a", pattern: "web", eyes: true }],
    stock: { OS: 0 },
    desc: "Knit beanie with an all-over web, red cuff and mask eyes. From the AGO beanie collection." },
  { id: "super-beanie", name: "Super Reversible Beanie", type: "beanie", category: "beanies",
    price: 40, drop: "03", reversible: true,
    sides: [
      { name: "Blue side", base: "#1d3f9e", trim: "#d42a2a", pattern: "star" },
      { name: "Red side", base: "#d42a2a", trim: "#1d3f9e", pattern: "plain" },
    ],
    stock: { OS: 8 },
    desc: "Placeholder product. Flip between blue with a gold star and solid red." },
  { id: "web-tee", name: "Web Slinger Tee", type: "tee", category: "tees",
    price: 45, drop: "02",
    sides: [{ name: "Black", base: "#121212", trim: "#121212", pattern: "web", web: "#d42a2a" }],
    stock: { S: 8, M: 10, L: 7, XL: 4, XXL: 2 },
    desc: "Placeholder product. Heavyweight boxy tee with a red web print." },
  { id: "hero-tee", name: "Hero Panel Tee", type: "tee", category: "tees",
    price: 45, drop: "02",
    sides: [{ name: "Cream", base: "#f4f1e8", trim: "#f4f1e8", pattern: "star" }],
    stock: { S: 0, M: 2, L: 3, XL: 1, XXL: 0 },
    desc: "Placeholder product. Cream boxy tee with a gold star chest hit." },
  { id: "web-sweatpant", name: "Web Sweatpant", type: "pants", category: "bottoms",
    price: 75, drop: "02",
    sides: [{ name: "Red / Blue", base: "#d42a2a", trim: "#1d3f9e", pattern: "web" }],
    stock: { S: 4, M: 6, L: 5, XL: 2, XXL: 0 },
    desc: "Placeholder product. Matches the reversible zip-up. Red web legs, blue waistband." },
];

export const CATEGORIES = [
  { id: "zip-ups", label: "Reversible Zip-Ups" },
  { id: "beanies", label: "Beanies" },
  { id: "tees", label: "Tees" },
  { id: "bottoms", label: "Bottoms" },
];

export const SIZE_GUIDE = {
  note: "Relaxed fit. Size down for a regular fit. Measurements in inches, laid flat.",
  rows: [
    ["Size", "Chest", "Length", "Sleeve"],
    ["S", "22", "26", "22"],
    ["M", "23", "27", "22.5"],
    ["L", "24", "28", "23"],
    ["XL", "25", "29", "23.5"],
    ["XXL", "26", "30", "24"],
  ],
};
