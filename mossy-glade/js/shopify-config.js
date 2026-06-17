// ============================================================
// SHOPIFY CONFIGURATION  —  the only file you edit to go live
// ------------------------------------------------------------
// 1. domain  → your store's myshopify.com domain
//      e.g. 'char-prints.myshopify.com'  (https:// and a trailing
//      slash are fine — they're stripped automatically)
// 2. variants → each card's VARIANT id (not the product id).
//      In Shopify admin: Products → (product) → scroll to Variants,
//      click the variant; the number at the end of the URL is the id.
//      Numeric ('44820...') or full gid
//      ('gid://shopify/ProductVariant/44820...') both work.
//
// Checkout builds a Shopify cart permalink:
//   https://{domain}/cart/{variantId}:{qty},{variantId}:{qty}?storefront=true
// which drops the visitor straight into your real Shopify checkout —
// no backend, no API key, inventory & taxes handled by Shopify.
//
// Keep the prices in js/main.js (PRODUCTS[].price) matching Shopify,
// since this permalink flow shows the site's own price until checkout.
// (For live price/inventory sync, see storefrontAccessToken below.)
// ============================================================

export const SHOPIFY = {
  domain: 'charlesa-designs.myshopify.com',
  storefrontAccessToken: '',

  variants: {
    argentina:  '43729762287750',
    botanical:  '44077629309062',
    horse:      '44077638582406',
    neworleans: '44077650739334'
  }
};

// normalize: tolerate 'https://store.myshopify.com/' etc.
function cleanDomain() {
  return String(SHOPIFY.domain || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

// live once a real domain and every variant id are filled in
export function isConfigured() {
  const d = cleanDomain();
  if (!d || d.startsWith('your-store')) return false;
  return Object.values(SHOPIFY.variants).every(v => v && !String(v).includes('REPLACE'));
}

// numeric variant id for a card key — accepts numeric or gid forms
export function variantId(key) {
  const v = SHOPIFY.variants[key];
  const m = v ? String(v).match(/(\d+)\s*$/) : null;
  return m ? m[1] : null;
}

// items: [{ variantKey: 'argentina', qty: 2 }, ...]
// → a Shopify cart permalink, or null if not configured / nothing resolvable
export function checkoutUrl(items) {
  if (!isConfigured()) return null;
  const parts = (items || [])
    .filter(it => it && it.qty > 0)
    .map(it => {
      const id = variantId(it.variantKey);
      return id ? `${id}:${Math.max(1, Math.floor(it.qty))}` : null;
    })
    .filter(Boolean);
  if (!parts.length) return null;
  return `https://${cleanDomain()}/cart/${parts.join(',')}?storefront=true`;
}
