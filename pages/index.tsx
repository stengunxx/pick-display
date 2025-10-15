// pages/index.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { zoneColor, zoneOf } from '../lib/picqer';

/* ===== performance knobs ===== */
const BASE_POLL_MS = 220;
const BURST_POLL_MS = 80;
const BURST_WINDOW_MS = 2000;
const TIMEOUT_MS = 2600;           // ruimer dan server call
const EMPTY_GRACE_MS = 400;
const STICKY_KEEP_MS = 5000;
const NEW_BANNER_MS = 1600;
const PICKLIST_CONFETTI_MS = 900;
const BATCH_CONFETTI_MS = 1400;

/* ===== utils ===== */
const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
const locOf    = (it: any) => (it?.stocklocation ?? it?.stock_location ?? '').toString();
const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);
const remOf    = (it: any) => Math.max(0, totalOf(it) - pickedOf(it));

async function fetchJson(url: string, timeoutMs: number, abort?: AbortSignal) {
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
      signal: abort ?? ctrl.signal,
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 160)}`);
    return txt ? JSON.parse(txt) : null;
  } finally { clearTimeout(t); }
}

/* ===== visuals ===== */
function ProductImage({ item, size = 200 }: { item: any; size?: number }) {
  const url = item?.imageUrl || item?.image_url || item?.image || '';
  return (
    <img
      src={url || '/placeholder.png'}
      alt={item?.product || item?.name || 'Product'}
      style={{
        width: size, height: size, borderRadius: 18,
        objectFit: 'cover', background: '#f2f2f2', border: '1px solid #e5e5e5'
      }}
    />
  );
}

function BigRow({ it }: { it: any }) {
  if (!it) return <RowSkeleton />;
  const name = it?.product ?? it?.name ?? it?.title ?? it?.omschrijving ?? it?.description ?? '—';
  const sku  = it?.productcode ?? it?.sku ?? '—';
  const loc  = String(it?.stocklocation ?? it?.stock_location ?? '—');
  const segs = loc.split(/[.\s-]+/).filter(Boolean);
  const tot  = totalOf(it);
  const done = pickedOf(it);
  return (
    <div style={S.row}>
      <div style={S.left}><ProductImage item={it} size={200} /></div>
      <div style={S.mid}>
        <div style={S.locWrap}>
          <div style={{ ...S.zoneMega, background: zoneColor(loc) || '#ffd166' }}>{zoneOf(loc) || '–'}</div>
          <div style={S.locMegaLine}>
            {segs.length ? segs.map((s, i) => (
              <span key={s + i} style={S.locMegaSeg}>
                {s}{i < segs.length - 1 && <span style={S.locMegaDot}>•</span>}
              </span>
            )) : <span style={{ color: '#94a3b8' }}>—</span>}
          </div>
        </div>
        <div style={S.title}>{name}</div>
        <div style={S.skuLine}>
          <span style={S.skuLabel}>SKU</span><span style={S.skuVal}>{sku}</span>
        </div>
      </div>
      <div style={S.vDivider} />
      <div style={S.right}>
        <div style={S.counterCard}>
          <div style={S.counterTop}>
            <span style={S.counterDone}>{done}</span>
            <span style={S.counterSlash}>/</span>
            <span style={S.counterTot}>{totalOf(it)}</span>
          </div>
          <div style={S.counterLbl}>GEPIKT / TOTAAL</div>
        </div>
        <div style={S.progressOuter}>
          <div style={{ ...S.progressFillGreen, width: `${totalOf(it) > 0 ? Math.min(100, (done / totalOf(it)) * 100) : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div style={S.row}>
      <div style={S.left}><div style={S.skelImg} /></div>
      <div style={S.mid}>
        <div style={S.skelTitleBig} />
        <div style={S.skelLine} />
        <div style={S.skelLineShort} />
      </div>
      <div style={S.vDivider} />
      <div style={S.right}>
        <div style={S.counterCard}><div style={S.skelCounter} /></div>
        <div style={S.progressOuter}><div style={{ ...S.progressFillGreen, width: '0%' }} /></div>
      </div>
    </div>
  );
}

