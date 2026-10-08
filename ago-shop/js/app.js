import { STORE, PRODUCTS, CATEGORIES, SIZE_GUIDE } from "./data.js";
import { media } from "./art.js";

// ── helpers ──────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: STORE.currency, maximumFractionDigits: 0 }).format(n);
const byId = (id) => PRODUCTS.find((p) => p.id === id);
const totalStock = (p) => Object.values(p.stock).reduce((a, b) => a + b, 0);
const soldOut = (p) => totalStock(p) === 0;
const lowStock = (p) => !soldOut(p) && totalStock(p) <= 8;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ── cart ─────────────────────────────────────────────────────
let cart = store.get("ago-cart", []).filter((l) => byId(l.id));
const saveCart = () => { store.set("ago-cart", cart); renderCart(); };
const cartCount = () => cart.reduce((a, l) => a + l.qty, 0);
const cartTotal = () => cart.reduce((a, l) => a + byId(l.id).price * l.qty, 0);

function addToCart(id, size) {
  const line = cart.find((l) => l.id === id && l.size === size);
  const max = byId(id).stock[size] ?? 0;
  if (line) line.qty = Math.min(line.qty + 1, max);
  else cart.push({ id, size, qty: 1 });
  saveCart();
  openCart();
  bump();
}

function bump() {
  const c = $(".cart-count");
  c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
}

