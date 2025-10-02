import { useEffect, useState, useRef } from 'react';
import { signOut } from "next-auth/react";
import styles from '../styles/PickDisplay.module.css';

type BatchView = {
  batchId: string | number;
  items: any[];
  currentProduct: any | null;
  product: string;
  sku: string;
  done: number;
  total: number;
  progress: number;
  nextLocations: string[];
};

type PickData = {
  location: string;
  product: string;
  debug?: { picklistId?: number | string; itemId?: number | string };
  items?: any[];
  nextLocations?: string[];
  done?: boolean;
};

// Removed old renderBatchMini helper (duplicate)

function renderBatchMini(b: BatchView, styles: any) {
  if (!b) return null;
  const cur = b.currentProduct;
  const loc = cur ? (cur.stocklocation || cur.stock_location || "—") : "—";
  return (
    <div className={styles.panel}>
      <div className={styles.panelCard}>
        <div className={styles.panelTitle}>
          Batch #{String(b.batchId)} • Voortgang: {b.progress}%
        </div>
        <div className={styles.progressMini} style={{} as React.CSSProperties}>
          <i style={{width: `${b.progress}%`}} />
        </div>
        <h1 className={styles.locationSplit}>
          <span style={{display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{loc}</span>
        </h1>
        <div className={styles.metaSplit}>
          <div className={styles.productNameSplit}>{b.product}</div>
          <div className={styles.skuSplit}>SKU: <span style={{fontFamily:"ui-monospace"}}>{b.sku}</span></div>
        </div>
        <div className={styles.statsSplit}>
          <div>
            <div className={styles.statValue}>{b.done}</div>
            <div className={styles.statLabel}>Gedaan</div>
          </div>
          <div>
            <div className={styles.statValue}>{b.total}</div>
            <div className={styles.statLabel}>Totaal</div>
          </div>
        </div>
        {Array.isArray(b.nextLocations) && b.nextLocations.length > 0 && (
          <div className={styles.nextSplit}>
            <div className={styles.nextSplitTitle}>Volgende locaties:</div>
            <div style={{display:"flex",justifyContent:"center",gap:"10px",flexWrap:"wrap"}}>
              {b.nextLocations.map((loc: string, i: number) => (
                <span key={loc + String(i)} className={styles.badge}>{loc}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [batches, setBatches] = useState<BatchView[]>([]);
  const lockedBatchIds = useRef<(string | number)[] | null>(null);
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
  const [showLocAnim, setShowLocAnim] = useState(false);
  const prevLoc = useRef<string>("");
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
  const pollInterval = 1000;

  useEffect(() => {
    let isUnmounted = false;
    const normLoc = (x: any) => (x ?? "").toString();
    const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
    const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);
    function computeViewFromPickData(pickData: any): { view: Omit<BatchView, "batchId"> & { currentProduct: any | null } } {
      const rawItems = Array.isArray(pickData.items) ? pickData.items : [];
      const sortedItems = rawItems.slice().sort((a: any, b: any) =>
        normLoc(a.stocklocation ?? a.stock_location)
          .localeCompare(normLoc(b.stocklocation ?? b.stock_location), "nl", { numeric: true, sensitivity: "base" })
      );
      const currentProductObj = sortedItems.find((it: any) => pickedOf(it) < totalOf(it)) ?? null;
      const prog = sortedItems.length
        ? Math.round((sortedItems.filter((it: any) => pickedOf(it) >= totalOf(it)).length / sortedItems.length) * 100)
        : 0;
      let nextLocs: string[] = [];
      if (currentProductObj) {
        const curIdx = sortedItems.findIndex((it: any) => it === currentProductObj);
        const curLoc = normLoc(currentProductObj.stocklocation ?? currentProductObj.stock_location);
        const incompleteIdxs = sortedItems
          .map((it: any, idx: number) => ({ it, idx }))
          .filter(({ it }: { it: any }) => pickedOf(it) < totalOf(it))
          .map(({ idx }: { idx: number }) => idx);
        if (curIdx !== -1) {
          nextLocs = incompleteIdxs
            .filter((idx: number) => idx > curIdx)
            .map((idx: number) => normLoc(sortedItems[idx].stocklocation ?? sortedItems[idx].stock_location))
            .filter((loc: any) => loc && loc !== curLoc);
          const seen = new Set<string>();
          nextLocs = nextLocs.filter((loc: any) => (seen.has(loc) ? false : (seen.add(loc), true)));
        }
      }
      return {
        view: {
          items: sortedItems,
          currentProduct: currentProductObj,
          product:
            (currentProductObj?.product ??
              currentProductObj?.name ??
              currentProductObj?.title ??
              currentProductObj?.omschrijving ??
              currentProductObj?.description ??
              pickData.product ??
              "") as string,
          sku:
            (currentProductObj?.productcode ??
              currentProductObj?.sku ??
              "") as string,
          done: currentProductObj ? pickedOf(currentProductObj) : 0,
          total: currentProductObj ? totalOf(currentProductObj) : 0,
          progress: prog,
          nextLocations: nextLocs,
        },
      };
    }
    const fetchData = async () => {
      try {
        let batchIds: (string | number)[] = [];
        if (!lockedBatchIds.current) {
          const batchRes = await fetch('/api/next-batch');
          const batchJson = await batchRes.json();
          batchIds = batchJson.batchIds ?? (batchJson.batchId ? [batchJson.batchId] : []);
          lockedBatchIds.current = batchIds;
        } else {
          batchIds = lockedBatchIds.current;
        }
        const settled = await Promise.allSettled(batchIds.map(id => fetch(`/api/next-pick?batchId=${id}`).then(r => r.json())));
        const views: BatchView[] = [];
        settled.forEach((r, i) => {
          if (r.status === "fulfilled") {
            const { view } = computeViewFromPickData(r.value);
            views.push({ batchId: batchIds[i], ...view });
          }
        });
        setBatches(views);
        const primary = views[0];
        if (primary) {
          setCurrentProduct(primary.currentProduct);
          setData({ location: primary.currentProduct?.stocklocation ?? primary.currentProduct?.stock_location ?? "", product: primary.product, items: primary.items });
          setSku(primary.sku);
          setDone(primary.done);
          setTotal(primary.total);
          setProgress(primary.progress);
          setNextLocations(primary.nextLocations);
          setPicklistId(String(batchIds[0] ?? ""));
        }
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
        ) : (batches.length === 0 && (!picklistId || !Array.isArray(data.items) || data.items.length === 0)) ? (
          <div style={{textAlign:'center',marginTop:64,color:'#888',fontSize:'1.5rem',fontWeight:500}}>
            Geen actieve batch of pickdata gevonden.<br />
            <span style={{fontSize:'1rem',color:'#aaa'}}>Wacht op een nieuwe batch in Picqer...</span>
          </div>
        ) : (batches.length >= 2) ? (
          <div className={styles.splitWrap}>
            <section className={styles.splitPaneTop}>
              {renderBatchMini(batches[0], styles)}
            </section>
            <section className={styles.splitPaneBottom}>
              {renderBatchMini(batches[1], styles)}
            </section>
          </div>
        ) : (
          <div className={styles.card}>
            <div style={{textAlign:'center',color:'#aaa',fontSize:'1.1rem',marginBottom:'0.5rem'}}>
              Picklist totaal: {Array.isArray(data.items) ? data.items.reduce((sum, it) => sum + (it.amount ?? it.amount_to_pick ?? 0), 0) : 0} producten<br />
              Nog te doen: {Array.isArray(data.items) ? data.items.filter((it) => (it.amountpicked ?? it.amount_picked ?? 0) < (it.amount ?? it.amount_to_pick ?? 0)).reduce((sum, it) => sum + ((it.amount ?? it.amount_to_pick ?? 0) - (it.amountpicked ?? it.amount_picked ?? 0)), 0) : 0}
              <div style={{margin:'12px auto 0 auto',width:'100%',maxWidth:320,height:12,background:'#222',borderRadius:8,overflow:'hidden',boxShadow:'0 1px 8px #0004'}}>
                <div style={{height:'100%',background:'#ffd166',width:`${progress}%`,transition:'width 0.4s',borderRadius:8}}></div>
              </div>
            </div>
            <h1 className={styles.location} style={{marginTop: 0, marginBottom: '0.2em'}}>
              <span style={{
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
              }}>
                {currentProduct ? (currentProduct.stocklocation || currentProduct.stock_location || "—") : "—"}
              </span>
            </h1>
            <div className={styles.meta}>
              <div className={styles.productName}>{currentProduct ? (currentProduct.product || currentProduct.name || currentProduct.title || currentProduct.omschrijving || currentProduct.description || '') : (data.product || '')}</div>
              <div className={styles.sku}>SKU: <span style={{fontFamily:'ui-monospace'}}>{sku}</span></div>
            </div>
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
        )}
      </main>
    </div>
  );
}


