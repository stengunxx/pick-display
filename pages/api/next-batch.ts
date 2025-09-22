const OPEN_STATUSES = ['open', 'processing', 'inprogress', 'active', 'started'];

function withTimeout(p, ms, label = 'fetch') {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

export default async function handler(req, res) {
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
      attempts.push({ step: 'httpbin', status: ping.status });
    } catch (e) {
      return res.status(502).json({
        step: 'httpbin',
        error: 'Outbound netwerk faalt of wordt geblokkeerd',
        detail: String(e),
      });
    }

    // 2) Probeer beide bekende endpoints
    const candidates = [base + '/picklists/batches'];
    let batches = null;

    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      try {
        const r   = await withTimeout(fetch(url, { headers }), 8000, 'GET ' + url);
        const txt = await r.text();
        if (!r.ok) {
          attempts.push({ url: url, status: r.status, body: txt.slice(0, 300) });
          continue;
        }
        let json;
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
        if (Array.isArray(json && json.data)) {
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

    const open = batches.filter(function(b) {
      return OPEN_STATUSES.indexOf(String(b && b.status || '').toLowerCase()) !== -1;
    });

    if (open.length === 0) {
      return res.status(404).json({
        step: 'filter-open',
        error: 'Geen open pickbatch bij Picqer',
        attempts: attempts,
        sample: batches.slice(0, 3),
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

    const first   = open[0];
    const batchId = Number(first.id || first.idpicklist_batch);
    if (!Number.isFinite(batchId)) {
      return res.status(500).json({
        step: 'extract-id',
        error: 'Batch ID ontbreekt in response',
        first: first,
      });
    }

    return res.status(200).json({
      step: 'ok',
      batchId: batchId,
      debug: { chosen_status: first.status, attempts: attempts },
    });
  } catch (err) {
    console.error('next-batch fatal:', err);
    return res.status(500).json({
      step: 'fatal',
      error: err && err.message || String(err),
      attempts: attempts,
    });
  }
}
