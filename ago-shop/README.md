# AGO — storefront redesign

A redesigned store for [@ago.shop_](https://www.instagram.com/ago.shop_). Plain HTML, CSS and JavaScript, so there's no build step.

## Run it

```bash
cd ago-shop
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Pages

| Page | What's on it |
|---|---|
| `index.html` | Rotating announcement bar, hero with drop countdown, ticker, latest drop grid, lookbook, category tiles, "The List" early-access signup, Instagram grid |
| `shop.html` | Category chips, size filter, in-stock toggle, sort. Filters are saved in the URL (`?cat=tees`, `?drop=004`) |
| `product.html?id=…` | Front/back gallery, color swatches, size picker with stock, size guide, "only X left", notify-me for sold-out sizes, details accordions, sticky add-to-cart on phones, "Complete the fit" suggestions |

On every page there's a cart drawer with a free-shipping progress bar, quantity controls and an add-on suggestion. The cart is saved in the browser.

## What came from where

| Feature | Inspired by |
|---|---|
| Drop countdown, "The List" early access, no restocks | Corteiz, Sp5der |
| Clean grid, front/back hover, quick-add sizes | Represent, Fear of God Essentials |
| Huge type, scrolling ticker, rotating announcement bar | Broken Planet, Trapstar |
| Cart drawer + free-shipping bar, sticky mobile add-to-cart, "Almost gone" badges | Most top Shopify streetwear stores |

## Making it real

Everything you need to change is in **`js/data.js`**:

- **Products:** names, prices, colors, stock per size, descriptions.
- **Photos:** drop photos in `images/` and add `image: "images/x.jpg"` and `imageBack: "images/x-back.jpg"` to a product. Until then, the site draws placeholder garments.
- **Drop:** the countdown name and date in `STORE.nextDrop`.
- **Checkout:** set `STORE.checkoutUrl`. To actually take payments, connect it to Shopify (Storefront API / Buy Button) or Stripe Checkout.
- **Email list:** forms show a success message but don't save anything yet. Connect them to Klaviyo or Mailchimp in `wireSignup()` in `js/app.js`.
- **Colors and fonts:** the variables at the top of `css/styles.css`.