// ── chrome: announcement bar, header, menu, cart, footer ─────
function renderChrome() {
  const page = document.body.dataset.page;
  document.body.insertAdjacentHTML("afterbegin", `
    <a class="skip" href="#main">Skip to content</a>
    <div class="announce" role="region" aria-label="Announcements">
      <div class="announce-track">${STORE.announcements.map((a) => `<span>${esc(a)}</span>`).join("")}</div>
    </div>
    <header class="site-header">
      <div class="header-inner">
        <button class="icon-btn menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu">
          <svg viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
        </button>
        <nav class="main-nav" aria-label="Main">
          <a href="shop.html" ${page === "shop" ? 'aria-current="page"' : ""}>Shop All</a>
          <a href="shop.html?drop=004">Drop 004</a>
          ${CATEGORIES.slice(0, 2).map((c) => `<a href="shop.html?cat=${c.id}">${c.label}</a>`).join("")}
        </nav>
        <a href="index.html" class="logo" aria-label="${STORE.name} home">AGO<sup>®</sup></a>
        <div class="header-actions">
          <a class="text-link hide-sm" href="index.html#list">Early Access</a>
          <a class="icon-btn hide-sm" href="${STORE.instagram}" target="_blank" rel="noopener" aria-label="Instagram">
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/></svg>
          </a>
          <button class="icon-btn cart-btn" aria-label="Open cart">
            <svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
            <span class="cart-count">0</span>
          </button>
        </div>
      </div>
    </header>
    <div class="mobile-menu" id="mobile-menu" hidden>
      <nav aria-label="Mobile">
        <a href="shop.html">Shop All</a>
        <a href="shop.html?drop=004">Drop 004</a>
        ${CATEGORIES.map((c) => `<a href="shop.html?cat=${c.id}">${c.label}</a>`).join("")}
        <a href="index.html#list">Early Access</a>
        <a href="${STORE.instagram}" target="_blank" rel="noopener">Instagram ↗</a>
      </nav>
    </div>
    <div class="scrim" hidden></div>
    <aside class="cart-drawer" aria-label="Cart" aria-hidden="true">
      <div class="drawer-head">
        <h2>Cart <span class="drawer-count"></span></h2>
        <button class="icon-btn close-cart" aria-label="Close cart"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="ship-bar"><p class="ship-msg"></p><div class="ship-track"><div class="ship-fill"></div></div></div>
      <div class="cart-lines"></div>
      <div class="cart-upsell"></div>
      <div class="drawer-foot">
        <div class="subtotal"><span>Subtotal</span><strong class="sub-amt"></strong></div>
        <p class="fine">Taxes and shipping calculated at checkout.</p>
        <a class="btn btn-solid btn-block checkout" href="${STORE.checkoutUrl}">Checkout</a>
      </div>
    </aside>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" hidden>
      <div class="modal-box">
        <button class="icon-btn modal-close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <div class="modal-body"></div>
      </div>
    </div>
    <div class="toast" role="status" aria-live="polite"></div>
  `);

  document.body.insertAdjacentHTML("beforeend", `
    <footer class="site-footer">
      <div class="footer-big" aria-hidden="true">AGO</div>
      <div class="footer-grid">
        <div>
          <h3>Shop</h3>
          <a href="shop.html">All Products</a>
          ${CATEGORIES.map((c) => `<a href="shop.html?cat=${c.id}">${c.label}</a>`).join("")}
        </div>
        <div>
          <h3>Help</h3>
          <a href="#" data-modal="shipping">Shipping</a>
          <a href="#" data-modal="returns">Returns & Exchanges</a>
          <a href="#" data-modal="size">Size Guide</a>
          <a href="mailto:support@ago-shop.com">Contact</a>
        </div>
        <div>
          <h3>Follow</h3>
          <a href="${STORE.instagram}" target="_blank" rel="noopener">Instagram ${esc(STORE.handle)}</a>
          <a href="#" aria-disabled="true">TikTok</a>
        </div>
        <form class="footer-signup signup-form">
          <h3>Get on the list</h3>
          <p>Early access to every drop. No spam.</p>
          <div class="field-row">
            <label class="sr" for="foot-email">Email</label>
            <input id="foot-email" type="email" required placeholder="Email address" autocomplete="email">
            <button class="btn btn-solid" type="submit">Join</button>
          </div>
        </form>
      </div>
      <div class="footer-base">
        <span>© ${new Date().getFullYear()} ${STORE.name}. All rights reserved.</span>
        <span>Limited runs · No restocks</span>
      </div>
    </footer>
  `);

  // events
  $(".cart-btn").addEventListener("click", openCart);
  $(".close-cart").addEventListener("click", closeCart);
  $(".scrim").addEventListener("click", () => { closeCart(); closeMenu(); });
  $(".menu-btn").addEventListener("click", () => ($(".mobile-menu").hidden ? openMenu() : closeMenu()));
  $(".modal-close").addEventListener("click", closeModal);
  $(".modal").addEventListener("click", (e) => { if (e.target.classList.contains("modal")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeCart(); closeMenu(); closeModal(); } });
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-modal]");
    if (m) { e.preventDefault(); openModal(m.dataset.modal); }
  });
  $$(".signup-form").forEach(wireSignup);

  // header turns solid once you scroll
  const header = $(".site-header");
  const onScroll = () => header.classList.toggle("scrolled", scrollY > 10);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  renderCart();
}

function openMenu() { $(".mobile-menu").hidden = false; $(".scrim").hidden = false; $(".menu-btn").setAttribute("aria-expanded", "true"); }
function closeMenu() { $(".mobile-menu").hidden = true; if (!$(".cart-drawer").classList.contains("open")) $(".scrim").hidden = true; $(".menu-btn").setAttribute("aria-expanded", "false"); }
function openCart() { closeMenu(); $(".cart-drawer").classList.add("open"); $(".cart-drawer").setAttribute("aria-hidden", "false"); $(".scrim").hidden = false; document.body.classList.add("locked"); $(".close-cart").focus(); }
function closeCart() { $(".cart-drawer").classList.remove("open"); $(".cart-drawer").setAttribute("aria-hidden", "true"); $(".scrim").hidden = true; document.body.classList.remove("locked"); }

