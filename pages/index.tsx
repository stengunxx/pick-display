// pages/index.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { zoneColor, zoneOf } from '../lib/picqer';

/* ===== kleine confetti ===== */
function ConfettiBurst({ count = 60 }: { count?: number }) {
  const pieces = React.useMemo(() =>
    Array.from({ length: count }).map((_, i) => {
      const size = 18 + Math.random() * 16;
      const rot = Math.random() * 360;
      const dur = 900 + Math.random() * 900;
      const delay = Math.random() * 400;
      const bg = `hsl(${Math.round(180 + Math.random() * 180)},${60 + Math.random() * 30}%,${60 + Math.random() * 30}%)`;
      return (
        <div
          key={i}
          style={{
            position: 'fixed',
            left: `${12 + Math.random() * 76}%`,
            top: '-40px',
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
    }), [count]
  );
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

/* ===== timers & drempels ===== */
const BASE_POLL_MS = 260;
const BURST_POLL_MS = 90;
const BURST_WINDOW_MS = 2000;
const TIMEOUT_MS = 2600;

const NEW_BANNER_MS = 1600;
const PICKLIST_CONFETTI_MS = 900;
const BATCH_CONFETTI_MS = 1400;

/** Kort negeren na voltooien; unvoltooien moet snel */
const IGNORE_AFTER_DONE_MS = 1200;

/** Stabiliteit tegen flip-flops */
const STICKY_MS = 8000;          // minimaal vast aan gekozen batch
const ERROR_TOL = 8;             // opeenvolgende 502/pending/lege responsen
const DONE_CONFIRM = 2;          // done:true moet 2x achter elkaar

/* ===== helpers ===== */
const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });
const locOf = (it: any) => (it?.stocklocation ?? it?.stock_location ?? '').toString();
const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);
const remOf    = (it: any) => Math.max(0, totalOf(it) - pickedOf(it));

async function fetchJson(url: string, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  } finally {
    clearTimeout(t);
  }
}

/* ===== pagina ===== */
type Phase = 'ACTIVE' | 'LOADING' | 'EMPTY';

