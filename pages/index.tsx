// pages/index.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../styles/PickDisplay.module.css';
import { zoneColor, zoneOf } from '../lib/picqer';

/* ===================== TUNABLES ===================== */
const POLL_MS = 220;             // hoofd polling interval
const FETCH_TIMEOUT_MS = 900;    // timeout per request
const CONFETTI_MS = 1000;        // confetti duur (ms)
const TOAST_MS = 1200;           // toast duur (ms)
const NO_ID_STREAK_MAX = 2;      // pas leeg tonen na X polls zonder batchIds (anti-flikker)

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
type MiniFxMap = Record<string, { locPulse?: boolean; bump?: boolean; __loc?: string; __done?: number }>;

const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
const locOf    = (it: any) => (it?.stocklocation ?? it?.stock_location ?? '').toString();
const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);

function getInitials(name?: string | null) {
  if (!name) return '—';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}
function signOut({ callbackUrl }: { callbackUrl: string }) {
  window.location.href = callbackUrl;
}
async function fetchJson(url: string, timeoutMs: number, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'x-no-cache': '1',
      },
      signal: signal ?? ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

/* ===================== DUMB COMPONENTS ===================== */
function ProductImage({ item, max, radius, alt }: { item: any; max?: number; radius?: number; alt?: string }) {
  const url = item?.imageUrl || item?.image_url || item?.image || '';
  return (
    <img
      src={url || '/placeholder.png'}
      alt={alt || 'Product'}
      style={{ width: max || 64, height: max || 64, borderRadius: radius || 8, objectFit: 'cover', background: '#eee' }}
    />
  );
}