function renderCart() {
  const n = cartCount();
  $(".cart-count").textContent = n;
  $(".cart-count").classList.toggle("empty", n === 0);
  $(".drawer-count").textContent = n ? `(${n})` : "";

  const total = cartTotal();
  const left = STORE.freeShippingAt - total;
  $(".ship-msg").innerHTML = left > 0
    ? `You're <strong>${money(left)}</strong> away from free shipping`
    : `<strong>You've unlocked free shipping.</strong>`;
  $(".ship-fill").style.width = `${Math.min(100, (total / STORE.freeShippingAt) * 100)}%`;
  $(".sub-amt").textContent = money(total);
  $(".checkout").classList.toggle("disabled", n === 0);

  $(".cart-lines").innerHTML = cart.length ? cart.map((l, i) => {
    const p = byId(l.id);
    return `<div class="line">
      <a class="line-img" href="product.html?id=${p.id}" style="--bg:${tint(p)}">${media(p)}</a>
      <div class="line-info">
        <a href="product.html?id=${p.id}" class="line-name">${esc(p.name)}</a>
        <span class="muted">${esc(p.color)} · ${l.size}</span>
        <div class="qty">
          <button data-q="${i}" data-d="-1" aria-label="Decrease quantity">−</button>
          <span>${l.qty}</span>
          <button data-q="${i}" data-d="1" aria-label="Increase quantity" ${l.qty >= (p.stock[l.size] ?? 0) ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="line-end">
        <strong>${money(p.price * l.qty)}</strong>
        <button class="link-btn" data-rm="${i}">Remove</button>
      </div>
    </div>`;
  }).join("") : `<div class="cart-empty"><p>Your cart is empty.</p><a class="btn btn-outline" href="shop.html">Shop the drop</a></div>`;

  $$(".cart-lines [data-q]").forEach((b) => b.addEventListener("click", () => {
    const l = cart[+b.dataset.q];
    l.qty += +b.dataset.d;
    if (l.qty <= 0) cart.splice(+b.dataset.q, 1);
    saveCart();
  }));
  $$(".cart-lines [data-rm]").forEach((b) => b.addEventListener("click", () => { cart.splice(+b.dataset.rm, 1); saveCart(); }));

  // "Complete the fit" upsell — cheapest in-stock item not already in the cart
  const inCart = new Set(cart.map((l) => l.id));
  const up = cart.length && PRODUCTS.filter((p) => !inCart.has(p.id) && !soldOut(p) && p.price <= 60).sort((a, b) => a.price - b.price)[0];
  $(".cart-upsell").innerHTML = up ? `
    <p class="eyebrow">Complete the fit</p>
    <a class="upsell" href="product.html?id=${up.id}">
      <span class="line-img" style="--bg:${tint(up)}">${media(up)}</span>
      <span><strong>${esc(up.name)}</strong><span class="muted">${esc(up.color)} · ${money(up.price)}</span></span>
      <span class="upsell-cta">View →</span>
    </a>` : "";
}

// ── modal content ────────────────────────────────────────────
const MODALS = {
  size: () => `<h2 id="modal-title">Size Guide</h2><p class="muted">${esc(SIZE_GUIDE.note)}</p>
    <table class="size-table">${SIZE_GUIDE.rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join("")}</tr>`).join("")}</table>`,
  shipping: () => `<h2 id="modal-title">Shipping</h2>
    <p>Orders ship within 1–3 business days. Free US shipping over ${money(STORE.freeShippingAt)}. International shipping available at checkout. You'll get a tracking link by email.</p>`,
  returns: () => `<h2 id="modal-title">Returns & Exchanges</h2>
    <p>Unworn items with tags can be returned or exchanged within 14 days of delivery. Final-sale items are marked on the product page.</p>`,
};

function openModal(kind) {
  $(".modal-body").innerHTML = (MODALS[kind] || MODALS.size)();
  $(".modal").hidden = false;
  document.body.classList.add("locked");
  $(".modal-close").focus();
}
function closeModal() { $(".modal").hidden = true; if (!$(".cart-drawer").classList.contains("open")) document.body.classList.remove("locked"); }

function toast(msg) {
  const t = $(".toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800);
}

function wireSignup(form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // Hook this up to Klaviyo / Mailchimp / Shopify Customer API.
    form.reset();
    toast("You're on the list. Watch your inbox before the next drop.");
  });
}

