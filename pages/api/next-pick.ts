// Simpele in-memory cache per batchId (max 1 minuut)
const pickCache: Record<string, { data: any, ts: number }> = {};
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

// Next.js API route to securely call Picqer API
async function fetchWithTimeout(resource: string, options: any = {}, timeout: number = 3000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Helper: cache opslaan
  function cacheSet(batchId: string, data: any) {
    pickCache[batchId] = { data, ts: Date.now() };
  }
  // Helper: cache ophalen
  function cacheGet(batchId: string) {
    const entry = pickCache[batchId];
    if (entry && Date.now() - entry.ts < 60000 && entry.data && Object.keys(entry.data).length > 0) {
      return entry.data;
    }
    return null;
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const headers = {
    Authorization: `Basic ${Buffer.from(process.env.PICQER_API_KEY + ':').toString('base64')}`,
    'Content-Type': 'application/json',
  };

  try {
    const batchId = req.query.batchId;
    if (!batchId) {
      return res.status(400).json({ error: 'batchId ontbreekt in request' });
    }

      let picklistsRes;
      try {
        picklistsRes = await fetchWithTimeout(`${process.env.PICQER_API_URL}/picklists/batches/${batchId}`, { headers }, 1000);
      } catch (err) {
        console.error('Picklists fetch failed:', err);
        // Geef cached data terug als die er is
        const cached = cacheGet(String(batchId));
        if (cached) {
          cached.error = 'timeout';
          return res.json(cached);
        }
        // Anders geldige lege response
        return res.json({ location: '', product: '', items: [], nextLocations: [], debug: { picklistId: null, itemId: null }, error: 'timeout' });
      }
      if (!picklistsRes.ok) {
        const txt = await picklistsRes.text();
        console.error('Picklists ophalen mislukt:', { url: `${process.env.PICQER_API_URL}/picklists/batches/${batchId}`, status: picklistsRes.status, body: txt });
        return res.status(502).json({ error: 'Picklists ophalen mislukt', status: picklistsRes.status, body: txt });
      }
      let picklistsJson;
      try { picklistsJson = await picklistsRes.json(); } catch (e) {
        return res.status(500).json({ error: 'Picklists JSON parse error', details: String(e) });
      }
      const { picklists } = picklistsJson;
      if (!Array.isArray(picklists)) {
        return res.status(500).json({ error: 'API antwoord is geen array', details: picklists });
      }
    // Loop over alle open picklists in de batch tot er een te picken item is
    let found = false;
    for (const picklist of picklists.filter(p => p.status === 'open' || p.status === 'new')) {
      if (!picklist?.idpicklist) continue;
      const apiUrl = process.env.PICQER_API_URL || '';
      const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
      let items;
      let itemsRes;
      try {
        itemsRes = await fetchWithTimeout(`${baseUrl}picklists/${picklist.idpicklist}/products/`, { headers }, 1000);
      } catch (err) {
        itemsRes = { ok: false };
      }
      if ((itemsRes as Response).ok && typeof (itemsRes as Response).json === 'function') {
        try { items = await (itemsRes as Response).json(); } catch (e) { items = undefined; }
      }
      if (!Array.isArray(items)) {
        const picklistUrl = `${baseUrl}picklists/${picklist.idpicklist}`;
        let picklistRes;
        try {
          picklistRes = await fetchWithTimeout(picklistUrl, { headers }, 1000);
        } catch (err) {
          picklistRes = { ok: false };
        }
        if ((picklistRes as Response).ok && typeof (picklistRes as Response).json === 'function') {
          let picklistJson;
          try { picklistJson = await (picklistRes as Response).json(); } catch (e) { continue; }
          if (Array.isArray(picklistJson.products)) {
            items = picklistJson.products;
          } else { continue; }
        } else { continue; }
      }
      const nextItem = items.find((item: any) => {
        const picked = item.amountpicked ?? item.amount_picked ?? 0;
        const total = item.amount ?? 0;
        return !item.picked && picked < total;
      });
      if (nextItem) {
        found = true;
        // Bereken alle volgende locaties die nog niet gepickt zijn
        const nextLocations = items
          .filter((item: any) => !item.picked && ((item.amountpicked ?? item.amount_picked ?? 0) < (item.amount ?? 0)))
          .map((item: any) => item.stocklocation || item.stock_location || '')
          .filter((loc: string) => loc && loc !== (nextItem.stocklocation || nextItem.stock_location || ''));
        const responseData = {
          location: nextItem.stocklocation || nextItem.stock_location || '',
          product: nextItem.name || nextItem.productname || '',
          debug: { picklistId: picklist.idpicklist, itemId: nextItem.idpicklist_product },
          items,
          nextLocations
        };
        cacheSet(String(batchId), responseData);
        return res.json(responseData);
      }
    }
    // Geen open picklists met te picken items meer: batch is klaar
  const doneData = { done: true };
  cacheSet(String(batchId), doneData);
  return res.json(doneData);
  } catch (error) {
    console.error('next-pick error:', error);
    return res.status(500).json({ error: 'Interne serverfout', details: String(error) });
  }
}
