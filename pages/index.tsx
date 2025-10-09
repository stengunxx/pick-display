
'use client';
// ===== ZONE HELPERS =====
const ZONE_TINTS: Record<string,string> = {
  A: '#4FC3F7', // lichtblauw
  B: '#B39DDB', // paars
  C: '#80CBC4', // mint
  D: '#FFD166', // fallback oranje
};
function zoneOf(loc?: string){ const m = (loc||'').trim().match(/^([A-Za-z])/); return m ? m[1].toUpperCase() : 'D'; }
function zoneColor(loc?: string){ return ZONE_TINTS[zoneOf(loc)] || ZONE_TINTS.D; }

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import styles from '../styles/PickDisplay.module.css';

/* ===================== IMAGE HELPERS ===================== */

const EXT_CANDIDATES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] as const;
const probeCache = new Map<string, boolean>();

function stripQuery(u: string) {
  if (!u) return u;
  const i = u.indexOf('?');
  return i >= 0 ? u.slice(0, i) : u;
}
function upgradeInsecure(u: string) {
  if (!u) return '';
  if (u.startsWith('//')) return (typeof location !== 'undefined' ? location.protocol : 'https:') + u;
  if (typeof location !== 'undefined' && location.protocol === 'https:' && u.startsWith('http:')) {
    return u.replace(/^http:/, 'https:');
  }
  return u;
}
function buildSkuFallbacks(sku: string, tpl: string): string[] {
  if (!sku || !tpl) return [];
  const urls: string[] = [];
  if (tpl.includes('{ext}')) {
    for (const ext of EXT_CANDIDATES) urls.push(tpl.replace('{sku}', sku).replace('{ext}', ext));
  } else {
    const expanded = tpl.replace('{sku}', sku);
    const noQuery = stripQuery(expanded);
    const hasKnownExt = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i.test(noQuery);
    if (hasKnownExt) {
      const base = expanded.replace(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?.*)?$/i, '');
      for (const ext of EXT_CANDIDATES) urls.push(`${base}.${ext}`);
    } else {
      urls.push(expanded);
      for (const ext of EXT_CANDIDATES) urls.push(`${expanded}.${ext}`);
    }
  }
  return urls.map(upgradeInsecure);
}
function getImageCandidates(x: any): string[] {
  if (!x) return [];
  const fields = [
    x.image, x.imageUrl, x.image_url, x.imageURL,
    x.foto, x.afbeelding, x.product_image, x.productImage,
    x.thumbnail, x.thumb, x.thumbUrl, x.thumb_url,
    x.productimage, x.product_image_url, x.image_path, x.image_small, x.image_large,
    x.image?.url, x.image?.src, x.main_image?.url, x.mainImage?.url,
    x.primary_image?.url, x.primaryImage?.url,
    x.product?.image, x.product?.imageUrl, x.product?.image_url, x.product?.image?.url,
    Array.isArray(x.images) ? (x.images[0]?.url ?? x.images[0]?.src ?? x.images[0]) : undefined,
    Array.isArray(x.media)  ? (x.media[0]?.url  ?? x.media[0]?.src  ?? x.media[0])  : undefined,
    Array.isArray(x.assets) ? (x.assets[0]?.url ?? x.assets[0]) : undefined,
    Array.isArray(x.gallery)? (x.gallery[0]?.url ?? x.gallery[0]) : undefined,
  ].filter(Boolean).map(String).map(upgradeInsecure);

  const sku = x?.productcode ?? x?.sku ?? x?.product?.sku ?? '';
  const tpl = (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_IMAGE_BY_SKU_TEMPLATE) || '';
  const fromSku = sku && tpl ? buildSkuFallbacks(String(sku), String(tpl)) : [];

  const seen = new Set<string>();
  return [...fields, ...fromSku].filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}
function probeImage(url: string): Promise<boolean> {
  if (!url) return Promise.resolve(false);
  if (probeCache.has(url)) return Promise.resolve(!!probeCache.get(url));
  return new Promise<boolean>(resolve => {
    const img = new Image();
    img.onload = () => { probeCache.set(url, true); resolve(true); };
    img.onerror = () => { probeCache.set(url, false); resolve(false); };
    img.src = url;
  });
}
async function selectFirstReachable(urls: string[]): Promise<string> {
  for (const u of urls) {
    if (await probeImage(u)) return u;
  }
  return '';
}