// ── product card ─────────────────────────────────────────────
function tint(p) {
  // light background behind each garment, chosen from how dark the garment is
  const h = p.hex.replace("#", "");
  const lum = (parseInt(h.slice(0, 2), 16) * 299 + parseInt(h.slice(2, 4), 16) * 587 + parseInt(h.slice(4, 6), 16) * 114) / 1000;
  return lum > 170 ? "#d9d5cc" : "#e9e6df";
}

function badge(p) {
  if (soldOut(p)) return `<span class="badge badge-out">Sold Out</span>`;
  if (lowStock(p)) return `<span class="badge badge-low">Almost Gone</span>`;
  if (p.tag) return `<span class="badge">${esc(p.tag)}</span>`;
  return "";
}

function card(p) {
  const sizes = Object.entries(p.stock);
  const variants = PRODUCTS.filter((q) => q.name === p.name);
  return `<article class="card ${soldOut(p) ? "is-out" : ""}">
    <div class="media-wrap">
    <a class="card-media" href="product.html?id=${p.id}" style="--bg:${tint(p)}" aria-label="${esc(p.name)}, ${esc(p.color)}">
      ${badge(p)}
      <span class="front">${media(p)}</span>
      <span class="back">${media(p, true)}</span>
    </a>
    ${soldOut(p) ? "" : `<div class="quick-add" aria-label="Quick add ${esc(p.name)}">
      <span>Quick add</span>
      <div>${sizes.map(([s, q]) => `<button data-add="${p.id}" data-size="${s}" ${q ? "" : "disabled"}>${s}</button>`).join("")}</div>
    </div>`}
    </div>
    <div class="card-info">
      <div>
        <a href="product.html?id=${p.id}" class="card-name">${esc(p.name)}</a>
        <span class="muted">${esc(p.color)}</span>
      </div>
      <strong>${money(p.price)}</strong>
    </div>
    ${variants.length > 1 ? `<div class="swatches">${variants.map((v) => `<a href="product.html?id=${v.id}" title="${esc(v.color)}" style="--c:${v.hex}" ${v.id === p.id ? 'aria-current="true"' : ""}></a>`).join("")}</div>` : ""}
  </article>`;
}

function wireQuickAdd(root) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]");
    if (b) addToCart(b.dataset.add, b.dataset.size);
  });
}

// ── pages ────────────────────────────────────────────────────
function initHome() {
  // countdown
  const el = $("#countdown");
  const target = new Date(STORE.nextDrop.date).getTime();
  $("#drop-name").textContent = STORE.nextDrop.name;
  const tick = () => {
    const d = target - Date.now();
    if (d <= 0) { el.innerHTML = `<span class="live">● LIVE NOW</span>`; return; }
    const parts = [Math.floor(d / 864e5), Math.floor(d / 36e5) % 24, Math.floor(d / 6e4) % 60, Math.floor(d / 1e3) % 60];
    el.innerHTML = parts.map((v, i) => `<div><b>${String(v).padStart(2, "0")}</b><small>${["Days", "Hrs", "Min", "Sec"][i]}</small></div>`).join("");
    setTimeout(tick, 1000);
  };
  tick();

  const grid = $("#drop-grid");
  grid.innerHTML = [...PRODUCTS].sort((a, b) => b.drop.localeCompare(a.drop) || soldOut(a) - soldOut(b)).slice(0, 8).map(card).join("");
  wireQuickAdd(grid);

  $("#cat-grid").innerHTML = CATEGORIES.map((c) => {
    const p = PRODUCTS.find((q) => q.category === c.id && !soldOut(q));
    return `<a class="cat" href="shop.html?cat=${c.id}" style="--bg:${tint(p)}">
      <span class="cat-art">${media(p)}</span>
      <span class="cat-label">${c.label} <span aria-hidden="true">→</span></span>
    </a>`;
  }).join("");

  $("#ig-grid").innerHTML = PRODUCTS.slice(0, 6).map((p, i) => `
    <a href="${STORE.instagram}" target="_blank" rel="noopener" style="--bg:${i % 2 ? "#141414" : tint(p)}" aria-label="View on Instagram">
      ${media(p, i % 2 === 1)}
      <span class="ig-hover">View on IG ↗</span>
    </a>`).join("");
}

