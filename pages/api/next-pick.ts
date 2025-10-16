// pages/api/next-pick.ts
import { getProductImageUrlByCode } from "../../lib/picqer";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

/** cache alleen LAATST-GOED (geen done) per batchId */
const pickCache: Record<string, { data: any; ts: number }> = {};
const TTL = 60_000;

const cacheGet = (bid: string) => {
  const e = pickCache[bid];
  if (!e) return null;
  if (Date.now() - e.ts > TTL) return null;
  if (e.data?.done) return null;      // done nooit gebruiken
  return e.data;
};
const cacheSet = (bid: string, data: any) => {
  if (!data?.done) pickCache[bid] = { data, ts: Date.now() }; // done nooit cachen
};

async function fetchWithTimeout(resource: string, options: any = {}, timeout = 1500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 1200);   // snellere timeout
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

const amtTotal  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);
const amtPicked = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);

// ❗ Belangrijke fix: maak "heeft werk" puur kwantitatief; negeer de `picked`-flag
const hasWork   = (it: any) => amtPicked(it) < amtTotal(it);

// Statusen die NIET echt klaar zijn
const OPEN_STATUSES = new Set(["open","new","processing","inprogress","active","started"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const apiBase = (process.env.PICQER_API_URL || "").replace(/\/+$/, "") + "/";
  const headers = {
    Authorization: `Basic ${Buffer.from((process.env.PICQER_API_KEY || "") + ":").toString("base64")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const batchId = String(req.query.batchId || "");
    if (!batchId) return res.status(400).json({ error: "batchId ontbreekt in request" });

    // 1) picklists in de batch
    let picklistsResp: any;
    try {
      const r = await fetchWithTimeout(`${apiBase}picklists/batches/${batchId}`, { headers }, 1800);
      if (!r.ok) {
        const txt = await r.text();
        return res.status(502).json({ error: "Picklists ophalen mislukt", status: r.status, body: txt });
      }
      picklistsResp = await r.json().catch(() => ({}));
    } catch {
      // timeout / netwerk → val terug op laatst-goed, nooit "done"
      const cached = cacheGet(batchId);
      if (cached) return res.status(200).json({ ...cached, error: "timeout" });
      return res.status(200).json({ pending: true }); // frontend blijft actief poll’en
    }

    const picklists = Array.isArray(picklistsResp?.picklists) ? picklistsResp.picklists : [];
    const candidates = picklists.filter((p: any) => OPEN_STATUSES.has(String(p?.status || "").toLowerCase()));

    // Geen open picklists → echt klaar
    if (!candidates.length) return res.status(200).json({ done: true });

    // 2) loop alle open picklists, kies de EERSTE met werk
    let sawItems = false;
    for (const pl of candidates) {
      const idpicklist = pl?.idpicklist;
      if (!idpicklist) continue;

      let items: any[] | null = null;

      // Probeer /products, anders /picklists/:id
      try {
        const r = await fetchWithTimeout(`${apiBase}picklists/${idpicklist}/products/`, { headers }, 1800);
        if (r.ok) items = await r.json().catch(() => null);
      } catch {}
      if (!Array.isArray(items)) {
        try {
          const r = await fetchWithTimeout(`${apiBase}picklists/${idpicklist}`, { headers }, 1800);
          if (r.ok) {
            const j = await r.json().catch(() => ({}));
            if (Array.isArray(j?.products)) items = j.products;
          }
        } catch {}
      }
      if (!Array.isArray(items)) continue;
      sawItems = true;

      // Afbeeldingen best-effort verrijken
      const enriched = await Promise.all(items.map(async (it: any) => {
        const have = it.image || it.imageUrl || it.image_url || it.product?.image || (Array.isArray(it.images) && it.images[0]);
        if (have) return it;
        const code = it.productcode ?? it.sku ?? it.product?.sku ?? "";
        if (!code) return it;
        try {
          const img = await getProductImageUrlByCode(String(code));
          return { ...it, image: img };
        } catch { return it; }
      }));

      // Zoek het eerstvolgende item met werk (op basis van hoeveelheden)
      const nextItem = enriched.find(hasWork);
      if (nextItem) {
        const nextLocations = enriched
          .filter(hasWork)
          .map((it: any) => it.stocklocation || it.stock_location || "")
          .filter((loc: string, i, a) => loc && a.indexOf(loc) === i);

        const payload = {
          location: nextItem.stocklocation || nextItem.stock_location || "",
          product: nextItem.name || nextItem.productname || "",
          debug: { picklistId: idpicklist, itemId: nextItem.idpicklist_product },
          items: enriched,
          nextLocations,
        };
        cacheSet(batchId, payload);    // alleen non-done cachen
        return res.status(200).json(payload);
      }
      // geen werk in deze picklist → door naar de volgende
    }

    // We zagen items, maar geen werk in alle open picklists → batch klaar
    if (sawItems) return res.status(200).json({ done: true });

    // We kregen niets bruikbaars (bv. rate limit): val terug
    const cached = cacheGet(batchId);
    if (cached) return res.status(200).json({ ...cached, error: "fallback-cache" });

    // Laat UI weten dat het tijdelijk pending is
    return res.status(200).json({ pending: true });
  } catch (e) {
    const cached = cacheGet(String(req.query.batchId || ""));
    if (cached) return res.status(200).json({ ...cached, error: "server-error" });
    return res.status(500).json({ error: "Interne serverfout", details: String(e) });
  }
}
