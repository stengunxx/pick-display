// pages/api/next-batch.ts
import type { NextApiRequest, NextApiResponse } from "next";

const OPEN_STATUSES = ["open", "processing", "inprogress", "active", "started"];

interface PicqerBatchAssignedTo {
  full_name?: string;
  username?: string;
  iduser?: string | number;
}

interface PicqerBatch {
  id?: number;
  idpicklist_batch?: number;
  status?: string;
  created_at?: string;
  created?: string;
  assigned_to?: PicqerBatchAssignedTo | null;
  created_by_name?: string;
  created_by?: string;
  user_name?: string;
  user?: string;
  progress?: number | null;
  [key: string]: unknown;
}

type AttemptsEntry = Record<string, unknown>;

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

function extractBatches(json: unknown): PicqerBatch[] | null {
  if (Array.isArray(json)) {
    return json as PicqerBatch[];
  }
  if (json && typeof json === "object") {
    const obj = json as { data?: unknown };
    if (Array.isArray(obj.data)) {
      return obj.data as PicqerBatch[];
    }
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ⚠️ Auth tijdelijk uitgezet zodat productie werkt zonder login

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const baseRaw = process.env.PICQER_API_URL ?? "";
  const base = baseRaw.replace(/\/+$/, ""); // strip trailing slash
  const key = process.env.PICQER_API_KEY ?? "";

  if (!base || !key) {
    // Altijd 200: front-end mag niet breken op statuscodes
    return res.status(200).json({
      step: "env-missing",
      batchId: null,
      batchIds: [] as number[],
      batches: [] as unknown[],
      error: "PICQER_API_URL of PICQER_API_KEY ontbreekt/leeg",
      PICQER_API_URL: baseRaw,
      PICQER_API_KEY_set: Boolean(key),
      hint: "PICQER_API_URL moet lijken op https://<tenant>.picqer.com/api/v1 (zonder trailing slash)",
    });
  }

  const headers = {
    Authorization: "Basic " + Buffer.from(key + ":").toString("base64"),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const attempts: AttemptsEntry[] = [];

  try {
    // 1) Haal batches op (altijd 200 teruggeven)
    const url = base + "/picklists/batches";
    let batches: PicqerBatch[] | null = null;

    try {
      const r = (await withTimeout(fetch(url, { headers }), 1200, "GET " + url)) as Response;
      const txt = await r.text();
      let json: unknown = null;
      try {
        json = txt ? JSON.parse(txt) : null;
      } catch (e) {
        attempts.push({ url, status: r.status, parseError: String(e), body: txt.slice(0, 300) });
      }

      const extracted = extractBatches(json);
      if (extracted) {
        batches = extracted;
        attempts.push({
          url,
          ok: true,
          length: extracted.length,
          shape: Array.isArray(json) ? "array" : "data[]",
        });
      } else {
        const jsonObj =
          json && typeof json === "object" ? (json as Record<string, unknown>) : ({} as Record<string, unknown>);
        attempts.push({
          url,
          status: r.status,
          note: "unexpected shape",
          keys: Object.keys(jsonObj),
        });
      }
    } catch (e) {
      attempts.push({ url, error: String(e) });
    }

    if (!batches) {
      // Geen data kunnen lezen → geef lege, maar geldige respons terug
      return res.status(200).json({
        step: "no-batches",
        batchId: null,
        batchIds: [] as number[],
        batches: [] as PicqerBatch[],
        error: "Kon geen lijst met batches ophalen van Picqer",
        attempts,
        hint: "Controleer API-toegang of netwerk",
      });
    }

    // Filter op open statussen
    const open = batches.filter(
      (b) => OPEN_STATUSES.indexOf(String((b && b.status) || "").toLowerCase()) !== -1
    );

    // *** Belangrijk: ALTIJD 200 teruggeven, ook bij 'geen open batches' ***
    if (open.length === 0) {
      return res.status(200).json({
        step: "filter-open",
        batchId: null,
        batchIds: [] as number[],
        batches: [] as PicqerBatch[],
        ok: true,
        attempts,
      });
    }

    // Sorteer oudste eerst (creatiedatum, dan id)
    open.sort((a, b) => {
      const ta = Date.parse((a.created_at || a.created || "") ?? "") || 0;
      const tb = Date.parse((b.created_at || b.created || "") ?? "") || 0;
      if (ta !== tb) return ta - tb;
      const ia = Number(a.id ?? a.idpicklist_batch ?? Number.MAX_SAFE_INTEGER);
      const ib = Number(b.id ?? b.idpicklist_batch ?? Number.MAX_SAFE_INTEGER);
      return ia - ib;
    });

    const top = open.slice(0, 2);

    const batchMeta = top
      .map((batch) => {
        let creator: string | null = null;
        if (batch.assigned_to && typeof batch.assigned_to === "object") {
          creator =
            batch.assigned_to.full_name ??
            batch.assigned_to.username ??
            (batch.assigned_to.iduser != null ? String(batch.assigned_to.iduser) : null);
        } else {
          creator = batch.created_by_name ?? batch.created_by ?? batch.user_name ?? batch.user ?? null;
        }
        const batchId = Number(batch.id ?? batch.idpicklist_batch);
        return {
          batchId,
          createdBy: creator,
          status: batch.status ?? null,
          progress: batch.progress ?? null,
        };
      })
      .filter((b) => Number.isFinite(b.batchId));

    if (batchMeta.length === 0) {
      return res.status(200).json({
        step: "ok-empty",
        batchId: null,
        batchIds: [] as number[],
        batches: [] as PicqerBatch[],
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Ook bij fouten: 200 + lege set teruggeven
    return res.status(200).json({
      step: "fatal",
      batchId: null,
      batchIds: [] as number[],
      batches: [] as PicqerBatch[],
      error: message,
      attempts,
    });
  }
}
