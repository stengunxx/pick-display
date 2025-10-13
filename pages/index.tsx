// pages/index.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../styles/PickDisplay.module.css';
import { zoneColor, zoneOf } from '../lib/picqer';

/* ===================== TYPES & UTILS ===================== */

type BatchView = {
  batchId: string | number;
  currentProduct: any | null;
  product: string;
  sku: string;
  done: number;
  total: number;
  progress: number;
  nextLocations: string[];
  items: any[];
  totalProducts: number;
  todoProducts: number;
  createdBy?: string | null;
};

type MiniFxMap = Record<
  string,
  {
    locPulse?: boolean;
    bump?: boolean;
    newPick?: boolean;
    __loc?: string;
    __done?: number;
  }
>;

const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
const locOf = (it: any) => (it?.stocklocation ?? it?.stock_location ?? '').toString();
const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);

function getInitials(name?: string | null) {
  if (!name) return '—';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}

// (stub) – vervang met je eigen auth/next-auth signOut wanneer gewenst
function signOut({ callbackUrl }: { callbackUrl: string }) {
  window.location.href = callbackUrl;
}

/* ===================== DUMB COMPONENTS ===================== */

function ProductImage({
  item, max, radius, alt,
}: { item: any; max?: number; radius?: number; alt?: string }) {
  const url = item?.imageUrl || item?.image_url || item?.image || '';
  return (
    <img
      src={url || '/placeholder.png'}
      alt={alt || 'Product'}
      style={{ width: max || 64, height: max || 64, borderRadius: radius || 8, objectFit: 'cover', background: '#eee' }}
    />
  );
}

