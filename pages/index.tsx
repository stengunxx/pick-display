// ...existing code...
import React, { useEffect, useState, useRef, startTransition } from "react";
import { signOut } from "next-auth/react";
import styles from "../styles/PickDisplay.module.css";

/* ========== TYPES ========== */
type BatchView = {
  batchId: string | number;
  currentProduct: any | null;
  product: string;
  sku: string;
  done: number;
  total: number;
  progress: number;
  nextLocations: string[];
  // optioneel (alleen voor primary / single view):
  items?: any[];
  totalProducts?: number;
  todoProducts?: number;
};

type PickData = {
  location: string;
  product: string;
  debug?: { picklistId?: number | string; itemId?: number | string };
  items?: any[];
  nextLocations?: string[];
  done?: boolean;
};

type MiniFx = Record<string | number, { locPulse: boolean; bump: boolean }>;

/* ========== MINI CARD ========== */
function renderBatchMini(
  b: BatchView,
  styles: any,
  fx?: { locPulse?: boolean; bump?: boolean }
) {
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
          <span
            className={`${fx?.locPulse ? styles.locPulse : ""}`}
            style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
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
            <div className={`${styles.statValue} ${fx?.bump ? styles.bumpFlash : ""}`}>{b.done}</div>
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

/* ========== PAGE ========== */
export default function HomePage() {
  // Detectie picklist-wissel (ook binnen dezelfde batch)
  const prevPicklistIdRef = useRef<string | number | null>(null);
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

  // toast queue
  type Toast = { id: number; text: string };
  const toastQRef = useRef<Toast[]>([]);
  const [activeToast, setActiveToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function pushToast(text: string) {
    toastQRef.current.push({ id: Date.now(), text });
    if (!activeToast) showNextToast();
  }
  function showNextToast() {
    const next = toastQRef.current.shift() || null;
    setActiveToast(next);
    if (!next) return;
    clearTimeout(toastTimerRef.current as any);
    toastTimerRef.current = setTimeout(showNextToast, 1600);
  }
  useEffect(() => () => clearTimeout(toastTimerRef.current as any), []);

  // animations (single view)
  const [showLocAnim, setShowLocAnim] = useState(false);
  const [showPickedAnim, setShowPickedAnim] = useState(false);
  const prevLocRef = useRef("");
  const prevDoneRef = useRef<number | null>(null);

  // split-view animatiestate
  const [miniFx, setMiniFx] = useState<MiniFx>({});
  const miniPrevRef = useRef<Record<string | number, { loc: string; done: number }>>({});

  // picklist-wissel toast (primary)
  const prevBatchIdsRef = useRef(""); // detectie nieuwe batch-set
  const prevPrimaryKeyRef = useRef<string | null>(null);
  const initPrimaryRef = useRef(false);

  // performance / polling
  const pollDelayRef = useRef(1000);
  const turboUntilRef = useRef(0);

  // klokje
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // helpers
  const noCache = {
    cache: "no-store" as const,
    headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" }
  };
  const collator = new Intl.Collator("nl", { numeric: true, sensitivity: "base" });
  const locOf = (it: any) => (it?.stocklocation ?? it?.stock_location ?? "").toString();

  // polling
  useEffect(() => {
    let unmounted = false;
    let ctrl: AbortController | null = null;
    let timer: any = null;

    const fetchOnce = async () => {
      try {
        ctrl?.abort();
        ctrl = new AbortController();
        const signal = ctrl.signal;
        const bust = `_=${Date.now() % 1e7}`;

        // Loader timer: als het langer dan 500ms duurt, zet loading aan
        let loaderTimeout = setTimeout(() => {
          if (!loading) setLoading(true);
        }, 500);

        // 1) batch-ids en 2) batch-data tegelijk ophalen
        const batchPromise = fetch(`/api/next-batch?${bust}`, { ...noCache, signal }).then(r => r.json());
        const pickPromise = batchPromise.then(j => {
          const ids: (string | number)[] = Array.isArray(j.batchIds) ? j.batchIds : (j.batchId ? [j.batchId] : []);
          if (!ids || ids.length === 0) return { ids: [], settled: [] };
          return Promise.allSettled(
            ids.slice(0, 2).map(id =>
              fetch(`/api/next-pick?batchId=${id}&${bust}`, { ...noCache, signal }).then(r => r.json())
            )
          ).then(settled => ({ ids, settled }));
        });

        // Wacht op beide tegelijk
        const [j, pickResult] = await Promise.all([batchPromise, pickPromise]);
  clearTimeout(loaderTimeout);
  if (loading) setLoading(false);

        const ids: (string | number)[] = Array.isArray(j.batchIds) ? j.batchIds : (j.batchId ? [j.batchId] : []);
        const sigIds = Array.from(new Set(ids.map(String))).sort().join(",");

        // Nieuwe batch-set (bijv. batch toegevoegd/verwijderd)
        if (prevBatchIdsRef.current && prevBatchIdsRef.current !== sigIds) {
          pushToast("Nieuwe batch!");
        }
        prevBatchIdsRef.current = sigIds;

        if (!ids || ids.length === 0 || !pickResult || !Array.isArray(pickResult.settled)) {
          setLoading(false);
          return;
        }

        // 2) data per batch (parallel)
        const settled = pickResult.settled;

        const views: BatchView[] = [];
        const fullViews: BatchView[] = [];
        for (let i = 0; i < settled.length; i++) {
          const res = settled[i];
          if (res.status !== "fulfilled") continue;
          const p = res.value;

          const items = Array.isArray(p.items)
            ? p.items.slice().sort((a: any, b: any) => collator.compare(locOf(a), locOf(b)))
            : [];

          const pickedOf = (it: any) => Number(it?.amountpicked ?? it?.amount_picked ?? 0);
          const totalOf  = (it: any) => Number(it?.amount ?? it?.amount_to_pick ?? 0);

          const cur = items.find((it: any) => pickedOf(it) < totalOf(it)) ?? null;

          const prog = items.length
            ? Math.round((items.filter((it: any) => pickedOf(it) >= totalOf(it)).length / items.length) * 100)
            : 0;

          let nextLocs: string[] = [];
          if (cur) {
            const curIdx = items.findIndex((x: any) => x === cur);
            const curLoc = locOf(cur);
            const seen = new Set<string>();
            nextLocs = items
              .map((it: any, idx: number) => ({ it, idx }))
              .filter(({ it, idx }: { it: any; idx: number }) => idx > curIdx && pickedOf(it) < totalOf(it))
              .map(({ it }: { it: any }) => locOf(it))
              .filter((loc: string) => loc && loc !== curLoc && (seen.has(loc) ? false : (seen.add(loc), true)));
          }

          const totalProducts = items.reduce((s: number, it: any) => s + (it.amount ?? it.amount_to_pick ?? 0), 0);
          const todoProducts  = items.reduce((s: number, it: any) => {
            const a = it.amount ?? it.amount_to_pick ?? 0;
            const p = it.amountpicked ?? it.amount_picked ?? 0;
            return s + Math.max(0, a - p);
          }, 0);

          const common: BatchView = {
            batchId: ids[i],
            currentProduct: cur,
            product: (cur?.product ?? cur?.name ?? cur?.title ?? cur?.omschrijving ?? cur?.description ?? p.product ?? "") as string,
            sku: (cur?.productcode ?? cur?.sku ?? "") as string,
            done: cur ? pickedOf(cur) : 0,
            total: cur ? totalOf(cur) : 0,
            progress: prog,
            nextLocations: nextLocs,
            totalProducts,
            todoProducts,
          };
          views.push(common);
          fullViews.push({ ...common, items });
        }

        const active = views.filter(v => v.currentProduct);

        // split-view animaties (loc-wissel / done↑) per batch
        setMiniFx(prevFx => {
          const nextFx: MiniFx = { ...prevFx };
          for (const v of active) {
            const id = v.batchId;
            const loc = String(v.currentProduct?.stocklocation ?? v.currentProduct?.stock_location ?? "");
            const done = Number(v.done ?? 0);
            const prev = miniPrevRef.current[id] || { loc, done };
            const locChanged = prev.loc && prev.loc !== loc;
            const doneIncreased = prev.done != null && done > prev.done;

            if (locChanged || doneIncreased) {
              nextFx[id] = { locPulse: !!locChanged, bump: !!doneIncreased };
              setTimeout(() => {
                setMiniFx(curr => ({ ...curr, [id]: { locPulse: false, bump: false } }));
              }, locChanged ? 600 : 300);
            }
            miniPrevRef.current[id] = { loc, done };
          }
          // opruimen voor verdwenen batches
          Object.keys(nextFx).forEach(k => {
            if (!active.some(v => String(v.batchId) === String(k))) delete nextFx[k as any];
          });
          return nextFx;
        });

        // lijst-state
        startTransition(() => {
          setBatches(prev => (sameBatchList(prev, active) ? prev : active));
        });

        // primary + picklist-wissel-toast
        const primaryLite = active[0] || null;
        if (primaryLite) {
          const newPrimaryKey = String(primaryLite.batchId ?? "");
          if (debug && prevPrimaryKeyRef.current !== newPrimaryKey) {
            console.log("[primary picklist change]", prevPrimaryKeyRef.current, "→", newPrimaryKey, { primaryLite });
          }
          if (initPrimaryRef.current && prevPrimaryKeyRef.current && newPrimaryKey &&
              prevPrimaryKeyRef.current !== newPrimaryKey) {
            pushToast("Nieuwe picklist!");
          }
          prevPrimaryKeyRef.current = newPrimaryKey;
          initPrimaryRef.current = true;

          const primaryFull = fullViews.find(v => v.batchId === primaryLite.batchId) || primaryLite;
          // Detecteer picklist-wissel
          const currentPicklistId =
            primaryFull?.currentProduct?.picklistId ??
            primaryFull?.currentProduct?.picklist_id ??
            null;
          if (
            prevPicklistIdRef.current &&
            currentPicklistId &&
            prevPicklistIdRef.current !== currentPicklistId
          ) {
            pushToast("Nieuwe picklist!");
          }
          prevPicklistIdRef.current = currentPicklistId;
          startTransition(() => updatePrimaryIfChanged(primaryFull));
        }

        setError("");
        setLoading(false);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "");
        setLoading(false);
      }
    };

    const loop = async () => {
      if (unmounted) return;
      await fetchOnce();
      if (unmounted) return;
      const now = Date.now();
  pollDelayRef.current = 300;
      timer = setTimeout(loop, pollDelayRef.current);
    };

    loop();
    return () => { unmounted = true; ctrl?.abort(); if (timer) clearTimeout(timer); };
  }, [debug]);

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
      turboUntilRef.current = Date.now() + 8000;
      lastPrimarySigRef.current = sig;
    }

    if (prevLocRef.current && prevLocRef.current !== loc) {
      setShowLocAnim(true);
      setTimeout(() => setShowLocAnim(false), 600);
    }
    prevLocRef.current = loc;

    if (prevDoneRef.current != null && p.done > prevDoneRef.current) {
      setShowPickedAnim(true);
      setTimeout(() => setShowPickedAnim(false), 300);
    }
    prevDoneRef.current = p.done;

    const isSingleView = batches.filter(b => b && b.currentProduct).length === 1;
    setCurrentProduct(p.currentProduct);
    setData({ location: loc, product: p.product, items: isSingleView ? p.items : [] });
    setSku(p.sku);
    setDone(p.done);
    setTotal(p.total);
    setProgress(p.progress);
    setNextLocations(p.nextLocations);
    setPicklistId(String(p.batchId ?? ""));
  }

  const activeBatches = batches.filter((b) => b && b.currentProduct);

  // totals helper
  const pickTotals = React.useMemo(() => {
    const arr = Array.isArray(data.items) ? data.items : [];
    if (arr.length) {
      const totalProducts = arr.reduce((s: number, it: any) => s + (it.amount ?? it.amount_to_pick ?? 0), 0);
      const todoProducts  = arr.reduce((s: number, it: any) => {
        const a = it.amount ?? it.amount_to_pick ?? 0;
        const p = it.amountpicked ?? it.amount_picked ?? 0;
        return s + Math.max(0, a - p);
      }, 0);
      return { totalProducts, todoProducts };
    }
    return { totalProducts: total, todoProducts: Math.max(0, total - done) };
  }, [data.items, total, done]);

  const debugText = React.useMemo(() => {
    if (!debug) return "";
    const first = Array.isArray(data.items) ? data.items[0] : null;
    return JSON.stringify({ firstItem: first, currentProduct }, null, 2);
  }, [debug, data.items, currentProduct]);

  return (
    <div className={styles.root}>
      {activeToast && (
        <div
          style={{
            position: "fixed",
            top: 72,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background: "#ffd166",
              color: "#222",
              fontWeight: 800,
              fontSize: "1.4rem",
              padding: "0.75rem 2.0rem",
              borderRadius: "1.25rem",
              border: "2px solid #ffe7b3",
              boxShadow: "0 6px 32px rgba(0,0,0,.35)",
            }}
          >
            {activeToast.text}
          </div>
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
        {error ? (
          <div style={{ textAlign: "center", marginTop: 64, color: "#d33", fontSize: "1.5rem", fontWeight: 500 }}>
            {error}
            <br />
            <span style={{ fontSize: "1rem", color: "#aaa" }}>Controleer Picqer of probeer opnieuw...</span>
          </div>
        ) : activeBatches.length >= 2 ? (
          <div className={styles.splitWrap}>
            <section className={styles.splitPaneTop}>
              {renderBatchMini(activeBatches[0], styles, miniFx[activeBatches[0].batchId])}
            </section>
            <section className={styles.splitPaneBottom}>
              {renderBatchMini(activeBatches[1], styles, miniFx[activeBatches[1].batchId])}
            </section>
          </div>
        ) : currentProduct ? (
          <div className={styles.singleWrap}>
            <div className={styles.card}>
              <div style={{ textAlign: "center", color: "#aaa", fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                Picklist totaal: {pickTotals.totalProducts} producten
                <br />
                Nog te doen: {pickTotals.todoProducts}
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
                  className={`${styles.locBox} ${showLocAnim ? styles.locPulse : ""}`}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}
                >
                  {currentProduct ? (currentProduct.stocklocation || currentProduct.stock_location || "—") : "—"}
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
                  <div className={`${styles.statValue} ${showPickedAnim ? styles.bumpFlash : ""}`}>
                    {currentProduct ? (currentProduct.amountpicked ?? currentProduct.amount_picked ?? 0) : done}
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
                  {debugText}
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