type ProductImageProps = { item: any; max?: number; radius?: number; alt?: string; debugSwitch?: boolean; bare?: boolean; };
function ProductImage({ item, max = 200, radius = 12, alt = 'Productfoto', debugSwitch, bare }: ProductImageProps) {
  const [url, setUrl] = useState('');
  const [tried, setTried] = useState<string[]>([]);
  const candidates = useMemo(() => getImageCandidates(item), [item]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUrl(''); setTried([]);
      if (!candidates.length) return;
      setTried(candidates);
      const found = await selectFirstReachable(candidates);
      if (!cancelled) setUrl(found);
    })();
    return () => { cancelled = true; };
  }, [candidates.join('|')]);

  if (!url) {
    if (!debugSwitch) return null;
    return (
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{
          width: max, height: max, borderRadius: radius,
          background: '#111', color: '#555', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 12, border: '1px solid #222'
        }}>
          geen foto (debug)
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#888', maxWidth: 560, marginInline: 'auto', textAlign: 'left', fontFamily: 'ui-monospace' }}>
          {tried.map((u, i) => <div key={u + i}>{u}</div>)}
        </div>
      </div>
    );
  }

  return (
    <img
      key={url}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{
        maxWidth: max, maxHeight: max,
        objectFit: 'contain',
        borderRadius: radius,
        background: bare ? 'transparent' : '#111',
        padding: bare ? 0 : 8,
        boxShadow: bare ? 'none' : '0 2px 16px rgba(0,0,0,.2)',
        margin: '0 auto', display: 'block'
      }}
    />
  );
}

/* ===================== TYPES & HELPERS ===================== */

type BatchView = {
  batchId: string | number;
  currentProduct: any | null;
  product: string;
  sku: string;
  done: number;
  total: number;
  progress: number;
  nextLocations: string[];
  items?: any[];
  totalProducts?: number;
  todoProducts?: number;
};
type MiniFx = Record<string | number, { locPulse: boolean; bump: boolean; newPick?: boolean }>;

const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
const locOf = (it: any) => (it?.stocklocation ?? it?.stock_location ?? '').toString();
const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);

/* ===================== MINI PANEL (split) ===================== */

