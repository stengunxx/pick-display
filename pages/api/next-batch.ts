import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

const OPEN_STATUSES = ['open', 'processing', 'inprogress', 'active', 'started'];

function withTimeout(p: Promise<any>, ms: number, label = 'fetch') {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const baseRaw = process.env.PICQER_API_URL ?? '';
  const base = baseRaw.replace(/\/+$/, ''); // strip trailing slash
  const key  = process.env.PICQER_API_KEY ?? '';

  if (!base || !key) {
    return res.status(500).json({
      step: 'env',
      error: 'PICQER_API_URL of PICQER_API_KEY ontbreekt/leeg',
      PICQER_API_URL: baseRaw,
      PICQER_API_KEY_set: !!key,
      hint: 'PICQER_API_URL moet lijken op https://<tenant>.picqer.com/api/v1 (zonder trailing slash)',
    });
  }

  const headers = {
    Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const attempts = [];

  try {
    // 1) Outbound check — faalt dit, dan is je runtime/netwerk stuk
    try {
      const ping = await withTimeout(fetch('https://httpbin.org/get'), 4000, 'httpbin');
      attempts.push({ step: 'httpbin', status: (ping as Response).status });
    } catch (e) {
      // Outbound faalt: geef een geldige lege batch terug zodat frontend niet blokkeert
      return res.json({ batchId: null, error: 'Outbound netwerk faalt', attempts });
    }

    // 2) Probeer beide bekende endpoints
    const candidates = [base + '/picklists/batches'];
    let batches = null;

    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      try {
        const r = await withTimeout(fetch(url, { headers }), 8000, 'GET ' + url) as Response;
        const txt = await r.text();
        if (!r.ok) {
          attempts.push({ url: url, status: r.status, body: txt.slice(0, 300) });
          continue;
        }
        let json: any;
        try { json = JSON.parse(txt); }
        catch (e) {
          attempts.push({ url: url, status: r.status, parseError: String(e), body: txt.slice(0, 300) });
          continue;
        }
        if (Array.isArray(json)) {
          batches = json;
          attempts.push({ url: url, status: r.status, ok: true, length: json.length, shape: 'array' });
          break;
        }
        if (json && Array.isArray(json.data)) {
          batches = json.data;
          attempts.push({ url: url, status: r.status, ok: true, length: json.data.length, shape: 'data[]' });
          break;
        }
        attempts.push({ url: url, status: r.status, note: 'unexpected shape', keys: Object.keys(json || {}) });
      } catch (e) {
        attempts.push({ url: url, error: String(e) });
      }
    }

    if (!batches) {
      console.log('attempts:', attempts);
      return res.status(502).json({
        step: 'list-batches',
        error: 'Kon geen lijst met batches ophalen van Picqer',
        attempts: attempts,
        hint: 'Controleer of jouw tenant picklist-batches of pickbatches gebruikt en of de API key toegang heeft.',
      });
    }

    const open = (batches as any[]).filter((b: any) => OPEN_STATUSES.indexOf(String(b && b.status || '').toLowerCase()) !== -1);

    if (open.length === 0) {
      return res.status(404).json({
        step: 'filter-open',
        error: 'Geen open pickbatch bij Picqer',
        attempts: attempts,
        sample: (batches as any[]).slice(0, 3),
        hint: 'Check welke statuswaarden jouw tenant gebruikt; voeg ze eventueel toe aan OPEN_STATUSES.',
      });
    }

    open.sort(function(a, b) {
      const ta = Date.parse(a.created_at || a.created || '') || 0;
      const tb = Date.parse(b.created_at || b.created || '') || 0;
      if (ta !== tb) return ta - tb;
      const ia = Number(a.id || a.idpicklist_batch || Number.MAX_SAFE_INTEGER);
      const ib = Number(b.id || b.idpicklist_batch || Number.MAX_SAFE_INTEGER);
      return ia - ib;
    });

    const top = open.slice(0, 2);
    const ids = top
      .map(x => Number(x.id || x.idpicklist_batch))
      .filter(n => Number.isFinite(n));

    if (ids.length === 0) {
      return res.status(500).json({ step: 'extract-id', error: 'Geen geldige batch IDs', first: open[0] });
    }

    return res.status(200).json({
      step: 'ok',
      batchId: ids[0],
      batchIds: ids,
      debug: { chosen_statuses: top.map(t => t.status), attempts: attempts },
    });
  } catch (err) {
    console.error('next-batch fatal:', err);
    return res.status(500).json({
      step: 'fatal',
      error: (err && (err as any).message) || String(err),
      attempts: attempts,
    });
  }
}