function RenderBatchMini({
  b, fx,
}: { b: BatchView; fx?: { locPulse?: boolean; bump?: boolean; newPick?: boolean } }) {
  if (!b) return null;
  const cur = b.currentProduct;
  const loc = cur ? String(cur.stocklocation ?? cur.stock_location ?? '—') : '—';
  const parts = loc.split(/[.\s-]+/).filter(Boolean);

  return (
    <div className={styles.panel}>
      <div className={styles.panelCard}>
        {/* HERO locatiebalk */}
        <div
          className={`${styles.heroLoc} ${fx?.locPulse ? styles.heroLocPulse : ''}`}
          style={{ ['--zone' as any]: zoneColor(loc) }}
          aria-label={`Locatie ${loc}`}
        >
          <span className={styles.zoneBadge}>{zoneOf(loc) || '–'}</span>
          <div className={styles.locSegWrap}>
            {parts.length ? parts.map((p, i) => (
              <span key={p + i} className={styles.locSeg}>{p}</span>
            )) : <span className={styles.locSeg}>—</span>}
          </div>
        </div>

        {/* Header */}
        <div className={styles.miniHeader}>
          <div className={styles.miniMetaLeft}>
            <span className={styles.batchId}>Batch #{String(b.batchId)}</span>
            <span className={styles.dot}>•</span>
            <span>Voortgang: {b.progress}%</span>
          </div>
          <div className={styles.miniMetaCenter}>
            {b.createdBy && (
              <span className={styles.creatorTag} title={`Aangemaakt door ${b.createdBy}`}>
                <span className={styles.creatorDotSm} aria-hidden="true">{getInitials(b.createdBy)}</span>
                <span className={styles.creatorNameSm}>{b.createdBy}</span>
              </span>
            )}
          </div>
          <div className={styles.miniProgress}>
            <i style={{ width: `${Math.max(0, Math.min(100, b.progress || 0))}%` }} />
          </div>
        </div>

        {/* Body */}
        <div className={styles.panelGrid}>
          <div className={styles.colLeft}>
            <div className={styles.imageWellSm} style={{ ['--zone' as any]: zoneColor(loc) }}>
              <ProductImage item={cur} max={72} radius={12} alt={cur?.product || cur?.name || 'Productfoto'} />
            </div>
            <div className={styles.skuBadge}>SKU: <b>{b.sku || '—'}</b></div>
          </div>

          <div className={styles.colCenter}>
            <div className={styles.productNameSplit}>{b.product || '—'}</div>
            {typeof b.totalProducts === 'number' && typeof b.todoProducts === 'number' && (
              <div className={styles.miniTotals}>
                <span>Nog te doen: <b>{b.todoProducts}</b></span>
                <span className={styles.dot}>•</span>
                <span>Totaal: <b>{b.totalProducts}</b></span>
              </div>
            )}
          </div>

          <div className={styles.colRight}>
            <div className={`${styles.countPill} ${fx?.bump ? styles.pillFlashSm : ''}`}>
              <div className={styles.countValue}>{b.done}</div>
              <div className={styles.countLabel}>Gedaan</div>
            </div>
            <div className={`${styles.countPill} ${styles.countPillMuted}`}>
              <div className={styles.countValue}>{b.total}</div>
              <div className={styles.countLabel}>Totaal</div>
            </div>
          </div>
        </div>

        {!!b.nextLocations?.length && (
          <div className={styles.nextStrip}>
            <div className={styles.nextStripTitle}>Volgende locaties</div>
            <div className={styles.nextStripScroller}>
              {b.nextLocations.map((L, i) => (
                <span key={L + i} className={styles.chipSmall} style={{ ['--zone' as any]: zoneColor(L) }}>
                  {L}
                </span>
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
  const [xl, setXl] = useState(false);

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
  const [primaryCreatedBy, setPrimaryCreatedBy] = useState<string | null>(null);

  // split view
  const [batches, setBatches] = useState<BatchView[]>([]);
  const [miniFx, setMiniFx] = useState<MiniFxMap>({});

  // single-mode animaties
  const [singleFx, setSingleFx] = useState<{ locPulse: boolean; bump: boolean }>({ locPulse: false, bump: false });

  // toasts (met throttle)
  const [toast, setToast] = useState<{ text: string } | null>(null);
  const toastTimerRef = useRef<any>(null);
  const shownKeysRef = useRef<Record<string, number>>({}); // key -> lastShown ts
  const showToast = (text: string, duration = 1400) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  };
  const showToastOnce = (key: string, text: string, cooldownMs = 5000) => {
    const tnow = Date.now();
    const last = shownKeysRef.current[key] || 0;
    if (tnow - last >= cooldownMs) {
      shownKeysRef.current[key] = tnow;
      showToast(text);
    }
  };

  // confetti/guards
  const [batchCompleteFx, setBatchCompleteFx] = useState(false);
  const wasActiveRef = useRef(false);
  const completedLatchRef = useRef(false); // <— voorkomt herhaald trigggeren in lege fase

  // error state
  const [error, setError] = useState<string>('');

  // misc refs
  const prevLocRef = useRef('');
  const prevDoneRef = useRef<number>(-1);
  const prevSkuRef = useRef<string>('');
  const prevBatchSkusRef = useRef<[string[], string[]] | string[]>([]);

  // UI-mode
  const [uiState, setUiState] = useState<'ACTIVE' | 'EMPTY'>('EMPTY');

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
      try {
        const bust = `_=${Date.now()}&rnd=${Math.random()}&nocache=${Math.random().toString(36).slice(2)}`;

        // 1) Haal open batchIds op
        const j = await fetch(`/api/next-batch?${bust}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          },
        }).then((r) => r.json());

        const ids: (string | number)[] = Array.isArray(j.batchIds) ? j.batchIds : (j.batchId ? [j.batchId] : []);

        // createdBy-map
        const createdByMap = new Map<string, string | null>();
        if (Array.isArray(j?.batches)) {
          for (const b of j.batches) {
            const bid = String(b?.batchId ?? '');
            if (bid) createdByMap.set(bid, b?.createdBy ?? null);
          }
        }

        if (!ids || ids.length === 0) {
          // Geen batches → naar EMPTY zodra we hiervoor ACTIVE waren of al EMPTY zijn
          if (uiState !== 'EMPTY') {
            setUiState('EMPTY');
          }
          // maak alle active/pick state leeg
          setBatches([]);
          setPicklistId('');
          setProgress(0);
          setCurrentProduct(null);
          setDataItems([]);
          setSku('');
          setDone(0);
          setTotal(0);
          setNextLocations([]);
          setPrimaryCreatedBy(null);
          wasActiveRef.current = false;

          // zorg dat toast weg is in lege fase
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast(null);

          // blokkeer opnieuw 'completed' spammen tot we weer ACTIEF worden
          completedLatchRef.current = true;
          return;
        }

        // 2) Voor max 2 batches: haal items op
        const settled = await Promise.allSettled(
          ids.slice(0, 2).map((id) =>
            fetch(`/api/next-pick?batchId=${id}&${bust}`, {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
              },
            }).then((r) => r.json())
          )
        );

        // 3) Bouw views
        const views: BatchView[] = [];
        for (let i = 0; i < settled.length; i++) {
          const res = settled[i];
          if (res.status !== 'fulfilled') continue;
          const p = res.value;

          const items: any[] = Array.isArray(p.items)
            ? p.items.slice().sort((a: any, b: any) => collator.compare(locOf(a), locOf(b)))
            : [];

          const cur = items.find((it) => pickedOf(it) < totalOf(it)) ?? null;

          const prog = items.length
            ? Math.round((items.filter((it) => pickedOf(it) >= totalOf(it)).length / items.length) * 100)
            : 0;

          let nextLocs: string[] = [];
          if (cur) {
            const curIdx = items.findIndex((x) => x === cur);
            const curLoc = locOf(cur);
            const seen = new Set<string>();
            nextLocs = items
              .map((it, idx) => ({ it, idx }))
              .filter(({ it, idx }) => idx > curIdx && pickedOf(it) < totalOf(it))
              .map(({ it }) => locOf(it))
              .filter((loc) => loc && loc !== curLoc && (seen.has(loc) ? false : (seen.add(loc), true)));
          }

          const totalProducts = items.reduce((s, it) => s + totalOf(it), 0);
          const todoProducts  = items.reduce((s, it) => s + Math.max(0, totalOf(it) - pickedOf(it)), 0);

          views.push({
            batchId: ids[i],
            createdBy: createdByMap.get(String(ids[i])) ?? null,
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

        const active = views.filter((v) => v.currentProduct);
        const primary = active[0] || null;
        const allDone = views.length > 0 && active.length === 0;

        if (active.length > 0 && primary?.currentProduct) {
          // We hebben actieve picks
          if (!wasActiveRef.current) {
            shownKeysRef.current = {};
            completedLatchRef.current = false; // we zijn weer actief, dus toekomstige complete mag weer triggeren
          }
          wasActiveRef.current = true;
          if (uiState !== 'ACTIVE') setUiState('ACTIVE');

          // SPLIT: state + mini-effecten
          setBatches(active);
          setMiniFx((prev) => {
            const next: MiniFxMap = { ...prev };
            for (const v of active) {
              const id = String(v.batchId);
              const locNow = String(v.currentProduct?.stocklocation ?? v.currentProduct?.stock_location ?? '');
              const d = Number(v.done ?? 0);
              const prevKey = `${(prev as any)[id]?.__loc ?? ''}|${(prev as any)[id]?.__done ?? -1}`;
              const locChanged = prevKey.split('|')[0] !== locNow;
              const doneIncreased = Number(prevKey.split('|')[1]) < d;
              next[id] = { locPulse: !!locChanged, bump: !!doneIncreased };
              (next as any)[id].__loc = locNow;
              (next as any)[id].__done = d;
              setTimeout(() => {
                setMiniFx((curr) => ({ ...curr, [id]: { ...(curr[id] || {}), locPulse: false, bump: false } }));
              }, locChanged ? 600 : 300);
            }
            // opschonen
            Object.keys(next).forEach((k) => {
              if (!active.some((v) => String(v.batchId) === String(k))) delete (next as any)[k];
            });
            return next;
          });

          // HEADER
          setPicklistId(String(primary.batchId));
          setProgress(primary.progress);

          // Confetti bij 100%
          if (typeof primary.progress === 'number' && primary.progress === 100 && !batchCompleteFx) {
            setBatchCompleteFx(true);
            setTimeout(() => setBatchCompleteFx(false), 1000);
          }

          // SINGLE view: animaties & data
          const loc = primary.currentProduct.stocklocation ?? primary.currentProduct.stock_location ?? '';
          const doneVal = primary.done;
          const skuVal = primary.sku || '';

          // locatie wissel
          if (prevLocRef.current && prevLocRef.current !== loc) {
            setSingleFx((s) => ({ ...s, locPulse: true }));
            setTimeout(() => setSingleFx((s) => ({ ...s, locPulse: false })), 520);
          }
          prevLocRef.current = loc;

          // done toename
          if (prevDoneRef.current >= 0 && doneVal > prevDoneRef.current) {
            setSingleFx((s) => ({ ...s, bump: true }));
            setTimeout(() => setSingleFx((s) => ({ ...s, bump: false })), 1000);
          }
          prevDoneRef.current = doneVal;
          prevSkuRef.current = skuVal;

          // Detecteer nieuwe picklijst
          const currentSkus = Array.isArray(primary.items)
            ? primary.items.map((it) => String(it.productcode ?? it.sku ?? ''))
            : [];
          const prevSkus = prevBatchSkusRef.current as string[] | [string[], string[]];
          const prevSkusFlat = Array.isArray(prevSkus[0]) ? (prevSkus as [string[], string[]])[0] : (prevSkus as string[]);
          if (
            Array.isArray(prevSkusFlat) &&
            prevSkusFlat.length > 0 &&
            currentSkus.length > 0 &&
            prevSkusFlat.join('|') !== currentSkus.join('|')
          ) {
            const toastKey = `newpick:${primary.batchId}`;
            showToastOnce(toastKey, 'Nieuwe picklijst', 5000);
          }
          prevBatchSkusRef.current = currentSkus;

          // data setten
          setCurrentProduct(primary.currentProduct);
          setDataItems(Array.isArray(primary.items) ? primary.items : []);
          setSku(primary.sku);
          setDone(primary.done);
          setTotal(primary.total);
          setNextLocations(primary.nextLocations);
          setPrimaryCreatedBy(primary.createdBy ?? null);
        } else if (allDone) {
          // Alles gepickt in de teruggegeven batches
          if (wasActiveRef.current && !completedLatchRef.current) {
            completedLatchRef.current = true; // latch zodat we dit slechts één keer doen
            wasActiveRef.current = false;

            // feedback
            showToast('Batch voltooid', 1200);
            if (!batchCompleteFx) setBatchCompleteFx(true);
            setTimeout(() => setBatchCompleteFx(false), 1000);

            // DIRECT naar lege staat en oude product UI opruimen
            setUiState('EMPTY');
            setBatches([]);
            setCurrentProduct(null);
            setDataItems([]);
            setSku('');
            setDone(0);
            setTotal(0);
            setNextLocations([]);
            setPicklistId('');
            setProgress(0);
            setPrimaryCreatedBy(null);

            // na het legen: geen lingering toast
            setTimeout(() => {
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              setToast(null);
            }, 1300);
          } else {
            // al leeg of al gelatcht → niets doen
            if (uiState !== 'EMPTY') setUiState('EMPTY');
          }
        } else {
          // Tussenfase (we kregen ids, maar nog geen items met currentProduct) → niets forceren.
          // UI blijft staan waar hij is; geen EMPTY wissel hier.
        }

        setError('');
      } catch (e: any) {
        setError(e?.message || 'Er ging iets mis.');
      }
    }

    const loop = async () => {
      await fetchOnce();
      if (!unmounted) timer = setTimeout(loop, 100); // 100ms poll
    };

    loop();
    return () => {
      unmounted = true;
      if (timer) clearTimeout(timer);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [batchCompleteFx, uiState]);

  const splitMode = batches.filter((b) => b && b.currentProduct).length >= 2;

  const pickTotals = useMemo(() => {
    const items = Array.isArray(dataItems) ? dataItems : [];
    if (!items.length) return { totalProducts: total, todoProducts: Math.max(0, total - done) };
    const totalProducts = items.reduce((s, it) => s + totalOf(it), 0);
    const todoProducts = items.reduce((s, it) => s + Math.max(0, totalOf(it) - pickedOf(it)), 0);
    return { totalProducts, todoProducts };
  }, [dataItems, total, done]);

  const showEmpty = uiState === 'EMPTY' && !splitMode && !currentProduct;

  /* ===================== RENDER ===================== */

  return (
    <div className={`${styles.root} ${xl ? styles.distanceOn : ''}`}>
      {/* Confetti overlay */}
      {batchCompleteFx && (
        <div className={styles.batchCompleteConfetti}>
          <div className={styles.batchCompleteGlow} />
          <div className={styles.confettiDot} style={{ left: '18%', top: '22%' }} />
          <div className={styles.confettiDot} style={{ left: '38%', top: '66%' }} />
          <div className={styles.confettiDot} style={{ left: '58%', top: '40%' }} />
          <div className={styles.confettiDot} style={{ left: '78%', top: '28%' }} />
        </div>
      )}

      {/* Toast (alleen single mode tonen) */}
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
              <a className={styles.navBtn} onClick={() => setXl((x) => !x)}>Station 1</a>
              <button onClick={() => setDebug((d) => !d)} className={styles.debugBtn}>
                Debug {debug ? '🔛' : '🔘'}
              </button>
            </nav>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <div className={styles.status}>
              <div className={styles.statusRow}>
                <span>Picklist: <strong>#{picklistId || '—'}</strong></span>
                {primaryCreatedBy && (
                  <span className={styles.creatorTopbar}>
                    <span className={styles.creatorDot} aria-hidden="true">{getInitials(primaryCreatedBy)}</span>
                    <span className={styles.creatorLabel}>Door</span>
                    <strong className={styles.creatorName}>{primaryCreatedBy}</strong>
                  </span>
                )}
                {!splitMode && (
                  <>
                    <span>Voortgang: <strong>{progress}%</strong></span>
                    <span>Totaal: <strong>{pickTotals.totalProducts}</strong></span>
                    <span>Nog te doen: <strong>{pickTotals.todoProducts}</strong></span>
                  </>
                )}
                <span className={styles.clock}>{now}</span>
              </div>
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

      {/* Main */}
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
              <RenderBatchMini b={batches[0]} fx={miniFx[String(batches[0].batchId)]} />
            </section>
            <section className={styles.splitPaneBottom}>
              <RenderBatchMini b={batches[1]} fx={miniFx[String(batches[1].batchId)]} />
            </section>
          </div>
        ) : currentProduct ? (
          <div className={styles.singleWrap}>
            <div className={styles.card}>
              {/* HERO locatie */}
              {(() => {
                const loc = String(currentProduct?.stocklocation ?? currentProduct?.stock_location ?? '—');
                const segs = loc.split(/[.\s-]+/).filter(Boolean);
                return (
                  <div
                    className={`${styles.heroSingle} ${singleFx.locPulse ? styles.heroSinglePulse : ''}`}
                    style={{ ['--zone' as any]: zoneColor(loc) }}
                    aria-label={`Locatie ${loc}`}
                  >
                    <span className={styles.zoneBadgeLg}>{zoneOf(loc) || '–'}</span>
                    <div className={styles.heroSegs}>
                      {segs.length ? segs.map((s, i) => (
                        <span key={s + i} className={styles.heroSeg}>{s}</span>
                      )) : <span className={styles.heroSeg}>—</span>}
                    </div>
                  </div>
                );
              })()}

              {/* FOTO + PROGRESS-RING */}
              <div
                className={styles.heroImageWrap}
                style={{
                  ['--zone' as any]: zoneColor(currentProduct?.stocklocation ?? currentProduct?.stock_location),
                  ['--prog' as any]: total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0,
                }}
              >
                <ProductImage
                  item={currentProduct}
                  max={260}
                  radius={16}
                  alt={currentProduct?.product || currentProduct?.name || 'Productfoto'}
                />
              </div>

              {/* NAAM + SKU */}
              <div className={styles.meta}>
                <div className={styles.productName}>{currentProduct?.product || currentProduct?.name || ''}</div>
                <div className={styles.sku}>SKU: <span style={{ fontFamily: 'ui-monospace' }}>{sku}</span></div>
              </div>

              {/* STATS */}
              <div className={styles.statsWide}>
                <div
                  className={`${styles.statCard} ${singleFx.bump ? styles.statFlash : ''}`}
                  style={{ ['--zone' as any]: zoneColor(currentProduct?.stocklocation ?? currentProduct?.stock_location) }}
                >
                  <div className={styles.statCardValue}>{done}</div>
                  <div className={styles.statCardLabel}>Gedaan</div>
                </div>
                <div className={styles.statCardMuted}>
                  <div className={styles.statCardValue}>{total}</div>
                  <div className={styles.statCardLabel}>Totaal</div>
                </div>
              </div>

              {/* VOLGENDE LOCATIES */}
              {nextLocations?.length > 0 && (
                <div className={styles.nextSection}>
                  <div className={styles.nextTitle}>Volgende locaties:</div>
                  <div className={styles.nextGrid}>
                    {nextLocations.map((L, i) => (
                      <div key={L + i} className={styles.badgeBig} style={{ ['--zone' as any]: zoneColor(L) }}>
                        {L}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : showEmpty ? (
          <div style={{ textAlign: 'center', marginTop: 64, color: '#888', fontSize: '1.5rem', fontWeight: 500 }}>
            Geen actieve batch of pickdata gevonden.
            <br />
            <span style={{ fontSize: '1rem', color: '#aaa' }}>Wacht op een nieuwe batch…</span>
          </div>
        ) : null}
      </main>
    </div>
  );
}
