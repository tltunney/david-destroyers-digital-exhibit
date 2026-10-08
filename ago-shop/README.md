# AGO — storefront redesign

A redesigned store for [@ago.shop_](https://www.instagram.com/ago.shop_). Plain HTML, CSS and JavaScript, so there's no build step.

The look keeps AGO's own theme: hero / comic-book pieces like the **Spider-Man × Superman Reversible Zip-Up (AGO × Aviance)** and the **Spidey beanies**. It uses Spider-Man red, Superman blue and gold, comic-panel outlines, halftone dots and web prints. Reversible pieces get a "Flip" button that shows the other side.

## Run it

```bash
cd ago-shop
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Pages

| Page | What's on it |
|---|---|
| `index.html` | Rotating announcement bar, split red/blue hero for the reversible zip-up, next-release countdown, ticker, latest releases, interactive "Flip it" section, category tiles, restock-alert signup, Instagram / TikTok grid |
| `shop.html` | Category chips, size filter, in-stock toggle, sort. Filters are saved in the URL (`?cat=tees`, `?drop=004`) |
| `product.html?id=…` | Both sides of reversible pieces (or front/back), color swatches, size picker with stock, size guide, "only X left", notify-me for sold-out sizes, details accordions, sticky add-to-cart on phones, "Complete the fit" suggestions |

On every page there's a cart drawer with a free-shipping progress bar, quantity controls and an add-on suggestion. The cart is saved in the browser.

## What came from where

| Feature | Inspired by |
|---|---|
| Release countdown, "The List" for restock alerts | Corteiz, Sp5der |
| Clean grid, front/back hover, quick-add sizes | Represent, Fear of God Essentials |
| Huge type, scrolling ticker, rotating announcement bar | Broken Planet, Trapstar |
| Cart drawer + free-shipping bar, sticky mobile add-to-cart, "Almost gone" badges | Most top Shopify streetwear stores |

## Making it real

Everything you need to change is in **`js/data.js`**:

- **Products:** names, prices, stock per size, descriptions. Each product's `sides` set the colors and print (`web`, `star` or `plain`) for the placeholder drawings. The zip-up and Spidey beanies come from AGO's posts. **Prices, stock and the other products are placeholders.**
- **Photos:** drop photos in `images/` and add `image: "images/x.jpg"` and `imageBack: "images/x-back.jpg"` to a product. For reversibles, `imageBack` is the other side. Until then, the site draws placeholder garments.
- **Next release:** the countdown name and date in `STORE.nextDrop`.
- **Checkout:** set `STORE.checkoutUrl`. To actually take payments, connect it to Shopify (Storefront API / Buy Button) or Stripe Checkout.
- **Email list:** forms show a success message but don't save anything yet. Connect them to Klaviyo or Mailchimp in `wireSignup()` in `js/app.js`.
- **Colors and fonts:** the variables at the top of `css/styles.css`.