function RenderBatchMini({ b, fx }: { b: BatchView; fx?: { locPulse?: boolean; bump?: boolean } }) {
  if (!b) return null;
  const cur = b.currentProduct;
  const loc = cur ? String(cur.stocklocation ?? cur.stock_location ?? '—') : '—';
  const parts = loc.split(/[.\s-]+/).filter(Boolean);

  return (
    <div className={styles.panel}>
      <div className={styles.panelCard}>
        <div className={`${styles.heroLoc} ${fx?.locPulse ? styles.heroLocPulse : ''}`} style={{ ['--zone' as any]: zoneColor(loc) }} aria-label={`Locatie ${loc}`}>
          <span className={styles.zoneBadge}>{zoneOf(loc) || '–'}</span>
          <div className={styles.locSegWrap}>
            {parts.length ? parts.map((p, i) => <span key={p + i} className={styles.locSeg}>{p}</span>) : <span className={styles.locSeg}>—</span>}
          </div>
        </div>

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
          <div className={styles.miniProgress}><i style={{ width: `${Math.max(0, Math.min(100, b.progress || 0))}%` }} /></div>
        </div>

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
                <span key={L + i} className={styles.chipSmall} style={{ ['--zone' as any]: zoneColor(L) }}>{L}</span>
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

  // single view
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

  // fx & toast
  const [singleFx, setSingleFx] = useState<{ locPulse: boolean; bump: boolean }>({ locPulse: false, bump: false });
  const [batchCompleteFx, setBatchCompleteFx] = useState(false);
  const [toast, setToast] = useState<{ text: string } | null>(null);
  const toastTimerRef = useRef<any>(null);
  const showToast = (text: string, ms = TOAST_MS) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text });
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  };

  // fase-machine
  type Phase = 'ACTIVE' | 'COMPLETED' | 'EMPTY';
  const [phase, setPhase] = useState<Phase>('EMPTY');

  // guards & refs
  const prevLocRef = useRef('');
  const prevDoneRef = useRef<number>(-1);
  const prevSkusRef = useRef<string[]>([]);
  const completionArmedRef = useRef(false); // set true wanneer we actieve picks hebben
  const noIdStreakRef = useRef(0);

  // loop controls
  const loopTimerRef = useRef<any>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  // klok
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const splitMode = batches.filter(b => b && b.currentProduct).length >= 2;

  const pickTotals = useMemo(() => {
    const items = Array.isArray(dataItems) ? dataItems : [];
    if (!items.length) return { totalProducts: total, todoProducts: Math.max(0, total - done) };
    const totalProducts = items.reduce((s, it) => s + totalOf(it), 0);
    const todoProducts  = items.reduce((s, it) => s + Math.max(0, totalOf(it) - pickedOf(it)), 0);
    return { totalProducts, todoProducts };
  }, [dataItems, total, done]);

  const switchToEmptyUI = () => {
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
    setPhase('EMPTY');
  };

  useEffect(() => {
    let unmounted = false;

    const loop = async () => {
      if (unmounted) return;

      // abort lopende fetch
      if (inFlightRef.current) { inFlightRef.current.abort(); inFlightRef.current = null; }
      const aborter = new AbortController();
      inFlightRef.current = aborter;

      try {
        const bust = `_=${Date.now()}&t=${performance.now().toFixed(3)}`;

        // 1) IDs ophalen
        const j = await fetchJson(`/api/next-batch?${bust}`, FETCH_TIMEOUT_MS, aborter.signal);
        const ids: (string | number)[] = Array.isArray(j?.batchIds) ? j.batchIds : (j?.batchId ? [j.batchId] : []);

        if (!ids || ids.length === 0) {
          // geen ids → tel korte streak tegen flikker
          noIdStreakRef.current += 1;
          if (noIdStreakRef.current >= NO_ID_STREAK_MAX) {
            completionArmedRef.current = false;
            if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); setToast(null); }
            setBatchCompleteFx(false);
            switchToEmptyUI();
          }
        } else {
          noIdStreakRef.current = 0;

          // 2) Picks ophalen
          const picks = await Promise.all(
            ids.slice(0, 2).map((id) =>
              fetchJson(`/api/next-pick?batchId=${id}&${bust}`, FETCH_TIMEOUT_MS, aborter.signal).catch(() => null)
            )
          );

          // createdBy-map
          const createdByMap = new Map<string, string | null>();
          if (Array.isArray(j?.batches)) {
            for (const b of j.batches) {
              const bid = String(b?.batchId ?? '');
              if (bid) createdByMap.set(bid, b?.createdBy ?? null);
            }
          }

          // 3) Views bouwen
          const views: BatchView[] = [];
          for (let i = 0; i < picks.length; i++) {
            const p = picks[i] as any;
            if (!p) continue;

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

          const todoSum = views.reduce((s, v) => s + Math.max(0, v.todoProducts || 0), 0);
          const hasViews = views.length > 0;
          const hasActive = hasViews && todoSum > 0;
          const allDoneNow = hasViews && todoSum === 0;

          /* ======= STATE MACHINE ======= */
          if (hasActive) {
            // ACTIVE
            if (phase !== 'ACTIVE') {
              setPhase('ACTIVE');
              completionArmedRef.current = true;           // vanaf hier mag completion weer triggeren
              // stop eventueel lingering UI
              if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); setToast(null); }
              setBatchCompleteFx(false);
            }

            // kies primary
            const active = views.filter(v => v.todoProducts > 0 && v.currentProduct);
            const primary = (active[0] ?? views.find(v => v.todoProducts > 0))!;

            // header
            setPicklistId(String(primary.batchId));
            setProgress(primary.progress);

            // animaties
            const loc = String(primary.currentProduct?.stocklocation ?? primary.currentProduct?.stock_location ?? '');
            const doneVal = primary.done;
            if (prevLocRef.current && prevLocRef.current !== loc) {
              setSingleFx(s => ({ ...s, locPulse: true }));
              setTimeout(() => setSingleFx(s => ({ ...s, locPulse: false })), 360);
            }
            prevLocRef.current = loc;
            if (prevDoneRef.current >= 0 && doneVal > prevDoneRef.current) {
              setSingleFx(s => ({ ...s, bump: true }));
              setTimeout(() => setSingleFx(s => ({ ...s, bump: false })), 520);
            }
            prevDoneRef.current = doneVal;

            // nieuwe picklijst?
            const currentSkus = Array.isArray(primary.items) ? primary.items.map(it => String(it.productcode ?? it.sku ?? '')) : [];
            if (prevSkusRef.current.length && currentSkus.length && prevSkusRef.current.join('|') !== currentSkus.join('|')) {
              showToast('Nieuwe picklijst', 900);
            }
            prevSkusRef.current = currentSkus;

            // miniFx + batches
            setBatches(active.length ? active : views);
            setMiniFx(prev => {
              const list = active.length ? active : views;
              const next: MiniFxMap = { ...prev };
              for (const v of list) {
                if (!v.currentProduct) continue;
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
                  setMiniFx(curr => ({ ...curr, [id]: { ...(curr[id] || {}), locPulse: false, bump: false } }));
                }, locChanged ? 420 : 260);
              }
              Object.keys(next).forEach(k => { if (!views.some(v => String(v.batchId) === String(k))) delete (next as any)[k]; });
              return next;
            });

            // single data
            setCurrentProduct(primary.currentProduct ?? null);
            setDataItems(Array.isArray(primary.items) ? primary.items : []);
            setSku(primary.sku);
            setDone(primary.done);
            setTotal(primary.total);
            setNextLocations(primary.nextLocations);
            setPrimaryCreatedBy(primary.createdBy ?? null);

          } else if (allDoneNow) {
            // DIRECT naar COMPLETED als we ge-armed waren
            if (completionArmedRef.current && phase !== 'COMPLETED') {
              completionArmedRef.current = false; // disarm, éénmalig
              setPhase('COMPLETED');
              setBatchCompleteFx(true);
              showToast('Batch voltooid', TOAST_MS);

              // meteen doorzetten naar EMPTY na confetti
              setTimeout(() => {
                setBatchCompleteFx(false);
                switchToEmptyUI();
              }, CONFETTI_MS);
            }
          } else {
            // Geen views → laat huidige UI staan; ID-streak regelt lege staat
          }
        }
      } catch {
        // fout/timeout → UI laten zoals hij is
      } finally {
        loopTimerRef.current = setTimeout(loop, POLL_MS);
      }
    };

    loop();
    return () => {
      unmounted = true;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (inFlightRef.current) inFlightRef.current.abort();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [phase]);

  const showEmpty = phase === 'EMPTY' && !splitMode && !currentProduct;

  /* ===================== RENDER ===================== */
  return (
    <div className={`${styles.root} ${xl ? styles.distanceOn : ''}`}>
      {/* Confetti */}
      {batchCompleteFx && (
        <div className={styles.batchCompleteConfetti}>
          <div className={styles.batchCompleteGlow} />
          <div className={styles.confettiDot} style={{ left: '18%', top: '22%' }} />
          <div className={styles.confettiDot} style={{ left: '38%', top: '66%' }} />
          <div className={styles.confettiDot} style={{ left: '58%', top: '40%' }} />
          <div className={styles.confettiDot} style={{ left: '78%', top: '28%' }} />
        </div>
      )}

      {/* Toast */}
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
              <a className={styles.navBtn} onClick={() => setXl(x => !x)}>Station 1</a>
              <button onClick={() => setDebug(d => !d)} className={styles.debugBtn}>Debug {debug ? '🔛' : '🔘'}</button>
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
                    <span>Totaal: <strong>{(Array.isArray(dataItems) ? dataItems.reduce((s, it) => s + totalOf(it), 0) : total)}</strong></span>
                    <span>Nog te doen: <strong>{(Array.isArray(dataItems) ? dataItems.reduce((s, it) => s + Math.max(0, totalOf(it) - pickedOf(it)), 0) : Math.max(0, total - done))}</strong></span>
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
              style={{ background: '#222', color: '#ffd166', borderRadius: 8, padding: '6px 16px', border: '1px solid #ffd166', fontWeight: 600, cursor: 'pointer' }}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className={styles.main}>
        {splitMode ? (
          <div className={styles.splitWrap}>
            <section className={styles.splitPaneTop}>
              <RenderBatchMini b={batches[0]} fx={{}} />
            </section>
            <section className={styles.splitPaneBottom}>
              <RenderBatchMini b={batches[1]} fx={{}} />
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
                  <div className={`${styles.heroSingle} ${singleFx.locPulse ? styles.heroSinglePulse : ''}`} style={{ ['--zone' as any]: zoneColor(loc) }} aria-label={`Locatie ${loc}`}>
                    <span className={styles.zoneBadgeLg}>{zoneOf(loc) || '–'}</span>
                    <div className={styles.heroSegs}>
                      {segs.length ? segs.map((s, i) => <span key={s + i} className={styles.heroSeg}>{s}</span>) : <span className={styles.heroSeg}>—</span>}
                    </div>
                  </div>
                );
              })()}

              {/* FOTO + PROGRESS-RING */}
              <div className={styles.heroImageWrap} style={{
                ['--zone' as any]: zoneColor(currentProduct?.stocklocation ?? currentProduct?.stock_location),
                ['--prog' as any]: total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0,
              }}>
                <ProductImage item={currentProduct} max={260} radius={16} alt={currentProduct?.product || currentProduct?.name || 'Productfoto'} />
              </div>

              {/* NAAM + SKU */}
              <div className={styles.meta}>
                <div className={styles.productName}>{currentProduct?.product || currentProduct?.name || ''}</div>
                <div className={styles.sku}>SKU: <span style={{ fontFamily: 'ui-monospace' }}>{sku}</span></div>
              </div>

              {/* STATS */}
              <div className={styles.statsWide}>
                <div className={`${styles.statCard} ${singleFx.bump ? styles.statFlash : ''}`} style={{ ['--zone' as any]: zoneColor(currentProduct?.stocklocation ?? currentProduct?.stock_location) }}>
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
                      <div key={L + i} className={styles.badgeBig} style={{ ['--zone' as any]: zoneColor(L) }}>{L}</div>
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
        ) : (
          <div /> /* korte tussenfase */
        )}
      </main>
    </div>
  );
}
