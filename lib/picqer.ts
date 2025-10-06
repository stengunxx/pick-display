const BASE = process.env.PICQER_API_URL!;       // bv. https://.../api/v1
const KEY  = process.env.PICQER_API_KEY!;

function authHeaders(): Record<string,string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: 'Basic ' + Buffer.from(KEY + ':').toString('base64'),
  };
}

export async function picqerGet<T=any>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Picqer ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export async function fetchProductByCode(code: string): Promise<any | null> {
  if (!code) return null;
  try {
    return await picqerGet(`/products/${encodeURIComponent(code)}`);
  } catch {}
  try {
    const j: any = await picqerGet(`/products?productcode=${encodeURIComponent(code)}`);
    if (Array.isArray(j) && j.length) return j[0];
    if (Array.isArray(j?.data) && j.data.length) return j.data[0];
  } catch {}
  return null;
}

export function extractImageUrl(p: any): string {
  if (!p) return "";
  const cands = [
    p.image, p.imageUrl, p.image_url, p.imageURL,
    p.foto, p.afbeelding, p.product_image, p.productImage,
    p.thumbnail, p.thumb, p.thumbUrl, p.thumb_url,
    p.productimage, p.product_image_url, p.image_path, p.image_small, p.image_large,
    p.image?.url, p.image?.src, p.main_image?.url, p.mainImage?.url,
    p.primary_image?.url, p.primaryImage?.url,
    Array.isArray(p.images) ? (p.images[0]?.url ?? p.images[0]?.src ?? p.images[0]) : undefined,
    Array.isArray(p.media)  ? (p.media[0]?.url  ?? p.media[0]?.src  ?? p.media[0])  : undefined,
    Array.isArray(p.assets) ? (p.assets[0]?.url ?? p.assets[0]) : undefined,
    Array.isArray(p.gallery)? (p.gallery[0]?.url ?? p.gallery[0]) : undefined,
  ].filter(Boolean);
  const url = String(cands[0] || "");
  if (!url) return "";
  if (typeof location !== "undefined" && location.protocol === "https:" && url.startsWith("http:")) {
    return url.replace(/^http:/, "https:");
  }
  if (url.startsWith("//")) {
    return (typeof location !== "undefined" ? location.protocol : "https:") + url;
  }
  return url;
}

type CacheVal = { url: string; exp: number };
const imageCache = new Map<string, CacheVal>();
const TTL = 15 * 60 * 1000;

export async function getProductImageUrlByCode(code: string): Promise<string> {
  const now = Date.now();
  const hit = imageCache.get(code);
  if (hit && hit.exp > now) return hit.url;
  const product = await fetchProductByCode(code);
  const url = extractImageUrl(product) || "";
  imageCache.set(code, { url, exp: now + TTL });
  return url;
}
