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

function cleanDomain() {
  return String(SHOPIFY.domain || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

export function isConfigured() {
  const d = cleanDomain();
  if (!d || d.startsWith('your-store')) return false;
  return Object.values(SHOPIFY.variants).every(v => v && !String(v).includes('REPLACE'));
}

export function variantId(key) {
  const v = SHOPIFY.variants[key];
  const m = v ? String(v).match(/(\d+)\s*$/) : null;
  return m ? m[1] : null;
}

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

export async function buildCheckoutUrl(items) {
  if (!isConfigured()) return null;
  const filtered = (items || []).filter(it => it && it.qty > 0);
  if (!filtered.length) return null;

  if (SHOPIFY.storefrontAccessToken) {
    try {
      const lines = filtered.map(it => {
        const id = variantId(it.variantKey);
        return id ? { merchandiseId: `gid://shopify/ProductVariant/${id}`, quantity: Math.max(1, Math.floor(it.qty)) } : null;
      }).filter(Boolean);

      const res = await fetch(`https://${cleanDomain()}/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': SHOPIFY.storefrontAccessToken,
        },
        body: JSON.stringify({
          query: `mutation cartCreate($input: CartInput!) {
            cartCreate(input: $input) {
              cart { checkoutUrl }
              userErrors { field message }
            }
          }`,
          variables: { input: { lines } }
        })
      });
      const json = await res.json();
      const url = json?.data?.cartCreate?.cart?.checkoutUrl;
      if (url) return url;
    } catch (err) {
      console.warn('[Mossy Glade] Storefront API cartCreate failed, falling back:', err);
    }
  }

  return checkoutUrl(items);
}