function RenderBatchMini(
  { b, fx, debug }: { b: BatchView; fx?: { locPulse?: boolean; bump?: boolean; newPick?: boolean }; debug?: boolean }
) {
  if (!b) return null;
  const cur = b.currentProduct;
  const loc = cur ? (cur.stocklocation || cur.stock_location || '—') : '—';

  return (
    <div className={styles.panel}>
      <div className={styles.panelCard} style={{ position: 'relative' }}>
        <div className={styles.panelTitle}>
          Batch #{String(b.batchId)} • Voortgang: {b.progress}%
        </div>
        <div className={styles.progressMini}>
          <i style={{ width: `${Math.max(0, Math.min(100, b.progress || 0))}%` }} />
        </div>

        {typeof b.totalProducts === 'number' && typeof b.todoProducts === 'number' && (
          <div className={(styles as any).batchInlineTotals}>
            <span>Nog te doen: <b>{b.todoProducts}</b></span>
            <span>·</span>
            <span>Totaal: <b>{b.totalProducts}</b></span>
          </div>
        )}

        <h1 className={styles.locationSplit}>
            <span className={fx?.locPulse ? styles.locFlash : styles.locBox}>{loc}</span>
        </h1>

        <div className={styles.imageWellSm} style={{ ['--zone' as any]: zoneColor(loc) }}>
          <ProductImage
            item={cur}
            max={56}
            radius={8}
            alt={cur?.product || cur?.name || 'Productfoto'}
            debugSwitch={!!debug}
            bare
          />
        </div>

        <div className={(styles as any).metaRow}>
          <div className={(styles as any).metaLeft}>Gedaan: <b className={fx?.bump ? styles.bumpFlash : ''}>{b.done}</b></div>
          <div className={(styles as any).nameCenter}>
            {b.product}
            <div className={styles.skuSplit}>
              SKU: <span style={{ fontFamily: 'ui-monospace' }}>{b.sku}</span>
            </div>
          </div>
          <div className={(styles as any).metaRight}>Totaal: <b>{b.total}</b></div>
        </div>

        {Array.isArray(b.nextLocations) && b.nextLocations.length > 0 && (
          <div className={(styles as any).nextStrip}>
            <div className={(styles as any).nextStripTitle}>Volgende locaties</div>
            <div className={(styles as any).nextStripScroller}>
              {b.nextLocations.map((L: string, i: number) => (
                <span key={L + String(i)} className={(styles as any).chipSmall}>{L}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== PAGE ===================== */

export default function HomePage() {

  const [debug, setDebug] = useState(false);

  // header
  const [now, setNow] = useState('');
  const [picklistId, setPicklistId] = useState<string>('');
  const [progress, setProgress] = useState(0);

  // single view state
  const [currentProduct, setCurrentProduct] = useState<any | null>(null);
  const [dataItems, setDataItems] = useState<any[]>([]);
  const [sku, setSku] = useState('');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [nextLocations, setNextLocations] = useState<string[]>([]);

  // split view
  const [batches, setBatches] = useState<BatchView[]>([]);
  const [miniFx, setMiniFx] = useState<MiniFx>({}); // alleen voor split

  // single-mode animaties (los van split)
  const [singleFx, setSingleFx] = useState<{locPulse:boolean; bump:boolean}>({locPulse:false, bump:false});

  // toasts
  const [toast, setToast] = useState<{text:string}|null>(null);
  const toastTimerRef = useRef<any>(null);
  const showToast = (text: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text });
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  };

  // fetching + empty-state stabilisatie
  const [loading, setLoading] = useState(true);
  const emptyTicksRef = useRef(0);
  const EMPTY_TICKS_TO_CLEAR = 3;

  // error state (fixes error references)
  const [error, setError] = useState<string>('');

  // misc refs voor detectie
  const prevLocRef = useRef('');
  const prevDoneRef = useRef<number>(-1);
  const prevSkuRef = useRef<string>('');
  // Ref to track previous picklistId for toast logic
  const prevPicklistIdRef = useRef<string | number>('');
  // Ref om vorige productcodes/skus van batch te onthouden
  // In split mode, store as tuple of arrays: [batchA, batchB]
  const prevBatchSkusRef = useRef<[string[], string[]] | string[]>([]);

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Polling
  useEffect(() => {
    let unmounted = false;
    let timer: any = null;

    async function fetchOnce() {
      let loaderTimer: any;
      try {
        loaderTimer = setTimeout(() => setLoading(true), 450);

        // Force cache busting with a random value and also add a timestamp for extra freshness
        const bust = `_=${Date.now()}&rnd=${Math.random()}&nocache=${Math.random().toString(36).slice(2)}`;
        const j = await fetch(`/api/next-batch?${bust}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        }).then(r => r.json());
        const ids: (string | number)[] = Array.isArray(j.batchIds) ? j.batchIds : (j.batchId ? [j.batchId] : []);

        if (!ids || ids.length === 0) {
          emptyTicksRef.current += 1;
          if (emptyTicksRef.current >= EMPTY_TICKS_TO_CLEAR) {
            if (!unmounted) {
              setBatches([]);
              // laat single view staan tot echt 3 lege polls → UX rustiger
            }
          }
          return;
        }

        const settled = await Promise.allSettled(
          ids.slice(0, 2).map(id => fetch(`/api/next-pick?batchId=${id}&${bust}`, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          }).then(r => r.json()))
        );

        const views: BatchView[] = [];

        for (let i = 0; i < settled.length; i++) {
          const res = settled[i];
          if (res.status !== 'fulfilled') continue;
          const p = res.value;

          const items: any[] = Array.isArray(p.items)
            ? p.items.slice().sort((a: any, b: any) => collator.compare(locOf(a), locOf(b)))
            : [];

          const cur = items.find(it => pickedOf(it) < totalOf(it)) ?? null;

          const prog = items.length
            ? Math.round((items.filter(it => pickedOf(it) >= totalOf(it)).length / items.length) * 100)
            : 0;

          let nextLocs: string[] = [];
          if (cur) {
            const curIdx = items.findIndex(x => x === cur);
            const curLoc = locOf(cur);
            const seen = new Set<string>();
            nextLocs = items
              .map((it, idx) => ({ it, idx }))
              .filter(({ it, idx }) => idx > curIdx && pickedOf(it) < totalOf(it))
              .map(({ it }) => locOf(it))
              .filter(loc => loc && loc !== curLoc && (seen.has(loc) ? false : (seen.add(loc), true)));
          }

          const totalProducts = items.reduce((s, it) => s + totalOf(it), 0);
          const todoProducts  = items.reduce((s, it) => s + Math.max(0, totalOf(it) - pickedOf(it)), 0);

          views.push({
            batchId: ids[i],
            currentProduct: cur,
            product: (cur?.product ?? cur?.name ?? cur?.title ?? cur?.omschrijving ?? cur?.description ?? p.product ?? '') as string,
            sku: (cur?.productcode ?? cur?.sku ?? '') as string,
            done: cur ? pickedOf(cur) : 0,
            total: cur ? totalOf(cur) : 0,
            progress: prog,
            nextLocations: nextLocs,
            items,
            totalProducts,
            todoProducts,
          });
        }

        if (unmounted) return;


        const active = views.filter(v => v.currentProduct);
        const primary = active[0] || null;

        if (active.length > 0 && primary?.currentProduct) {
          emptyTicksRef.current = 0;

          // SPLIT state (mini-effecten)
          setBatches(active);
          setMiniFx(prev => {
            const next: MiniFx = { ...prev };
            for (const v of active) {
              const id = v.batchId;
              const locNow = String(v.currentProduct?.stocklocation ?? v.currentProduct?.stock_location ?? '');
              const d = Number(v.done ?? 0);
              const prevKey = `${(prev as any)[id]?.__loc ?? ''}|${(prev as any)[id]?.__done ?? -1}`;
              const locChanged = prevKey.split('|')[0] !== locNow;
              const doneIncreased = Number(prevKey.split('|')[1]) < d;
              next[id] = { locPulse: !!locChanged, bump: !!doneIncreased };
              (next as any)[id].__loc = locNow;
              (next as any)[id].__done = d;
              setTimeout(() => {
                setMiniFx(curr => ({ ...curr, [id]: { ...(curr[id] || {}), locPulse: false, bump: false } }));
              }, locChanged ? 600 : 300);
            }
            Object.keys(next).forEach(k => {
              if (!active.some(v => String(v.batchId) === String(k))) delete (next as any)[k];
            });
            return next;
          });

          // HEADER
          setPicklistId(String(primary.batchId));
          setProgress(primary.progress);

          // SPLIT/Single view detecties + animaties/toasts
          // For split mode, check for new picklist in either batch
          if (active.length >= 2) {
            // Compare current SKUs for both batches to previous, store as tuple
            const currentSkusA = Array.isArray(active[0].items) ? active[0].items.map(it => String(it.productcode ?? it.sku ?? '')) : [];
            const currentSkusB = Array.isArray(active[1].items) ? active[1].items.map(it => String(it.productcode ?? it.sku ?? '')) : [];
            let prevTuple: [string[], string[]] = [[], []];
            if (Array.isArray(prevBatchSkusRef.current) && prevBatchSkusRef.current.length === 2 && Array.isArray(prevBatchSkusRef.current[0]) && Array.isArray(prevBatchSkusRef.current[1])) {
              prevTuple = prevBatchSkusRef.current as [string[], string[]];
            }
            const isNewA = prevTuple[0].length > 0 && currentSkusA.length > 0 && (prevTuple[0] as string[]).join('|') !== currentSkusA.join('|');
            const isNewB = prevTuple[1].length > 0 && currentSkusB.length > 0 && (prevTuple[1] as string[]).join('|') !== currentSkusB.join('|');
            if (isNewA || isNewB) {
              showToast('Nieuwe picklijst');
            }
            // Store tuple for next comparison
            prevBatchSkusRef.current = [currentSkusA, currentSkusB];
          } else {
            // Single view logic
            const loc = primary.currentProduct.stocklocation ?? primary.currentProduct.stock_location ?? '';
            const doneVal = primary.done;
            const skuVal  = primary.sku || '';
            const batchIdVal = String(primary.batchId);

            // locatie wissel → zachte glow (geen toast)
            if (prevLocRef.current && prevLocRef.current !== loc) {
              setSingleFx(s => ({ ...s, locPulse: true }));
              setTimeout(() => setSingleFx(s => ({ ...s, locPulse: false })), 520);
            }
            prevLocRef.current = loc;

            // done toename → kleine pop animatie + groen
            if (prevDoneRef.current >= 0 && doneVal > prevDoneRef.current) {
              setSingleFx(s => ({ ...s, bump: true }));
              setTimeout(() => setSingleFx(s => ({ ...s, bump: false })), 240);
            }
            prevDoneRef.current = doneVal;

            // batchId verandering → nieuwe picklijst toast
            const currentSkus = Array.isArray(primary.items)
              ? primary.items.map(it => String(it.productcode ?? it.sku ?? ''))
              : [];
            const prevSkus = prevBatchSkusRef.current;
            const isNewPicklist = prevSkus.length > 0 && currentSkus.length > 0 && (
              prevSkus.join('|') !== currentSkus.join('|')
            );
            if (isNewPicklist) {
              showToast('Nieuwe picklijst');
            }
            prevBatchSkusRef.current = currentSkus;

            prevSkuRef.current = skuVal;

            // update single data
            setCurrentProduct(primary.currentProduct);
            setDataItems(Array.isArray(primary.items) ? primary.items : []);
            setSku(primary.sku);
            setDone(primary.done);
            setTotal(primary.total);
            setNextLocations(primary.nextLocations);
          }
        } else {
          // tijdelijk leeg → behoud laatste goede view
          emptyTicksRef.current += 1;
        }

        setError('');
      } catch (e: any) {
        setError(e?.message || 'Er ging iets mis.');
      } finally {
        setLoading(false);
        clearTimeout(loaderTimer);
      }
    }

    const loop = async () => {
      await fetchOnce();
      if (!unmounted) timer = setTimeout(loop, 100);
    };

    loop();
    return () => { unmounted = true; if (timer) clearTimeout(timer); if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  const splitMode = batches.filter(b => b && b.currentProduct).length >= 2;

  const pickTotals = useMemo(() => {
    const items = Array.isArray(dataItems) ? dataItems : [];
    if (!items.length) return { totalProducts: total, todoProducts: Math.max(0, total - done) };
    const totalProducts = items.reduce((s, it) => s + totalOf(it), 0);
    const todoProducts  = items.reduce((s, it) => s + Math.max(0, totalOf(it) - pickedOf(it)), 0);
    return { totalProducts, todoProducts };
  }, [dataItems, total, done]);

  const showEmpty = !loading && !splitMode && !currentProduct && (!batches || batches.length === 0);

  return (
    <div className={styles.root}>
      {/* Toast (single mode) */}
      {!splitMode && toast && (
        <div className={styles.toastWrap} aria-live="polite" aria-atomic="true">
          <div className={styles.toastBubble}>{toast.text}</div>
        </div>
      )}

      {/* Topbar */}
      <header className={styles.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <nav className={styles.nav}>
              <a className={styles.navBtn}>Home</a>
              <a className={styles.navBtn}>Station 1</a>
              <button onClick={() => setDebug(d => !d)} className={styles.debugBtn}>
                Debug {debug ? '🔛' : '🔘'}
              </button>
            </nav>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <div className={styles.status}>
              {splitMode ? (
                <div className={styles.statusRow}>
                  <span>Picklist: <strong>#{picklistId || '—'}</strong></span>
                  <span className={styles.clock}>{now}</span>
                </div>
              ) : (
                <div className={styles.statusRow}>
                  <span>Picklist: <strong>#{picklistId || '—'}</strong></span>
                  <span>Voortgang: <strong>{progress}%</strong></span>
                  <span>Totaal: <strong>{pickTotals.totalProducts}</strong></span>
                  <span>Nog te doen: <strong>{pickTotals.todoProducts}</strong></span>
                  <span className={styles.clock}>{now}</span>
                </div>
              )}
              {!splitMode && (
                <div className={(styles as any).headerProgress}>
                  <i style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className={styles.navBtn}
              style={{
                background: '#222',
                color: '#ffd166',
                borderRadius: 8,
                padding: '6px 16px',
                border: '1px solid #ffd166',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {error ? (
          <div style={{ textAlign: 'center', marginTop: 64, color: '#d33', fontSize: '1.5rem', fontWeight: 500 }}>
            {error}
            <br />
            <span style={{ fontSize: '1rem', color: '#aaa' }}>Controleer Picqer of probeer opnieuw…</span>
          </div>
        ) : splitMode ? (
          <div className={styles.splitWrap}>
            <section className={styles.splitPaneTop}>
              <RenderBatchMini b={batches[0]} fx={miniFx[batches[0].batchId]} debug={debug} />
            </section>
            <section className={styles.splitPaneBottom}>
              <RenderBatchMini b={batches[1]} fx={miniFx[batches[1].batchId]} debug={debug} />
            </section>
          </div>
        ) : currentProduct ? (
          <div className={styles.singleWrap}>
            <div className={styles.card}>
              {/* Locatie */}
              <h1 className={styles.location} style={{ marginTop: 0, marginBottom: '0.2em' }}>
                <span
                  className={styles.locBox}
                  style={{ ['--zone' as any]: zoneColor(currentProduct?.stocklocation || currentProduct?.stock_location) }}
                >
                  <span className={styles.locText}>
                    {currentProduct ? (currentProduct.stocklocation || currentProduct.stock_location || '—') : '—'}
                  </span>
                  <span className={`${styles.locUnderline} ${singleFx.locPulse ? styles.locUnderlineIn : ''}`} />
                </span>
              </h1>

              {/* Foto */}
              <div
                className={`${styles.imageWell} ${singleFx.locPulse ? styles.imageWellPulse : ''}`}
                style={{ ['--zone' as any]: zoneColor(currentProduct?.stocklocation || currentProduct?.stock_location) }}
              >
                <ProductImage
                  item={currentProduct}
                  max={220}
                  radius={12}
                  alt={currentProduct?.product || currentProduct?.name || 'Productfoto'}
                  debugSwitch={debug}
                  bare
                />
              </div>

              {/* Naam + SKU */}
              <div className={styles.meta}>
                <div className={styles.productName}>
                  {currentProduct?.product || currentProduct?.name || currentProduct?.title || currentProduct?.omschrijving || currentProduct?.description || ''}
                </div>
                <div className={styles.sku}>
                  SKU: <span style={{ fontFamily: 'ui-monospace' }}>{sku}</span>
                </div>
              </div>

              {/* Stats */}
              <div className={styles.stats}>
                <div>
                  <div className={`${styles.statValue} ${singleFx.bump ? styles.countPop : ''} ${singleFx.bump ? styles.countGreen : ''}`}>{done}</div>
                  <div className={styles.statLabel}>Gedaan</div>
                </div>
                <div>
                  <div className={styles.statValue}>{total}</div>
                  <div className={styles.statLabel}>Totaal</div>
                </div>
              </div>

              {/* Volgende locaties */}
              {nextLocations && nextLocations.length > 0 && (
                <div className={styles.nextSection}>
                  <div className={styles.nextTitle}>Volgende locaties:</div>
                  <div className={(styles as any).nextScroll}>
                    <div className={styles.nextGrid}>
                      {nextLocations.map((loc, i) => (
                        <div
                          key={loc + String(i)}
                          className={styles.badgeBig}
                          style={{ ['--zone' as any]: zoneColor(loc) }}
                        >
                          {loc}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : showEmpty ? (
          <div style={{ textAlign: 'center', marginTop: 64, color: '#888', fontSize: '1.5rem', fontWeight: 500 }}>
            Geen actieve batch of pickdata gevonden.
            <br />
            <span style={{ fontSize: '1rem', color: '#aaa' }}>Wacht op een nieuwe batch in Picqer…</span>
          </div>
        ) : null}
      </main>
    </div>
  );
}