function initShop() {
  const params = new URLSearchParams(location.search);
  const state = { cat: params.get("cat") || "all", size: "all", sort: "featured", drop: params.get("drop"), stock: false };
  const grid = $("#shop-grid");
  wireQuickAdd(grid);

  $("#cat-chips").innerHTML = [{ id: "all", label: "All" }, ...CATEGORIES]
    .map((c) => `<button class="chip" data-cat="${c.id}">${c.label}</button>`).join("");

  const render = () => {
    let list = PRODUCTS.filter((p) =>
      (state.cat === "all" || p.category === state.cat) &&
      (!state.drop || p.drop === state.drop) &&
      (state.size === "all" || (p.stock[state.size] ?? 0) > 0) &&
      (!state.stock || !soldOut(p)));
    if (state.sort === "low") list.sort((a, b) => a.price - b.price);
    if (state.sort === "high") list.sort((a, b) => b.price - a.price);
    if (state.sort === "new") list.sort((a, b) => b.drop.localeCompare(a.drop));
    if (state.sort === "featured") list.sort((a, b) => soldOut(a) - soldOut(b));

    const catLabel = CATEGORIES.find((c) => c.id === state.cat)?.label || (state.drop ? `Drop ${state.drop}` : "Shop All");
    $("#shop-title").textContent = catLabel;
    $("#result-count").textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
    grid.innerHTML = list.length ? list.map(card).join("") : `<p class="empty">Nothing matches those filters. <button class="link-btn" id="clear">Clear filters</button></p>`;
    $("#clear")?.addEventListener("click", () => { Object.assign(state, { cat: "all", size: "all", drop: null, stock: false }); $("#size-filter").value = "all"; $("#stock-filter").checked = false; render(); });
    $$("#cat-chips .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.cat === state.cat));
    const url = new URL(location);
    url.searchParams.delete("cat"); url.searchParams.delete("drop");
    if (state.cat !== "all") url.searchParams.set("cat", state.cat);
    if (state.drop) url.searchParams.set("drop", state.drop);
    history.replaceState(null, "", url);
  };

  $("#cat-chips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-cat]");
    if (c) { state.cat = c.dataset.cat; state.drop = null; render(); }
  });
  $("#size-filter").addEventListener("change", (e) => { state.size = e.target.value; render(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("#stock-filter").addEventListener("change", (e) => { state.stock = e.target.checked; render(); });
  render();
}

function initProduct() {
  const p = byId(new URLSearchParams(location.search).get("id")) || PRODUCTS[0];
  document.title = `${p.name} — ${p.color} | ${STORE.name}`;
  const variants = PRODUCTS.filter((q) => q.name === p.name);
  const sizes = Object.entries(p.stock);
  let size = null;

  $("#pdp").innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="shop.html">Shop</a> / <a href="shop.html?cat=${p.category}">${CATEGORIES.find((c) => c.id === p.category).label}</a></nav>
    <div class="pdp-grid">
      <div class="gallery">
        <div class="gal-main" style="--bg:${tint(p)}">${badge(p)}${media(p)}</div>
        <div class="gal-main" style="--bg:${tint(p)}">${media(p, true)}</div>
      </div>
      <div class="buybox">
        <p class="eyebrow">Drop ${p.drop}</p>
        <h1>${esc(p.name)}</h1>
        <p class="price">${money(p.price)}</p>
        <p class="pay-split muted">or 4 payments of ${money(p.price / 4)} at checkout</p>

        ${variants.length > 1 ? `<div class="opt"><span class="opt-label">Color — <b>${esc(p.color)}</b></span>
          <div class="swatches lg">${variants.map((v) => `<a href="product.html?id=${v.id}" title="${esc(v.color)}" style="--c:${v.hex}" ${v.id === p.id ? 'aria-current="true"' : ""}></a>`).join("")}</div></div>`
        : `<div class="opt"><span class="opt-label">Color — <b>${esc(p.color)}</b></span></div>`}

        <div class="opt">
          <div class="opt-row"><span class="opt-label">Size</span>${sizes.length > 1 ? `<button class="link-btn" data-modal="size">Size guide</button>` : ""}</div>
          <div class="sizes" role="radiogroup" aria-label="Size">
            ${sizes.map(([s, q]) => `<button role="radio" aria-checked="false" data-size="${s}" class="${q ? "" : "out"}">${s}</button>`).join("")}
          </div>
          <p class="stock-msg"></p>
        </div>

        <button class="btn btn-solid btn-block" id="add-btn">${soldOut(p) ? "Sold Out — Notify Me" : "Select a size"}</button>
        <form class="notify signup-form" hidden>
          <label for="notify-email">Get an email if this size comes back</label>
          <div class="field-row"><input id="notify-email" type="email" required placeholder="Email address"><button class="btn btn-outline" type="submit">Notify me</button></div>
        </form>

        <ul class="perks">
          <li>Free US shipping over ${money(STORE.freeShippingAt)}</li>
          <li>Ships in 1–3 business days</li>
          <li>14-day returns & exchanges</li>
        </ul>

        <details open><summary>Details</summary><p>${esc(p.desc)}</p></details>
        <details><summary>Fit</summary><p>${esc(SIZE_GUIDE.note)}</p></details>
        <details><summary>Shipping & Returns</summary><p>Orders ship within 1–3 business days with tracking. Unworn items with tags can be returned within 14 days.</p></details>
      </div>
    </div>
    <div class="sticky-atc" aria-hidden="true">
      <span><b>${esc(p.name)}</b><span class="muted">${money(p.price)}</span></span>
      <button class="btn btn-solid" id="sticky-add">${soldOut(p) ? "Sold Out" : "Add to cart"}</button>
    </div>`;

  const addBtn = $("#add-btn");
  const notify = $(".notify");
  const msg = $(".stock-msg");
  wireSignup(notify);

  const update = () => {
    if (soldOut(p)) { addBtn.disabled = false; return; }
    if (!size) { addBtn.textContent = "Select a size"; return; }
    const q = p.stock[size];
    notify.hidden = q > 0;
    addBtn.textContent = q ? `Add to cart — ${money(p.price)}` : "Size sold out";
    addBtn.disabled = !q;
    msg.textContent = q && q <= 3 ? `Only ${q} left in ${size}` : "";
  };

  $$(".sizes button").forEach((b) => b.addEventListener("click", () => {
    size = b.dataset.size;
    $$(".sizes button").forEach((x) => x.setAttribute("aria-checked", x === b));
    update();
  }));
  if (sizes.length === 1) $(".sizes button").click();

  const add = () => {
    if (soldOut(p)) { notify.hidden = false; $("#notify-email").focus(); return; }
    if (!size) { $(".sizes").classList.add("shake"); setTimeout(() => $(".sizes").classList.remove("shake"), 500); msg.textContent = "Pick a size first"; $(".sizes").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (p.stock[size]) addToCart(p.id, size);
  };
  addBtn.addEventListener("click", add);
  $("#sticky-add").addEventListener("click", add);

  // sticky add-to-cart bar appears once the main button scrolls out of view
  new IntersectionObserver(([e]) => $(".sticky-atc").classList.toggle("show", !e.isIntersecting && e.boundingClientRect.top < 0)).observe(addBtn);

  // recommendations: same drop first, then anything else in stock
  const recs = PRODUCTS.filter((q) => q.name !== p.name && !soldOut(q))
    .sort((a, b) => (b.category !== p.category) - (a.category !== p.category) || (b.drop === p.drop) - (a.drop === p.drop))
    .slice(0, 4);
  $("#recs").innerHTML = recs.map(card).join("");
  wireQuickAdd($("#recs"));
}

// ── boot ─────────────────────────────────────────────────────
renderChrome();
({ home: initHome, shop: initShop, product: initProduct })[document.body.dataset.page]?.();

// fade sections in as they scroll into view
const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.12 });
$$(".reveal").forEach((el) => io.observe(el));
