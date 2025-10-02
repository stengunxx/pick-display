import { useEffect, useState, useRef } from "react";
import { signOut } from "next-auth/react";
import styles from "../styles/PickDisplay.module.css";

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

function renderBatchMini(b: BatchView, styles: any) {
  if (!b) return null;
  const cur = b.currentProduct;
  const loc = cur ? cur.stocklocation || cur.stock_location || "—" : "—";
  return (
    <div className={styles.panel}>
      <div className={styles.panelCard}>
        <div className={styles.panelTitle}>
          Batch #{String(b.batchId)} • Voortgang: {b.progress}%
        </div>
        <div className={styles.progressMini}>
          <i style={{ width: `${Math.max(0, Math.min(100, b.progress || 0))}%` }} />
        </div>
        <h1 className={styles.locationSplit}>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {loc}
          </span>
        </h1>
        <div className={styles.metaSplit}>
          <div className={styles.productNameSplit}>{b.product}</div>
          <div className={styles.skuSplit}>
            SKU: <span style={{ fontFamily: "ui-monospace" }}>{b.sku}</span>
          </div>
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
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              {b.nextLocations.map((loc: string, i: number) => (
                <span key={loc + String(i)} className={styles.badge}>
                  {loc}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  // ----- UI state -----
  const [batches, setBatches] = useState<BatchView[]>([]);
  const batchIdsRef = useRef<(string | number)[]>([]);
  const [now, setNow] = useState<string>("");
  const [currentProduct, setCurrentProduct] = useState<any | null>(null);
  const [data, setData] = useState<PickData>({ location: "", product: "" });
  const [sku, setSku] = useState<string>("");
  const [done, setDone] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [picklistId, setPicklistId] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [nextLocations, setNextLocations] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [debug, setDebug] = useState<boolean>(false);
  const [showNewPicklist, setShowNewPicklist] = useState<boolean>(false);

  // anti-flicker (gebruik laatste geldige view een paar ticks)
  const lastGoodViewsRef = useRef<BatchView[] | null>(null);
  const emptyTicksRef = useRef(0);
  const EMPTY_TICKS_GRACE = 3;

  // klokje
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // helpers
  const normLoc = (x: any) => (x ?? "").toString();
  const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
  const totalOf = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);

  function computeViewFromPickData(pickData: any): Omit<BatchView, "batchId"> & { currentProduct: any | null } {
    const rawItems = Array.isArray(pickData.items) ? pickData.items : [];
    const items = Array.isArray(pickData.items) ? pickData.items.slice().sort((a: any, b: any) => collator.compare(locOf(a), locOf(b))) : [];

    const current = items.find((it: any) => pickedOf(it) < totalOf(it)) ?? null;

    const prog = items.length
      ? Math.round((items.filter((it: any) => pickedOf(it) >= totalOf(it)).length / items.length) * 100)
      : 0;

    let nextLocs: string[] = [];
    if (current) {
      const curIdx = items.findIndex((x: any) => x === current);
      const curLoc = normLoc(current.stocklocation ?? current.stock_location);
      const seen = new Set<string>();
      nextLocs = items
        .map((it: any, idx: number) => ({ it, idx }))
        .filter(({ it, idx }: any) => idx > curIdx && pickedOf(it) < totalOf(it))
        .map(({ it }: any) => normLoc(it.stocklocation ?? it.stock_location))
        .filter((loc: string) => loc && loc !== curLoc && (seen.has(loc) ? false : (seen.add(loc), true)));
    }

    return {
      items,
      currentProduct: current,
      product:
        (current?.product ??
          current?.name ??
          current?.title ??
          current?.omschrijving ??
          current?.description ??
          pickData.product ??
          "") as string,
      sku: (current?.productcode ?? current?.sku ?? "") as string,
      done: current ? pickedOf(current) : 0,
      total: current ? totalOf(current) : 0,
      progress: prog,
      nextLocations: nextLocs,
    };
  }

  async function refreshBatchIds(): Promise<(string | number)[]> {
    try {
      const r = await fetch("/api/next-batch");
      const j = await r.json();
      const ids: (string | number)[] = Array.isArray(j.batchIds) ? j.batchIds : j.batchId ? [j.batchId] : [];

      const prev = (batchIdsRef.current || []).join(",");
      const next = ids.join(",");
      if (prev && next && prev !== next) {
        setShowNewPicklist(true);
        setTimeout(() => setShowNewPicklist(false), 1200);
      }

      batchIdsRef.current = ids.slice(0, 2); // max 2 batches
      return batchIdsRef.current;
    } catch {
      return batchIdsRef.current || [];
    }
  }

  const noCache = {
    cache: "no-store" as const,
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" }
  };
  const collator = new Intl.Collator("nl", { numeric: true, sensitivity: "base" });
  const locOf = (it: any) => (it?.stocklocation ?? it?.stock_location ?? "").toString();
  const pollDelayRef = useRef(1000);
  const turboUntilRef = useRef(0);

  // polling: pump loop met AbortController en no-store
  useEffect(() => {
    let unmounted = false;
    let ctrl: AbortController | null = null;
    let timer: any = null;

    const fetchOnce = async () => {
      try {
        // cancel eventueel vorige tick
        ctrl?.abort();
        ctrl = new AbortController();
        const signal = ctrl.signal;

        const bust = `_=${Date.now() % 1e7}`;
        // 1) batch-ids
        const j = await fetch(`/api/next-batch?${bust}`, { ...noCache, signal }).then(r => r.json());
        const ids: (string | number)[] = Array.isArray(j.batchIds) ? j.batchIds : (j.batchId ? [j.batchId] : []);

        if (!ids || ids.length === 0) {
          setLoading(false);   // loader uitzetten als er geen batches zijn
          // geen hard reset hier; laat oude UI staan (scheelt flicker + werk)
          return;
        }

        // 2) data per batch
        const settled = await Promise.allSettled(
          ids.slice(0, 2).map(id =>
            fetch(`/api/next-pick?batchId=${id}&${bust}`, { ...noCache, signal }).then(r => r.json())
          )
        );

        // helpers (lokaal hier zodat V8 ze inline’t)
        const normLoc  = (x: any) => (x ?? "").toString();
        const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
        const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);

        const views: BatchView[] = [];

        for (let i = 0; i < settled.length; i++) {
          const res = settled[i];
          if (res.status !== "fulfilled") continue;
          const p = res.value;

          const items = Array.isArray(p.items)
            ? p.items.slice().sort((a: any, b: any) => collator.compare(locOf(a), locOf(b)))
            : [];

          // current
          const cur = items.find((it: any) => pickedOf(it) < totalOf(it)) ?? null;

          // progress
          const prog = items.length
            ? Math.round((items.filter((it: any) => pickedOf(it) >= totalOf(it)).length / items.length) * 100)
            : 0;

          // next locations
          let nextLocs: string[] = [];
          if (cur) {
            const curIdx = items.findIndex((x: any) => x === cur);
            const curLoc = normLoc(cur.stocklocation ?? cur.stock_location);
            const seen = new Set<string>();
            nextLocs = items
              .map((it: any, idx: number) => ({ it, idx }))
              .filter(({ it, idx }: { it: any; idx: number }) => idx > curIdx && pickedOf(it) < totalOf(it))
              .map(({ it }: { it: any }) => normLoc(it.stocklocation ?? it.stock_location))
              .filter((loc: string) => loc && loc !== curLoc && (seen.has(loc) ? false : (seen.add(loc), true)));
          }

          views.push({
            batchId: ids[i],
            items: [], // niet nodig voor UI hier
            currentProduct: cur,
            product: (cur?.product ?? cur?.name ?? cur?.title ?? cur?.omschrijving ?? cur?.description ?? p.product ?? "") as string,
            sku: (cur?.productcode ?? cur?.sku ?? "") as string,
            done: cur ? pickedOf(cur) : 0,
            total: cur ? totalOf(cur) : 0,
            progress: prog,
            nextLocations: nextLocs,
          });
        }

        // alleen batches met currentProduct tonen
        const active = views.filter(v => v.currentProduct);

        // ---- minimal setState: alleen updaten als er echt iets is veranderd ----
        setBatches(prev => {
          if (sameBatchList(prev, active)) return prev;
          return active;
        });

        const primary = active[0];
        if (primary) {
          updatePrimaryIfChanged(primary);
        }
        setError(""); // geen grote error UI, alleen intern bijhouden
        setLoading(false); // loader uit na succesvolle tick

      } catch (e: any) {
        if (e?.name === "AbortError") return; // genegeerd, nieuwe tick start al
        setError(e?.message || "");           // UI blijft staan
        setLoading(false); // loader uit bij error
      }
    };

    const loop = async () => {
      if (unmounted) return;
      await fetchOnce();
      if (unmounted) return;
      // turbo zolang een recente wijziging gedetecteerd is
      const now = Date.now();
      pollDelayRef.current = now < turboUntilRef.current ? 250 : 1000;
      timer = setTimeout(loop, pollDelayRef.current);
    };

    loop();
    return () => { unmounted = true; ctrl?.abort(); if (timer) clearTimeout(timer); };
  }, []);

  // vergelijk twee lijsten met batches heel goedkoop
  function sameBatchList(a: BatchView[], b: BatchView[]) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!sameBatch(a[i], b[i])) return false;
    }
    return true;
  }
  function sameBatch(a: BatchView, b: BatchView) {
    if (!a || !b) return false;
    const locA = a.currentProduct?.stocklocation ?? a.currentProduct?.stock_location ?? "";
    const locB = b.currentProduct?.stocklocation ?? b.currentProduct?.stock_location ?? "";
    return (
      a.batchId === b.batchId &&
      a.sku === b.sku &&
      a.product === b.product &&
      a.done === b.done &&
      a.total === b.total &&
      a.progress === b.progress &&
      locA === locB &&
      a.nextLocations.join("|") === b.nextLocations.join("|")
    );
  }

  // update de 'single view' velden alleen als er iets verandert
  const lastPrimarySigRef = useRef("");
  function updatePrimaryIfChanged(p: BatchView) {
    const loc = p.currentProduct?.stocklocation ?? p.currentProduct?.stock_location ?? "";
    const sig = `${p.batchId}|${p.sku}|${p.product}|${p.done}|${p.total}|${p.progress}|${loc}|${p.nextLocations.join(",")}`;
    if (lastPrimarySigRef.current !== sig) {
      // wijziging → turbo 8s
      turboUntilRef.current = Date.now() + 8000;
      lastPrimarySigRef.current = sig;
    }
    // minimale setState calls
    setCurrentProduct(p.currentProduct);
    setData({ location: loc, product: p.product, items: [] }); // items niet nodig voor render
    setSku(p.sku);
    setDone(p.done);
    setTotal(p.total);
    setProgress(p.progress);
    setNextLocations(p.nextLocations);
    setPicklistId(String(p.batchId ?? ""));
  }

  const activeBatches = batches.filter((b) => b && b.currentProduct);

  return (
    <div className={styles.root}>
      {showNewPicklist && (
        <div
          style={{
            position: "fixed",
            top: 70,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "#ffd166",
            color: "#222",
            fontWeight: 700,
            fontSize: "1.5rem",
            padding: "0.75rem 2.5rem",
            borderRadius: "1.5rem",
            boxShadow: "0 2px 24px #0008",
            border: "2px solid #ffe7b3",
          }}
        >
          Nieuwe picklijst!
        </div>
      )}

      <header className={styles.topbar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <nav className={styles.nav}>
              <a className={styles.navBtn}>Home</a>
              <a className={styles.navBtn}>Station 1</a>
              <button onClick={() => setDebug((d) => !d)} className={styles.debugBtn}>
                Debug {debug ? "🔛" : "🔘"}
              </button>
            </nav>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5em" }}>
            <div className={styles.status}>
              <span>
                Picklist: <span>#{picklistId || "—"}</span>
              </span>
              <span style={{ marginLeft: 16 }}>
                Voortgang: <span>{progress}%</span>
              </span>
              <span style={{ marginLeft: 16, color: "#ffd166", fontWeight: 700 }}>{now}</span>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className={styles.navBtn}
              style={{
                background: "#222",
                color: "#ffd166",
                borderRadius: 8,
                padding: "6px 16px",
                border: "1px solid #ffd166",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <h1 style={{ fontWeight: 900, fontSize: "3rem", textAlign: "center" }}>Loading...</h1>
        ) : error ? (
          <div style={{ textAlign: "center", marginTop: 64, color: "#d33", fontSize: "1.5rem", fontWeight: 500 }}>
            {error}
            <br />
            <span style={{ fontSize: "1rem", color: "#aaa" }}>Controleer Picqer of probeer opnieuw...</span>
          </div>
        ) : activeBatches.length >= 2 ? (
          <div className={styles.splitWrap}>
            <section className={styles.splitPaneTop}>{renderBatchMini(activeBatches[0], styles)}</section>
            <section className={styles.splitPaneBottom}>{renderBatchMini(activeBatches[1], styles)}</section>
          </div>
        ) : currentProduct ? (
          <div className={styles.singleWrap}>
            <div className={styles.card}>
              <div style={{ textAlign: "center", color: "#aaa", fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                Picklist totaal: {Array.isArray(data.items) ? data.items.reduce((sum, it) => sum + (it.amount ?? it.amount_to_pick ?? 0), 0) : 0} producten
                <br />
                Nog te doen: {Array.isArray(data.items) ? data.items.filter((it) => (it.amountpicked ?? it.amount_picked ?? 0) < (it.amount ?? it.amount_to_pick ?? 0)).reduce((sum, it) => sum + ((it.amount ?? it.amount_to_pick ?? 0) - (it.amountpicked ?? it.amount_picked ?? 0)), 0) : 0}
                <div
                  style={{
                    margin: "12px auto 0 auto",
                    width: "100%",
                    maxWidth: 320,
                    height: 12,
                    background: "#222",
                    borderRadius: 8,
                    overflow: "hidden",
                    boxShadow: "0 1px 8px #0004",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      background: "#ffd166",
                      width: `${progress}%`,
                      transition: "width 0.4s",
                      borderRadius: 8,
                    }}
                  />
                </div>
              </div>

              <h1 className={styles.location} style={{ marginTop: 0, marginBottom: "0.2em" }}>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                    border: "4px solid transparent",
                    boxShadow: "none",
                    transition: "all 0.3s",
                    borderRadius: "1.2em",
                    padding: "0.2em 0.5em",
                    marginTop: 0,
                  }}
                >
                  {currentProduct ? currentProduct.stocklocation || currentProduct.stock_location || "—" : "—"}
                </span>
              </h1>

              <div className={styles.meta}>
                <div className={styles.productName}>
                  {currentProduct
                    ? currentProduct.product ||
                      currentProduct.name ||
                      currentProduct.title ||
                      currentProduct.omschrijving ||
                      currentProduct.description ||
                      ""
                    : data.product || ""}
                </div>
                <div className={styles.sku}>
                  SKU: <span style={{ fontFamily: "ui-monospace" }}>{sku}</span>
                </div>
              </div>

              <div className={styles.stats}>
                <div>
                  <div className={styles.statValue}>
                    {currentProduct ? currentProduct.amountpicked ?? currentProduct.amount_picked ?? 0 : done}
                  </div>
                  <div className={styles.statLabel}>Gedaan</div>
                </div>
                <div>
                  <div className={styles.statValue}>
                    {currentProduct ? currentProduct.amount ?? 0 : total}
                  </div>
                  <div className={styles.statLabel}>Totaal</div>
                </div>
              </div>

              {nextLocations && nextLocations.length > 0 && (
                <div className={styles.nextSection} style={{ marginTop: "1.5em", textAlign: "center" }}>
                  <div
                    className={styles.nextTitle}
                    style={{ fontSize: "2.5rem", fontWeight: 900, marginBottom: "0.5em", letterSpacing: "0.02em" }}
                  >
                    Volgende locaties:
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "2.5em", flexWrap: "wrap" }}>
                    {nextLocations.map((loc, i) => (
                      <div
                        key={loc + String(i)}
                        style={{
                          fontSize: "2.2rem",
                          fontWeight: 900,
                          padding: "0.3em 1.2em",
                          borderRadius: "1em",
                          background: "#222",
                          color: "#ffd166",
                          boxShadow: "0 2px 16px #0006",
                          margin: "0.2em 0",
                        }}
                      >
                        {loc}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {debug && (
                <pre
                  style={{
                    marginTop: 32,
                    background: "#121214",
                    borderRadius: 16,
                    padding: 16,
                    fontSize: 12,
                    maxWidth: 600,
                    overflowX: "auto",
                    border: "1px solid #2a2a2e",
                  }}
                >
                  {JSON.stringify(
                    {
                      data,
                      firstItem: data.items && (data.items as any[]).length > 0 ? (data.items as any[])[0] : null,
                      currentProduct,
                    },
                    null,
                    2
                  )}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", marginTop: 64, color: "#888", fontSize: "1.5rem", fontWeight: 500 }}>
            Geen actieve batch of pickdata gevonden.
            <br />
            <span style={{ fontSize: "1rem", color: "#aaa" }}>Wacht op een nieuwe batch in Picqer...</span>
          </div>
        )}
      </main>
    </div>
  );
}



