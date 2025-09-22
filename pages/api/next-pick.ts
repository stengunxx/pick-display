// Next.js API route to securely call Picqer API
export default async function handler(req, res) {
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
        picklistsRes = await fetch(`${process.env.PICQER_API_URL}/picklists/batches/${batchId}`, { headers });
      } catch (err) {
        console.error('Picklists fetch failed:', err);
        return res.status(502).json({ error: 'Picklists ophalen mislukt (fetch error)', details: String(err) });
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
    // Picqer kan 'new' of 'open' gebruiken voor open picklists
    const openPicklist = picklists.find(p => p.status === 'open' || p.status === 'new');
    if (!openPicklist) {
      return res.status(404).json({ error: 'Geen open picklists', picklists });
    }

    if (!openPicklist?.idpicklist) {
      console.error('Geen geldige openPicklist.idpicklist gevonden:', { batchId, picklists, openPicklist });
      return res.status(400).json({ error: 'Geen geldige picklist gevonden', batchId, picklists, openPicklist });
    }
  // Zorg dat base-URL altijd eindigt op een slash
  const apiUrl = process.env.PICQER_API_URL || '';
  const baseUrl = apiUrl.endsWith('/') ? apiUrl : apiUrl + '/';
    // Probeer eerst /products/ met slash
    let items;
    let itemsRes = await fetch(`${baseUrl}picklists/${openPicklist.idpicklist}/products/`, { headers });
    if (itemsRes.ok) {
      try { items = await itemsRes.json(); } catch (e) {
        items = undefined;
      }
    }
    // Fallback: als geen array of 404, haal producten uit picklist zelf
    if (!Array.isArray(items)) {
      const picklistUrl = `${baseUrl}picklists/${openPicklist.idpicklist}`;
      const picklistRes = await fetch(picklistUrl, { headers });
      if (picklistRes.ok) {
        let picklistJson;
        try { picklistJson = await picklistRes.json(); } catch (e) {
          return res.status(500).json({ error: 'Picklist JSON parse error', details: String(e) });
        }
        if (Array.isArray(picklistJson.products)) {
          items = picklistJson.products;
        } else {
          return res.status(500).json({ error: 'Geen producten gevonden in picklist', details: picklistJson });
        }
      } else {
        const txt = await picklistRes.text();
        return res.status(502).json({ error: 'Picklist ophalen mislukt', status: picklistRes.status, body: txt, url: picklistUrl });
      }
    }

      // Toon pas het volgende product als alles van het huidige is gepickt
      const nextItem = items.find((item: any) => {
        const picked = item.amountpicked ?? item.amount_picked ?? 0;
        const total = item.amount ?? 0;
        return !item.picked && picked < total;
      });
      if (!nextItem) {
        // Geef fallback response zodat frontend niet crasht
        return res.json({
          location: '',
          product: '',
          debug: { picklistId: openPicklist.idpicklist, itemId: null },
          items
        });
      }

      return res.json({
        location: nextItem.stocklocation || nextItem.stock_location || '',
        product: nextItem.name || nextItem.productname || '',
        debug: { picklistId: openPicklist.idpicklist, itemId: nextItem.idpicklist_product },
        items
      });
  } catch (error) {
    console.error('next-pick error:', error);
    return res.status(500).json({ error: 'Interne serverfout', details: String(error) });
  }
}