export default function IndexPage() {
  const [phase, setPhase] = useState<Phase>('EMPTY');
  const [picklistId, setPicklistId] = useState<string>('—');
  const [creator, setCreator] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [confettiCount, setConfettiCount] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const burstUntilRef = useRef(0);
  const loopRef = useRef<any>(null);

  const stickyBatchRef = useRef<{ id: string; stickUntil: number } | null>(null);
  const ignoreBatchRef = useRef<{ id: string; until: number } | null>(null);

  const errorStreakRef = useRef(0);
  const doneStreakRef = useRef(0);
  const lastPicklistIdRef = useRef<string>('');
  const lastTodoRef = useRef<number>(-1);

  const openItems = useMemo(() => items.filter((it: any) => remOf(it) > 0), [items]);
  const topRows = useMemo(() => openItems.slice(0, 3), [openItems]);

  const total = items.reduce((s, it) => s + totalOf(it), 0);
  const done  = items.reduce((s, it) => s + pickedOf(it), 0);
  const todo  = Math.max(0, total - done);
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const bustQ = () => `_=${Date.now()}&t=${performance.now().toFixed(3)}`;
  const showBanner = (t: string) => { setBanner(t); setTimeout(() => setBanner(null), NEW_BANNER_MS); };
  const burst = (ms = BURST_WINDOW_MS) => { burstUntilRef.current = Math.max(burstUntilRef.current, performance.now() + ms); };
  const firePicklistCompleted = () => { setConfettiCount(90); showBanner('Picklijst voltooid'); setTimeout(() => setConfettiCount(null), PICKLIST_CONFETTI_MS); burst(1600); };
  const fireBatchCompleted   = () => { setConfettiCount(140); showBanner('Batch voltooid'); setTimeout(() => setConfettiCount(null), BATCH_CONFETTI_MS); burst(2000); };

  /* === API helpers === */
  const getOpenBatchIds = async (): Promise<string[]> => {
    const nb = await fetchJson(`/api/next-batch?${bustQ()}`, TIMEOUT_MS).catch(() => null);
    return Array.isArray(nb?.batchIds)
      ? nb.batchIds.map(String)
      : (nb?.batchId ? [String(nb.batchId)] : []);
  };

  const loadBatch = async (id: string): Promise<boolean> => {
    const p = await fetchJson(`/api/next-pick?batchId=${id}&${bustQ()}`, TIMEOUT_MS).catch(() => null);
    if (!p || p.pending || p.done) return false;
    const arr: any[] = Array.isArray(p.items) ? p.items : [];
    if (!arr.length) return false;

    const sorted = arr.slice().sort((a, b) => collator.compare(locOf(a), locOf(b)));

    stickyBatchRef.current = { id, stickUntil: Date.now() + STICKY_MS };
    ignoreBatchRef.current = null;            // als we expliciet kiezen, niet blokkeren
    errorStreakRef.current = 0;
    doneStreakRef.current = 0;

    setPicklistId(id);
    setCreator(p?.creator || null);
    setItems(sorted);
    setPhase('ACTIVE');

    // picklist-meldingen (stabilized: alleen bij ECHTE overgang)
    const dbgPick = String(p?.debug?.picklistId ?? '');
    const todoNow = sorted.reduce((s, it) => s + remOf(it), 0);
    if (dbgPick) {
      if (lastPicklistIdRef.current && lastPicklistIdRef.current !== dbgPick) {
        showBanner('Nieuwe picklijst');
        setConfettiCount(60);
        setTimeout(() => setConfettiCount(null), PICKLIST_CONFETTI_MS);
        burst();
        lastTodoRef.current = -1;
      }
      if (lastPicklistIdRef.current === dbgPick || !lastPicklistIdRef.current) {
        if (lastTodoRef.current > 0 && todoNow === 0) firePicklistCompleted();
        lastTodoRef.current = todoNow;
      }
      lastPicklistIdRef.current = dbgPick;
    }
    return true;
  };

  const chooseFirstOpen = async (): Promise<boolean> => {
    const ids = await getOpenBatchIds();
    if (!ids.length) return false;

    // sla een id over als hij nog heel kort op ignore staat
    const ign = ignoreBatchRef.current;
    for (const id of ids) {
      const ignored = ign && Date.now() < ign.until && ign.id === id;
      if (ignored) continue;
      const ok = await loadBatch(id);
      if (ok) return true;
    }
    // als alles “ignored”, probeer de eerste toch
    if (ign && ids[0] === ign.id) {
      const ok = await loadBatch(ids[0]);
      if (ok) return true;
    }
    return false;
  };

  /* === main loop === */
  useEffect(() => {
    let stop = false;

    const schedule = () => {
      if (stop) return;
      const fast = performance.now() < burstUntilRef.current;
      const ms = fast ? BURST_POLL_MS : BASE_POLL_MS;
      loopRef.current = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (stop) return;

      const sticky = stickyBatchRef.current;
      const chosen = sticky?.id ?? null;

      // nog niets gekozen → kies de eerste open en pin hem even
      if (!chosen) {
        const ok = await chooseFirstOpen();
        setPhase(ok ? 'ACTIVE' : 'EMPTY');
        return schedule();
      }

      // we hebben een sticky batch; vraag de items op
      const p = await fetchJson(`/api/next-pick?batchId=${chosen}&${bustQ()}`, TIMEOUT_MS).catch(() => null);

      // fouten / pending → geen switches zolang sticky-tijd loopt
      if (!p || p.pending) {
        errorStreakRef.current += 1;
        if (Date.now() > (sticky?.stickUntil ?? 0) && errorStreakRef.current >= ERROR_TOL) {
          // sticky verlopen + veel fouten → kies opnieuw
          const ok = await chooseFirstOpen();
          if (!ok) setPhase('EMPTY');
        }
        return schedule();
      }

      // valide respons vanaf hier → reset errorStreak
      errorStreakRef.current = 0;

      if (p.done === true) {
        doneStreakRef.current += 1;
        // alleen wegschakelen als done bevestigd is EN sticky verlopen
        if (doneStreakRef.current >= DONE_CONFIRM && Date.now() > (sticky?.stickUntil ?? 0)) {
          fireBatchCompleted();
          ignoreBatchRef.current = { id: chosen, until: Date.now() + IGNORE_AFTER_DONE_MS };
          stickyBatchRef.current = null;
          const ok = await chooseFirstOpen();
          setPhase(ok ? 'ACTIVE' : 'EMPTY');
        }
        return schedule();
      } else {
        doneStreakRef.current = 0;
      }

      const arr: any[] = Array.isArray(p.items) ? p.items : [];
      if (!arr.length) {
        // geen items, maar niet done → blijf sticky; na sticky-periode mag herkiezen
        if (Date.now() > (sticky?.stickUntil ?? 0)) {
          const ok = await chooseFirstOpen();
          if (!ok) setPhase('EMPTY');
        }
        return schedule();
      }

      // update items
      const sorted = arr.slice().sort((a: any, b: any) => collator.compare(locOf(a), locOf(b)));
      setItems(sorted);
      setPicklistId(String(chosen));
      setCreator(p?.creator || null);
      if (phase !== 'ACTIVE') setPhase('ACTIVE');

      // picklist-meldingen (stabiel)
      const dbgPick = String(p?.debug?.picklistId ?? '');
      const todoNow = sorted.reduce((s, it) => s + remOf(it), 0);
      if (dbgPick) {
        if (lastPicklistIdRef.current && lastPicklistIdRef.current !== dbgPick) {
          showBanner('Nieuwe picklijst');
          setConfettiCount(60);
          setTimeout(() => setConfettiCount(null), PICKLIST_CONFETTI_MS);
          burst();
          lastTodoRef.current = -1;
        }
        if (lastPicklistIdRef.current === dbgPick || !lastPicklistIdRef.current) {
          if (lastTodoRef.current > 0 && todoNow === 0) firePicklistCompleted();
          lastTodoRef.current = todoNow;
        }
        lastPicklistIdRef.current = dbgPick;
      }

      // na sticky-periode mag er gewisseld worden als “eerste open” anders is (maar pas als we niet bezig zijn)
      if (Date.now() > (sticky?.stickUntil ?? 0)) {
        const ids = await getOpenBatchIds();
        if (ids.length && ids[0] !== chosen) {
          await loadBatch(ids[0]); // poging; lukt alleen bij geldige items
        }
      }

      return schedule();
    };

    tick();
    return () => { stop = true; clearTimeout(loopRef.current); };
  }, []); // mount once

  /* ===== klok ===== */
  const [now, setNow] = useState('');
  useEffect(() => {
    const t = setInterval(() =>
      setNow(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000);
    return () => clearInterval(t);
  }, []);

  // NextUpBar
  const [nextLocs, setNextLocs] = useState<string[]>([]);
  useEffect(() => setNextLocs([...new Set(openItems.map(locOf).filter(Boolean))]), [openItems]);

  function NextUpBar() {
    if (!nextLocs.length) return null;
    return (
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', borderRadius: 14, border: '1px solid #e5e7eb',
          background: '#f8fafc', margin: '8px 24px 0', overflowX: 'auto', scrollbarWidth: 'thin',
        }}
      >
        <span style={{fontWeight:900, fontSize:14, letterSpacing:.4, color:'#0f172a', flexShrink:0}}>VOLGENDE</span>
        {nextLocs.map((loc, i) => (
          <span
            key={loc+i}
            style={{
              display:'inline-flex', alignItems:'center', gap:10, padding:'6px 10px',
              borderRadius:999, background:'#fff', border:'1px solid #e5e7eb', fontWeight:800, flexShrink:0
            }}
          >
            <span style={{
              width:22, height:22, borderRadius:999, display:'grid', placeItems:'center',
              fontSize:12, fontWeight:900, background: zoneColor(loc) || '#e2e8f0', color:'#0f172a'
            }}>{(loc.split(/[.\s-]+/)[0] || '–').slice(0,1)}</span>
            <span style={{fontSize:18, fontWeight:900}}>{loc.split(/[.\s-]+/).join(' • ')}</span>
            {i < nextLocs.length-1 && <span style={{opacity:.35,fontWeight:900}}>➜</span>}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div style={S.page}>
      {confettiCount != null && <ConfettiBurst count={confettiCount} />}
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
          <span style={S.clock}>{now}</span>
        </div>
      </header>

      <div style={S.progressWrapHeader}>
        <div style={{ ...S.progressFillHeader, width: `${progress}%` }} />
      </div>

      <NextUpBar/>

      <span style={{
        background:'#0f172a', color:'#fff', borderRadius:999, padding:'6px 12px',
        fontWeight:900, letterSpacing:.3,
        position:'fixed', top:18, right:24, zIndex:40
      }}>Nog: {todo}</span>

      <main style={S.main}>
        {phase === 'EMPTY' ? (
          <div style={S.empty}>
            <div>Geen actieve batch of pickdata gevonden.</div>
            <div style={{ color: '#999', fontSize: 18, marginTop: 6 }}>Wacht op een nieuwe batch…</div>
          </div>
        ) : phase === 'LOADING' ? (
          <div style={S.empty}><div>Volgende batch laden…</div></div>
        ) : (
          <div style={S.rows}>
            {topRows.map((it, i) => <BigRow key={(it?.productcode ?? it?.sku ?? 'slot') + ':' + i} it={it} />)}
          </div>
        )}
      </main>
    </div>
  );
}

/* ===== componenten ===== */
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

/** Linker verticale vulbalk: blauw → groen, groeit bottom-up */
function LeftProgressStrip({ ratio }: { ratio: number }) {
  const r = Math.max(0, Math.min(1, ratio));
  return (
    <div style={{
      position:'absolute', left:0, top:0, bottom:0, width:12,
      background:'#eaf2ff',
      borderTopLeftRadius:26, borderBottomLeftRadius:26,
      boxShadow:'inset 0 0 0 1px rgba(2,6,23,.06)'
    }}>
      <div style={{
        position:'absolute', left:0, right:0, bottom:0,
        height: `${r*100}%`,
        transition:'height .65s cubic-bezier(.25,.9,.25,1)',
        background: 'linear-gradient(180deg, #3b82f6 0%, #10b981 100%)',
        borderBottomLeftRadius:26,
        borderTopLeftRadius: r === 1 ? 26 : 2
      }}/>
    </div>
  );
}

function BigRow({ it }: { it: any }) {
  if (!it) return null;

  const name = it?.product ?? it?.name ?? '—';
  const sku  = it?.productcode ?? it?.sku ?? '—';
  const loc  = String(it?.stocklocation ?? it?.stock_location ?? '—');
  const segs = loc.split(/[.\s-]+/).filter(Boolean);

  const tot  = totalOf(it);
  const done = pickedOf(it);
  const ratio = tot > 0 ? done / tot : 0;

  return (
    <div style={{ ...S.row, position:'relative', overflow:'hidden' }}>
      <LeftProgressStrip ratio={ratio} />
      <div style={S.left}><ProductImage item={it} size={180} /></div>

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
        <div style={S.skuLine}><span style={S.skuLabel}>SKU</span><span style={S.skuVal}>{sku}</span></div>
      </div>

      <div style={S.vDivider} />

      <div style={S.right}>
        <div style={S.counterCard}>
          <div style={S.counterTop}>
            <span style={S.counterDone}>{done}</span>
            <span style={S.counterSlash}>/</span>
            <span style={S.counterTot}>{tot}</span>
          </div>
          <div style={S.counterLbl}>GEPIKT / TOTAAL</div>
        </div>
        <div style={S.progressOuter}>
          <div style={{ ...S.progressFillGreen, width: `${tot > 0 ? Math.min(100, (done / tot) * 100) : 0}%` }} />
        </div>
      </div>
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
  progressFillHeader: { height: '100%', background: '#10b981', transition: 'width .65s cubic-bezier(.25,.9,.25,1)', willChange: 'width' },

  main: { width: '100%', padding: '22px 24px 28px', minHeight: 'calc(100vh - 110px)' },

  rows: { display: 'grid', gridTemplateRows: 'repeat(3, minmax(0, 1fr))', gap: 18 },

  row: { display: 'grid', gridTemplateColumns: '220px 1fr 1px 240px', alignItems: 'center', columnGap: 28, padding: '26px 32px', borderRadius: 26, background: '#fff', overflow: 'hidden', boxShadow: '0 4px 20px rgba(2, 6, 23, 0.04)' },

  left: { display: 'flex', alignItems: 'center', justifyContent: 'center' },

  mid: { minWidth: 0 },
  locWrap: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10, flexWrap: 'wrap' },
  zoneMega: { padding: '10px 16px', borderRadius: 999, fontWeight: 900, fontSize: 26, color: '#0f172a', boxShadow: 'inset 0 0 0 1px rgba(15,23,42,.08)' },
  locMegaLine: { display: 'flex', alignItems: 'center', gap: 16, fontSize: 40, fontWeight: 900, letterSpacing: .5, color: '#0f172a', flexWrap: 'wrap' },
  locMegaSeg: { display: 'inline-flex', alignItems: 'center' },
  locMegaDot: { margin: '0 12px', color: '#cbd5e1', fontSize: 32 },

  title: { fontWeight: 800, fontSize: 24, color: '#111827', marginTop: 4, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },

  skuLine: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 },
  skuLabel: { fontSize: 13, color: '#6b7280', padding: '3px 9px', background: '#f3f4f6', borderRadius: 8, fontWeight: 800, letterSpacing: .2 },
  skuVal: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace', fontSize: 18, fontWeight: 800 },

  vDivider: { width: 1, height: '70%', background: '#eef2f7', justifySelf: 'stretch' },

  right: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingRight: 18, justifySelf: 'end' },

  counterCard: { background: '#f8fafc', border: "1px solid #e5e7eb", borderRadius: 16, padding: '12px 18px', minWidth: 200, textAlign: 'center', boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.03)' },
  counterTop: { display: 'flex', alignItems: 'baseline', gap: 10, justifyContent: 'center' },
  counterDone: { fontSize: 42, fontWeight: 900, color: '#111827' },
  counterSlash: { color: '#9ca3af', fontSize: 28, fontWeight: 800 },
  counterTot: { fontSize: 36, fontWeight: 900, color: '#334155' },
  counterLbl: { marginTop: 4, fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: '#64748b' },

  progressOuter: { width: 240, height: 10, background: '#eef2f7', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb', alignSelf: 'center', marginRight: 12 },
  progressFillGreen: { height: '100%', background: '#10b981', transition: 'width .65s cubic-bezier(.25,.9,.25,1)', willChange: 'width' },

  empty: { display: 'grid', placeItems: 'center', height: 'calc(100vh - 160px)', textAlign: 'center', color: '#6b7280', fontSize: 24 },

  banner: { position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', background: '#0f172a', color: '#fff', padding: '10px 18px', borderRadius: 999, zIndex: 30, fontWeight: 900, boxShadow: '0 10px 24px rgba(0,0,0,.25)' },
};
