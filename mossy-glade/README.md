# The Mossy Glade

An immersive 3D ecommerce experience built with Three.js / WebGL. Four fine-art
print cards rest in a mossy glade beside a flowing stream — one drifts on the
water itself. Touch a card and it lifts from the moss and floats before you;
drag to spin and flip it; add it to your cart; check out through Shopify.

## Run locally

```bash
node serve.js
# → http://localhost:4173
```

(Any static server works — the site is plain HTML/JS modules, no build step.)

## Files

- `index.html` — UI shell: intro, product panel, cart drawer, HUD
- `js/main.js` — the whole scene: terrain, moss grass, stream, waterfall,
  cards, interaction, procedural water audio, cart logic
- `js/shopify-config.js` — **your Shopify wiring lives here**
- `assets/cards/` — web-sized card art (front of each print + shared back)

## Going live with Shopify

1. Open `js/shopify-config.js`.
2. Set `domain` to your store's `*.myshopify.com` domain.
3. For each of the four products, paste its **variant ID** (numeric, or the
   full `gid://shopify/ProductVariant/…` string — both work):
   - `argentina` — Argentina, Bougainvillea & Mountains
   - `botanical` — Chicago, Botanical Garden
   - `horse` — Chicago, Paint Horse at Dusk
   - `neworleans` — New Orleans, Live Oak at Sunset
4. That's it. Checkout builds a Shopify cart permalink
   (`https://your-store.myshopify.com/cart/VARIANT:QTY,…`) which drops the
   visitor straight into your real Shopify checkout. No API keys needed.

Until configured, the cart runs in demo mode and says so beneath the
checkout button.

### Finding a variant ID

In Shopify admin → Products → (product) → Variants: the number at the end of
the variant's URL is the ID. Or via the API, use the
`gid://shopify/ProductVariant/123…` value directly.

## Tuning the vibe

- Prices / copy / card art: `PRODUCTS` array at the top of `js/main.js`
- Which card floats on the stream: the `floats: true` flag in `PRODUCTS`
- Water level, fog, sun: constants near the top of `js/main.js`
- Ambience mix (waterfall / babble / trickle): the `audio` section in `js/main.js`

## Console hooks

`window.__glade` exposes `focus(key)`, `unfocus()`, `flip()`,
`addToCart(key)`, and `cart()` for testing and future integrations.