function ConfettiBurst({ count = 120 }: { count?: number }) {
  const pieces = Array.from({ length: count }).map((_, i) => {
    const left = Math.random() * 100;
    const size = 6 + Math.random() * 10;
    const rot  = Math.random() * 360;
    const dur  = 900 + Math.random() * 900;
    const delay = Math.random() * 120;
    const colors = ['#10b981', '#22c55e', '#16a34a', '#86efac', '#34d399', '#059669', '#f59e0b', '#ef4444', '#3b82f6'];
    const bg = colors[i % colors.length];
    return (
      <div
        key={i}
        style={{
          position: 'fixed',
          top: -20,
          left: `${left}vw`,
          width: size,
          height: size * (0.5 + Math.random()),
          background: bg,
          transform: `rotate(${rot}deg)`,
          borderRadius: 3,
          opacity: 0.95,
          zIndex: 9999,
          pointerEvents: 'none',
          animation: `cf-fall ${dur}ms ease-in ${delay}ms forwards`,
        }}
      />
    );
  });
  return (
    <>
      <style>{`
        @keyframes cf-fall {
          0% { transform: translateY(-40px) rotate(0deg); opacity: .98; }
          70% { opacity: .98; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {pieces}
    </>
  );
}

/* ===== page ===== */
export default function IndexPage() {
  const [picklistId, setPicklistId] = useState<string>('—');
  const [creator, setCreator] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [phase, setPhase] = useState<'ACTIVE' | 'COMPLETED' | 'EMPTY'>('EMPTY');

  const [confettiCount, setConfettiCount] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loopRef = useRef<any>(null);
  const inflightRef = useRef<AbortController | null>(null);
  const burstUntilRef = useRef(0);
  const lastGoodItemsRef = useRef<{ ts: number; items: any[] } | null>(null);

  const prevBatchIdRef = useRef<string>('');
  const stickyBatchRef = useRef<{ id: string; ts: number } | null>(null);
  const prevPicklistIdRef = useRef<string>('');
  const prevPickTodoRef = useRef<number>(-1);

  const idAbsentSinceRef = useRef<number>(0);
  const armedBatchConfettiRef = useRef(false);

  // batches die we kort negeren (na "done"), MAAR NIET als we EMPTY zijn
  const ignoreBatchRef = useRef<{ id: string; until: number } | null>(null);

  // fase als ref
  const phaseRef = useRef<typeof phase>(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // markeer wanneer de huidige picklijst feitelijk leeg is
  const zeroSinceRef = useRef<number | 0>(0);

  // NIEUW: hoe lang “0 open” stabiel is op lastGood-items
  const zeroStableSinceRef = useRef<number | 0>(0);

  /* clock */
  const [now, setNow] = useState('');
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000);
    return () => clearInterval(t);
  }, []);

  const openItems = useMemo(() => items.filter(it => remOf(it) > 0), [items]);
  const top3 = useMemo(() => {
    const three = openItems.slice(0, 3);
    return three.concat(Array(Math.max(0, 3 - three.length)).fill(null));
  }, [openItems]);

  const total = items.reduce((s, it) => s + totalOf(it), 0);
  const done  = items.reduce((s, it) => s + pickedOf(it), 0);
  const todo  = Math.max(0, total - done);
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const showBanner = (text: string, ms = NEW_BANNER_MS) => { setBanner(text); setTimeout(() => setBanner(null), ms); };
  const burst = (ms = BURST_WINDOW_MS) => { burstUntilRef.current = Math.max(burstUntilRef.current, performance.now() + ms); };
  const firePicklistCompleted = () => { setConfettiCount(90); showBanner('Picklijst voltooid', NEW_BANNER_MS); setTimeout(() => setConfettiCount(null), PICKLIST_CONFETTI_MS); burst(1600); };
  const fireBatchCompleted = () => { setConfettiCount(170); showBanner('Batch voltooid', NEW_BANNER_MS); setTimeout(() => setConfettiCount(null), BATCH_CONFETTI_MS); setPhase('COMPLETED'); burst(2000); };

  const switchToEmpty = () => {
    setPhase('EMPTY');
    setItems([]);
    setPicklistId('—');
    setCreator(null);
    prevPicklistIdRef.current = '';
    prevPickTodoRef.current = -1;
    zeroSinceRef.current = 0;
    zeroStableSinceRef.current = 0;
    // 🆕 reset ignore direct → unvoltooien pakt meteen weer op
    ignoreBatchRef.current = null;
  };

  /* polling loop */
  useEffect(() => {
    let unmounted = false;

    const schedule = () => {
      if (unmounted) return;
      const fast = performance.now() < burstUntilRef.current;
      const delay = fast ? BURST_POLL_MS : BASE_POLL_MS;
      loopRef.current = setTimeout(tick, delay);
    };

    const currentBatchIdOrSticky = (ids: (string | number)[] | null | undefined) => {
      const now = Date.now();
      const ignoreActive = ignoreBatchRef.current && now < ignoreBatchRef.current.until;
      const ignoreId = ignoreActive ? ignoreBatchRef.current!.id : null;

      // Als we EMPTY zijn, NIET negeren → meteen pakken wat er is
      if (phaseRef.current === 'EMPTY') {
        if (ids && ids.length > 0) {
          const id = String(ids[0]);
          stickyBatchRef.current = { id, ts: now };
          return id;
        }
        if (stickyBatchRef.current && (now - stickyBatchRef.current.ts) < STICKY_KEEP_MS) {
          return stickyBatchRef.current.id;
        }
        return null;
      }

      if (ids && ids.length > 0) {
        const first = String(ids[0]);
        if (ignoreId && first === ignoreId) {
          const next = ids.length > 1 ? String(ids[1]) : null;
          if (next) {
            stickyBatchRef.current = { id: next, ts: now };
            return next;
          }
          return null;
        }
        stickyBatchRef.current = { id: first, ts: now };
        return first;
      }

      if (stickyBatchRef.current && (now - stickyBatchRef.current.ts) < STICKY_KEEP_MS) {
        if (!ignoreId || stickyBatchRef.current.id !== ignoreId) return stickyBatchRef.current.id;
      }
      return null;
    };

    const tick = async () => {
      if (unmounted) return;
      if (inflightRef.current) inflightRef.current.abort();
      const aborter = new AbortController();
      inflightRef.current = aborter;

      try {
        const bustQ = `_=${Date.now()}&t=${performance.now().toFixed(3)}`;
        const nb = await fetchJson(`/api/next-batch?${bustQ}`, TIMEOUT_MS, aborter.signal);

        const ids: (string | number)[] = Array.isArray(nb?.batchIds)
          ? nb.batchIds
          : (nb?.batchId ? [nb.batchId] : []);

        const chosen = currentBatchIdOrSticky(ids);

        if (!chosen) {
          if (!idAbsentSinceRef.current) idAbsentSinceRef.current = Date.now();

          if (Date.now() - idAbsentSinceRef.current >= EMPTY_GRACE_MS) {
            if (armedBatchConfettiRef.current) {
              fireBatchCompleted();
              armedBatchConfettiRef.current = false;
            }
            switchToEmpty();
          }
          return schedule();
        }
        idAbsentSinceRef.current = 0;

        // Nieuwe batch?
        if (!prevBatchIdRef.current || prevBatchIdRef.current !== chosen) {
          prevBatchIdRef.current = chosen;
          armedBatchConfettiRef.current = true; // gewapend voor confetti
          prevPicklistIdRef.current = '';
          prevPickTodoRef.current   = -1;
          zeroSinceRef.current = 0;
          zeroStableSinceRef.current = 0;
          burst();
        }

        // creator label (optioneel)
        let createdBy: string | null = null;
        if (Array.isArray(nb?.batches)) {
          const meta = nb.batches.find((b: any) => String(b?.batchId ?? '') === chosen);
          createdBy = meta?.createdBy ?? null;
        }

        // haal items (en picklist-debug) op
        const p = await fetchJson(`/api/next-pick?batchId=${chosen}&${bustQ}`, TIMEOUT_MS, aborter.signal);

        // === Pending-bridge: als picklijst net 0 was en we zien pending/rare gaps → behandel als done
        if (p && p.pending === true) {
          // als we eerder 0 open items zagen én dat is al even stabiel → done
          if (zeroStableSinceRef.current && (Date.now() - zeroStableSinceRef.current > 900)) {
            if (armedBatchConfettiRef.current) {
              fireBatchCompleted();
              armedBatchConfettiRef.current = false;
            }
            ignoreBatchRef.current = { id: String(chosen), until: Date.now() + 600 }; // kort zodat unvoltooien snel werkt
            stickyBatchRef.current = null;
            idAbsentSinceRef.current = Date.now();
            switchToEmpty();
            return schedule();
          }
          return schedule();
        }

        if (p && p.done === true) {
          if (armedBatchConfettiRef.current) {
            fireBatchCompleted();
            armedBatchConfettiRef.current = false;
          }
          ignoreBatchRef.current = { id: String(chosen), until: Date.now() + 600 }; // ⬅ verkort
          stickyBatchRef.current = null;
          idAbsentSinceRef.current = Date.now();
          switchToEmpty();
          return schedule();
        }

        // normaliseer items
        let arr: any[] = Array.isArray(p?.items)
          ? p.items.slice().sort((a: any, b: any) => collator.compare(locOf(a), locOf(b)))
          : [];

        // SWR: houd UI stabiel tot 5s bij korte hikjes
        if ((!arr || arr.length === 0) && lastGoodItemsRef.current && (Date.now() - lastGoodItemsRef.current.ts) < 5000) {
          arr = lastGoodItemsRef.current.items;
        } else if (arr && arr.length > 0) {
          lastGoodItemsRef.current = { ts: Date.now(), items: arr };
        }

        const debugPickId = String(p?.debug?.picklistId ?? '');
        const todoNow = arr.reduce((s, it) => s + remOf(it), 0);

        // Houd bij wanneer picklijst leeg werd (op actuele arr)
        if (todoNow === 0 && arr.length > 0) {
          if (!zeroSinceRef.current) zeroSinceRef.current = Date.now();
        } else {
          zeroSinceRef.current = 0;
        }

        // 🆕: ook kijken naar laatst-goede items om ‘stabiel 0’ te meten
        const lastGood = lastGoodItemsRef.current?.items ?? [];
        const lastGoodTodo = lastGood.reduce((s, it) => s + Math.max(0, totalOf(it) - pickedOf(it)), 0);
        if (lastGood.length > 0 && lastGoodTodo === 0) {
          if (!zeroStableSinceRef.current) zeroStableSinceRef.current = Date.now();
        } else {
          zeroStableSinceRef.current = 0;
        }

        // ===== PICKLIJST-SPECIFIEK
        if (debugPickId) {
          if (prevPicklistIdRef.current && prevPicklistIdRef.current !== debugPickId) {
            showBanner('Nieuwe picklijst', NEW_BANNER_MS);
            setConfettiCount(60);
            setTimeout(() => setConfettiCount(null), PICKLIST_CONFETTI_MS);
            burst();
            prevPickTodoRef.current = -1;
            zeroSinceRef.current = 0;
            zeroStableSinceRef.current = 0;
          }
          if (prevPicklistIdRef.current === debugPickId || !prevPicklistIdRef.current) {
            if (prevPickTodoRef.current !== -1 && prevPickTodoRef.current > 0 && todoNow === 0) {
              firePicklistCompleted();
            }
            prevPickTodoRef.current = todoNow;
          }
          prevPicklistIdRef.current = debugPickId;
        }

        // ===== UI set
        setPicklistId(chosen);
        setCreator(createdBy);
        setItems(arr);
        if (arr.length > 0 && phase !== 'ACTIVE') setPhase('ACTIVE');

        // burst bij meetbare verandering
        if (prevPickTodoRef.current !== -1 && prevPickTodoRef.current !== todoNow) burst();

      } catch {
        // negeer individuele poll fouten
      } finally {
        schedule();
      }
    };

    tick();
    return () => {
      unmounted = true;
      if (loopRef.current) clearTimeout(loopRef.current);
      if (inflightRef.current) inflightRef.current.abort();
    };
  }, [phase]);

  return (
    <div style={S.page}>
      {confettiCount != null && <ConfettiBurst count={confettiCount} />}
      <style>{`@keyframes fadeOutUp{0%{opacity:1;transform:translate(-50%,0)}70%{opacity:.98;transform:translate(-50%,-6px)}100%{opacity:0;transform:translate(-50%,-14px)}}`}</style>
      {banner && (<div style={S.banner}>{banner}</div>)}
      <header style={S.header}>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <span style={S.brand}>Pick Dashboard</span>
          <span style={S.badge}>Picklist #{picklistId}</span>
          {creator && <span style={S.badgeMuted}>Door {creator}</span>}
        </div>
        <div style={{ display:'flex', gap:18, alignItems:'center' }}>
          <span style={S.meta}>Voortgang: <b>{progress}%</b></span>
          <span style={S.meta}>Totaal: <b>{total}</b></span>
          <span style={S.meta}>Nog te doen: <b>{todo}</b></span>
          <span style={S.clock}>{now}</span>
        </div>
      </header>
      <div style={S.progressWrapHeader}><div style={{ ...S.progressFillHeader, width: `${progress}%` }} /></div>
      <main style={S.main}>
        {phase === 'EMPTY' ? (
          <div style={S.empty}>
            Geen actieve batch of pickdata gevonden.
            <div style={{ color: '#999', fontSize: 18, marginTop: 6 }}>Wacht op een nieuwe batch…</div>
          </div>
        ) : (
          <div style={S.rows}>
            {top3.map((it, i) => <BigRow key={(it?.productcode ?? it?.sku ?? 'slot') + ':' + i} it={it} />)}
          </div>
        )}
      </main>
    </div>
  );
}

/* ===== styles ===== */
const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#fff', color: '#0f172a', fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },

  header: { position: 'sticky', top: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', background: '#fff', borderBottom: '1px solid #eee' },
  brand: { fontWeight: 800, fontSize: 24 },
  badge: { background: '#1f6feb', color: '#fff', borderRadius: 999, padding: '7px 12px', fontSize: 14, fontWeight: 800 },
  badgeMuted: { background: '#eef2ff', color: '#334155', borderRadius: 999, padding: '7px 12px', fontSize: 14, fontWeight: 800 },
  meta: { fontSize: 16, color: '#334155' },
  clock: { fontVariantNumeric: 'tabular-nums', color: '#475569', fontSize: 16 },

  progressWrapHeader: { height: 8, background: '#f3f4f6', overflow: 'hidden' },
  progressFillHeader: { height: '100%', background: '#10b981', transition: 'width .22s ease' },

  main: { width: '100%', padding: '22px 24px 28px', minHeight: 'calc(100vh - 110px)' },

  rows: { display: 'grid', gridTemplateRows: 'repeat(3, minmax(0, 1fr))', gap: 18, height: 'calc(100vh - 160px)' },

  row: {
    display: 'grid',
    gridTemplateColumns: '260px 1fr 1px min(30vw, 380px)',
    alignItems: 'center',
    columnGap: 36,
    padding: 28,
    border: '1px solid #e5e7eb',
    background: '#fff',
    borderRadius: 26,
    boxShadow: '0 10px 30px rgba(2, 6, 23, 0.06)',
  },

  left: { display: 'flex', alignItems: 'center', justifyContent: 'center' },

  mid: { minWidth: 0 },
  locWrap: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10, flexWrap: 'wrap' },
  zoneMega: { padding: '10px 16px', borderRadius: 999, fontWeight: 900, fontSize: 26, color: '#0f172a', boxShadow: 'inset 0 0 0 1px rgba(15,23,42,.08)' },
  locMegaLine: { display: 'flex', alignItems: 'center', gap: 16, fontSize: 56, fontWeight: 900, letterSpacing: .5, color: '#0f172a', flexWrap: 'wrap' },
  locMegaSeg: { display: 'inline-flex', alignItems: 'center' },
  locMegaDot: { margin: '0 12px', color: '#cbd5e1', fontSize: 44 },

  title: { fontWeight: 800, fontSize: 26, color: '#111827', marginTop: 4, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },

  skuLine: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 },
  skuLabel: { fontSize: 13, color: '#6b7280', padding: '3px 9px', background: '#f3f4f6', borderRadius: 8, fontWeight: 800, letterSpacing: .2 },
  skuVal: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 18, fontWeight: 800 },

  vDivider: { width: 1, height: '70%', background: '#eef2f7', justifySelf: 'stretch' },

  right: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingRight: 18, justifySelf: 'end' },

  counterCard: { background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 16, padding: '12px 18px', minWidth: 200, textAlign: 'center', boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.03)' },
  counterTop: { display: 'flex', alignItems: 'baseline', gap: 10, justifyContent: 'center' },
  counterDone: { fontSize: 56, fontWeight: 900, color: '#111827' },
  counterSlash: { color: '#9ca3af', fontSize: 28, fontWeight: 800 },
  counterTot: { fontSize: 42, fontWeight: 900, color: '#334155' },
  counterLbl: { marginTop: 4, fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: '#64748b' },

  progressOuter: { width: 'min(30vw, 380px)', height: 12, background: '#eef2f7', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', alignSelf: 'center', marginRight: 12 },
  progressFillGreen: { height: '100%', background: '#10b981', transition: 'width .18s ease' },

  empty: { display: 'grid', placeItems: 'center', height: 'calc(100vh - 160px)', textAlign: 'center', color: '#6b7280', fontSize: 24 },

  skelImg: { width: 200, height: 200, borderRadius: 18, background: '#f3f4f6', border: '1px solid #eee' },
  skelTitleBig: { width: '70%', height: 56, borderRadius: 10, background: '#f3f4f6', marginBottom: 12 },
  skelLine: { width: '45%', height: 22, borderRadius: 8, background: '#f3f4f6', marginBottom: 8 },
  skelLineShort: { width: '28%', height: 20, borderRadius: 8, background: '#f3f4f6' },

  banner: {
    position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
    background: '#0f172a', color: '#fff', padding: '10px 18px', borderRadius: 999,
    zIndex: 30, fontWeight: 900, boxShadow: '0 10px 24px rgba(0,0,0,.25)',
    animation: `fadeOutUp ${NEW_BANNER_MS}ms forwards`,
    pointerEvents: 'none'
  },
};
