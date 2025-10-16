// pages/api/next-batch.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

const OPEN_STATUSES = ["open", "processing", "inprogress", "active", "started"];

function withTimeout<T>(p: Promise<T>, ms: number, label = "fetch"): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const baseRaw = process.env.PICQER_API_URL ?? "";
  const base = baseRaw.replace(/\/+$/, ""); // strip trailing slash
  const key = process.env.PICQER_API_KEY ?? "";

  if (!base || !key) {
    // Altijd 200: front-end mag niet breken op statuscodes
    return res.status(200).json({
      step: "env-missing",
      batchId: null,
      batchIds: [],
      batches: [],
      error: "PICQER_API_URL of PICQER_API_KEY ontbreekt/leeg",
      PICQER_API_URL: baseRaw,
      PICQER_API_KEY_set: !!key,
      hint: "PICQER_API_URL moet lijken op https://<tenant>.picqer.com/api/v1 (zonder trailing slash)",
    });
  }

  const headers = {
    Authorization: "Basic " + Buffer.from(key + ":").toString("base64"),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const attempts: any[] = [];

  try {
    // 1) Haal batches op (altijd 200 teruggeven)
    const url = base + "/picklists/batches";
    let batches: any[] | null = null;

    try {
      const r = (await withTimeout(fetch(url, { headers }), 1200, "GET " + url)) as Response;
      const txt = await r.text();
      let json: any = null;
      try {
        json = txt ? JSON.parse(txt) : null;
      } catch (e) {
        attempts.push({ url, status: r.status, parseError: String(e), body: txt.slice(0, 300) });
      }

      if (Array.isArray(json)) {
        batches = json;
        attempts.push({ url, ok: true, length: json.length, shape: "array" });
      } else if (json && Array.isArray(json.data)) {
        batches = json.data;
        attempts.push({ url, ok: true, length: json.data.length, shape: "data[]" });
      } else {
        attempts.push({ url, status: r.status, note: "unexpected shape", keys: Object.keys(json || {}) });
      }
    } catch (e) {
      attempts.push({ url, error: String(e) });
    }

    if (!batches) {
      // Geen data kunnen lezen → geef lege, maar geldige respons terug
      return res.status(200).json({
        step: "no-batches",
        batchId: null,
        batchIds: [],
        batches: [],
        error: "Kon geen lijst met batches ophalen van Picqer",
        attempts,
        hint: "Controleer API-toegang of netwerk",
      });
    }

    // Filter op open statussen
    const open = (batches as any[]).filter(
      (b: any) => OPEN_STATUSES.indexOf(String((b && b.status) || "").toLowerCase()) !== -1
    );

    // *** Belangrijk: ALTIJD 200 teruggeven, ook bij 'geen open batches' ***
    if (open.length === 0) {
      return res.status(200).json({
        step: "filter-open",
        batchId: null,
        batchIds: [],
        batches: [],
        ok: true,
        attempts,
      });
    }

    // Sorteer oudste eerst (creatiedatum, dan id)
    open.sort(function (a, b) {
      const ta = Date.parse(a.created_at || a.created || "") || 0;
      const tb = Date.parse(b.created_at || b.created || "") || 0;
      if (ta !== tb) return ta - tb;
      const ia = Number(a.id || a.idpicklist_batch || Number.MAX_SAFE_INTEGER);
      const ib = Number(b.id || b.idpicklist_batch || Number.MAX_SAFE_INTEGER);
      return ia - ib;
    });

    const top = open.slice(0, 2);
    const batchMeta = top
      .map((batch) => {
        let creator = null as string | null;
        if (batch.assigned_to && typeof batch.assigned_to === "object") {
          creator = batch.assigned_to.full_name || batch.assigned_to.username || batch.assigned_to.iduser || null;
        } else {
          creator = batch.created_by_name || batch.created_by || batch.user_name || batch.user || null;
        }
        return {
          batchId: Number(batch.id || batch.idpicklist_batch),
          createdBy: creator,
          status: batch.status,
          progress: batch.progress || null,
        };
      })
      .filter((b) => Number.isFinite(b.batchId));

    if (batchMeta.length === 0) {
      return res.status(200).json({
        step: "ok-empty",
        batchId: null,
        batchIds: [],
        batches: [],
        first: open[0],
        attempts,
      });
    }

    return res.status(200).json({
      step: "ok",
      batchId: batchMeta[0].batchId,
      batchIds: batchMeta.map((b) => b.batchId),
      batches: batchMeta,
      debug: { chosen_statuses: batchMeta.map((b) => b.status), attempts },
    });
  } catch (err) {
    // Ook bij fouten: 200 + lege set teruggeven
    return res.status(200).json({
      step: "fatal",
      batchId: null,
      batchIds: [],
      batches: [],
      error: (err && (err as any).message) || String(err),
      attempts,
    });
  }
}
