import { useEffect, useState, useRef } from 'react';
import { signOut } from "next-auth/react";
import styles from '../styles/PickDisplay.module.css';

type PickData = {
  location: string;
  product: string;
  debug?: { picklistId?: number | string; itemId?: number | string };
  items?: any[];
  nextLocations?: string[];
  done?: boolean;
};

export default function HomePage() {
  // Klok/timer state
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const updateClock = () => {
      const d = new Date();
      setNow(d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);
  // Highlight animatie voor locatie
  const [showLocAnim, setShowLocAnim] = useState(false);
  const prevLoc = useRef<string>("");
  // Visuele feedback state
  const [showPickedAnim, setShowPickedAnim] = useState(false);
  const prevDone = useRef<number>(0);
  const [currentProduct, setCurrentProduct] = useState<any | null>(null);
  const [data, setData] = useState<PickData>({ location: '', product: '' });
  const [sku, setSku] = useState<string>('');
  const [done, setDone] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [picklistId, setPicklistId] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [nextLocations, setNextLocations] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [showError, setShowError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [debug, setDebug] = useState<boolean>(false);
  const [showNewPicklist, setShowNewPicklist] = useState<boolean>(false);
  const lastPicklistId = useRef<string>('');
  const lockedBatchId = useRef<string | null>(null);
  // Polling interval vast op 1 seconde
  const pollInterval = 1000;

  useEffect(() => {
  let isUnmounted = false;
    const fetchData = async () => {
      try {
        let batchId = lockedBatchId.current;
        if (!batchId) {
          const batchRes = await fetch('/api/next-batch');
          if (!batchRes.ok) {
            const t = await batchRes.json().catch(() => ({}));
            throw new Error(t?.error || 'Geen open pickbatch gevonden');
          }
          const batchData = await batchRes.json();
          batchId = batchData.batchId;
          lockedBatchId.current = batchId;
        }
        const pickRes = await fetch(`/api/next-pick?batchId=${batchId}`);
        let pickData: PickData;
        if (!pickRes.ok) {
          // Probeer JSON te parsen, maar alleen als er body is
          const text = await pickRes.text();
          let t = {};
          if (text && text.trim().length > 0) {
            try { t = JSON.parse(text); } catch {}
          }
          throw new Error((t as any)?.error || 'Geen pick data gevonden');
        } else {
          // Alleen JSON parsen als er body is
          const text = await pickRes.text();
          if (text && text.trim().length > 0) {
            pickData = JSON.parse(text);
          } else {
            pickData = { location: '', product: '' };
          }
        }
        if (isUnmounted) return;
        // Als batch klaar is of niet meer bestaat, unlock en forceer nieuwe batch
        // --- helpers ---
        const normLoc = (x: any) => (x ?? "").toString();
        const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
        const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);

        // --- sorteer items op locatie (natuurlijk sorteren) ---
        const rawItems = Array.isArray(pickData.items) ? pickData.items : [];
        const sortedItems = rawItems.slice().sort((a, b) =>
          normLoc(a.stocklocation ?? a.stock_location)
            .localeCompare(normLoc(b.stocklocation ?? b.stock_location), "nl", { numeric: true, sensitivity: "base" })
        );

        // --- bepaal huidige product: eerste onvoltooide ---
        const currentProductObj =
          sortedItems.find((it) => pickedOf(it) < totalOf(it)) ?? null;

        // --- picklist gewisseld? reset UI-flitsers en nextLocations ---
        const newPicklistId = String(pickData.debug?.picklistId || "");
        if (newPicklistId && newPicklistId !== lastPicklistId.current) {
          setShowNewPicklist(true);
          setTimeout(() => setShowNewPicklist(false), 2000);
          setNextLocations([]); // reset
        }
        setPicklistId(newPicklistId);
        lastPicklistId.current = newPicklistId;

        // --- als alles klaar is ---
        if (!currentProductObj) {
          setCurrentProduct(null);
          setData({ ...pickData, items: sortedItems, location: "", product: "" });
          setSku("");
          setDone(0);
          setTotal(0);
          setNextLocations([]);
          const prog = sortedItems.length
            ? Math.round(
                (sortedItems.filter((it) => pickedOf(it) >= totalOf(it)).length / sortedItems.length) * 100
              )
            : 0;
          setProgress(prog);
          // Fallback bij incomplete/lege batch
          if (!pickData.items || pickData.items.length === 0) {
            setError("Batch heeft geen pick-items. Wacht op nieuwe batch in Picqer...");
          } else {
            setError("");
          }
          lockedBatchId.current = null; // reset zodat nieuwe batch opgehaald wordt
          // Herlaad direct
          setTimeout(() => fetchData(), 100);
          return;
        }

        // --- UI state voor huidig item (gebruik currentProductObj, NIET state) ---
        // --- UI state voor huidig item (gebruik currentProductObj, NIET state) ---
        const locStr = normLoc(currentProductObj.stocklocation ?? currentProductObj.stock_location);
        // Highlight animatie bij locatie-wissel
        if (locStr !== prevLoc.current) {
          setShowLocAnim(true);
          setTimeout(() => setShowLocAnim(false), 700);
        }
        prevLoc.current = locStr;

        // zet huidige product + basis UI
        setCurrentProduct(currentProductObj);
        setData({
          ...pickData,
          items: sortedItems,
          location: locStr,
          product:
            (currentProductObj as any).product ??
            (currentProductObj as any).name ??
            (currentProductObj as any).title ??
            (currentProductObj as any).omschrijving ??
            (currentProductObj as any).description ??
            "",
        });
        setSku(
          (currentProductObj as any).productcode ??
          (currentProductObj as any).sku ??
          ""
        );
        setDone(pickedOf(currentProductObj));
        // Visuele feedback bij pick-actie: alleen als done verandert
        if (pickedOf(currentProductObj) !== prevDone.current) {
          setShowPickedAnim(true);
          setTimeout(() => setShowPickedAnim(false), 600);
        }
        prevDone.current = pickedOf(currentProductObj);
        setTotal(totalOf(currentProductObj));

        // --- volgende locaties ---
        // 1) indices van onvoltooide items
        const incompleteIdxs: number[] = sortedItems
          .map((it: any, idx: number) => ({ it, idx }))
          .filter(({ it }) => pickedOf(it) < totalOf(it))
          .map(({ idx }) => idx);

        // 2) index van huidige in de gesorteerde lijst
        const curIdx = sortedItems.findIndex((it: any) => it === currentProductObj);

        // 3) neem alleen items NÁ de huidige, map naar locaties, filter leeg/zelfde, dedupe
        let nextLocs: string[] = [];
        if (curIdx !== -1) {
          nextLocs = incompleteIdxs
            .filter((idx) => idx > curIdx)
            .map((idx) => normLoc(sortedItems[idx].stocklocation ?? sortedItems[idx].stock_location))
            .filter((loc) => loc && loc !== locStr);

          const seen = new Set<string>();
          nextLocs = nextLocs.filter((loc) => (seen.has(loc) ? false : (seen.add(loc), true)));
        }
        setNextLocations(nextLocs);

        // --- progress: volledig gepickte items / totaal ---
        const prog = sortedItems.length
          ? Math.round(
              (sortedItems.filter((it: any) => pickedOf(it) >= totalOf(it)).length / sortedItems.length) * 100
            )
          : 0;
        setProgress(prog);
        setError("");
      } catch (err: any) {
        setError(err.message || 'Onbekende fout');
        setShowError(true);
      } finally {
        if (!isUnmounted) setLoading(false);
      }
    };
  fetchData();
  const interval = setInterval(fetchData, pollInterval);
    return () => {
      isUnmounted = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className={styles.root}>
      {showNewPicklist && (
        <div style={{position:'fixed',top:70,left:'50%',transform:'translateX(-50%)',zIndex:1000,background:'#ffd166',color:'#222',fontWeight:700,fontSize:'1.5rem',padding:'0.75rem 2.5rem',borderRadius:'1.5rem',boxShadow:'0 2px 24px #0008',border:'2px solid #ffe7b3'}}>Nieuwe picklijst!</div>
      )}
      <header className={styles.topbar}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%'}}>
          <div style={{display:'flex',alignItems:'center'}}>
            <nav className={styles.nav}>
              <a className={styles.navBtn}>Home</a>
              <a className={styles.navBtn}>Station 1</a>
              <button onClick={() => setDebug((d: boolean) => !d)} className={styles.debugBtn}>Debug {debug ? '🔛' : '🔘'}</button>
            </nav>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'0.5em'}}>
            <div className={styles.status}>
              <span>Picklist: <span>#{picklistId || "—"}</span></span>
              <span style={{marginLeft: 16}}>Voortgang: <span>{progress}%</span></span>
              <span style={{marginLeft: 16,color:'#ffd166',fontWeight:700}}>{now}</span>
            </div>
            <button onClick={() => signOut({ callbackUrl: "/login" })} className={styles.navBtn} style={{background:'#222',color:'#ffd166',borderRadius:8,padding:'6px 16px',border:'1px solid #ffd166',fontWeight:600,cursor:'pointer'}}>Uitloggen</button>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        {loading ? (
          <h1 style={{fontWeight:900,fontSize:'3rem',textAlign:'center'}}>Loading...</h1>
        ) : error ? (
          <div style={{textAlign:'center',marginTop:64,color:'#d33',fontSize:'1.5rem',fontWeight:500}}>
            {error}<br />
            <span style={{fontSize:'1rem',color:'#aaa'}}>Controleer Picqer of probeer opnieuw...</span>
          </div>
        ) : !picklistId || !data.items || data.items.length === 0 ? (
          <div style={{textAlign:'center',marginTop:64,color:'#888',fontSize:'1.5rem',fontWeight:500}}>
            Geen actieve batch of pickdata gevonden.<br />
            <span style={{fontSize:'1rem',color:'#aaa'}}>Wacht op een nieuwe batch in Picqer...</span>
          </div>
        ) : (
          <div className={styles.card}>
            <div>
              {/* Picklist totaal */}
              <div style={{textAlign:'center',color:'#aaa',fontSize:'1.1rem',marginBottom:'0.5rem'}}>
                Picklist totaal: {
                  Array.isArray(data.items)
                    ? data.items.reduce((sum, it) => sum + (it.amount ?? it.amount_to_pick ?? 0), 0)
                    : 0
                } producten<br />
                Nog te doen: {
                  Array.isArray(data.items)
                    ? data.items.filter((it) => (it.amountpicked ?? it.amount_picked ?? 0) < (it.amount ?? it.amount_to_pick ?? 0)).reduce((sum, it) => sum + ((it.amount ?? it.amount_to_pick ?? 0) - (it.amountpicked ?? it.amount_picked ?? 0)), 0)
                    : 0
                }
                <div style={{margin:'12px auto 0 auto',width:'100%',maxWidth:320,height:12,background:'#222',borderRadius:8,overflow:'hidden',boxShadow:'0 1px 8px #0004'}}>
                  <div style={{height:'100%',background:'#ffd166',width:`${progress}%`,transition:'width 0.4s',borderRadius:8}}></div>
                </div>
              </div>
              {/* mega locatie */}
                <h1 className={styles.location} style={{marginTop: 0, marginBottom: '0.2em'}}>
                  <span
                    
                    style={{
                      overflow:'hidden',
                      textOverflow:'ellipsis',
                      whiteSpace:'nowrap',
                      display:'block',
                      border: showLocAnim ? '4px solid #ffd166' : '4px solid transparent',
                      boxShadow: 'none',
                      transition:'all 0.3s',
                      borderRadius: '1.2em',
                      padding: '0.2em 0.5em',
                      marginTop: 0
                    }}
                  >
                    {currentProduct ? (currentProduct.stocklocation || currentProduct.stock_location || "—") : "—"}
                  </span>
                </h1>
              {/* product en sku */}
              <div className={styles.meta}>
                <div className={styles.productName}>{
                  currentProduct ? (
                    currentProduct.product ||
                    currentProduct.name ||
                    currentProduct.title ||
                    currentProduct.omschrijving ||
                    currentProduct.description ||
                    ''
                  ) : (data.product || '')
                }</div>
                <div className={styles.sku}>SKU: <span style={{fontFamily:'ui-monospace'}}>{sku}</span></div>
              </div>
              {/* stats */}
              <div className={styles.stats}>
                <div>
                  <div className={styles.statValue} style={showPickedAnim ? {background:'#2ecc40',color:'#fff',borderRadius:12,transition:'all 0.3s'} : {transition:'all 0.3s'}}>
                    {currentProduct ? (currentProduct.amountpicked ?? currentProduct.amount_picked ?? 0) : done}
                  </div>
                  <div className={styles.statLabel}>Gedaan</div>
                </div>
                <div>
                  <div className={styles.statValue}>{currentProduct ? (currentProduct.amount ?? 0) : total}</div>
                  <div className={styles.statLabel}>Totaal</div>
                </div>
              </div>
              {/* volgende locaties */}
              {nextLocations && nextLocations.length > 0 && (
                <div className={styles.nextSection} style={{marginTop:'1.5em',textAlign:'center'}}>
                  <div className={styles.nextTitle} style={{fontSize:'2.5rem',fontWeight:900,marginBottom:'0.5em',letterSpacing:'0.02em'}}>Volgende locaties:</div>
                  <div style={{display:'flex',justifyContent:'center',gap:'2.5em',flexWrap:'wrap'}}>
                    {nextLocations.map((loc, i) => (
                      <div key={loc+String(i)} style={{fontSize:'2.2rem',fontWeight:900,padding:'0.3em 1.2em',borderRadius:'1em',background:'#222',color:'#ffd166',boxShadow:'0 2px 16px #0006',margin:'0.2em 0'}}>
                        {loc}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Debug info */}
              {debug && (
                <pre style={{marginTop:32,background:'#121214',borderRadius:16,padding:16,fontSize:12,maxWidth:600,overflowX:'auto',border:'1px solid #2a2a2e'}}>
                  {JSON.stringify({
                    data,
                    firstItem: data.items && data.items.length > 0 ? data.items[0] : null,
                    currentProduct
                  }, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}


