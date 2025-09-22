
import { useEffect, useState } from 'react';

type PickData = {
  location: string;
  product: string;
  debug?: { picklistId?: number | string; itemId?: number | string };
  items?: any[];
};

export default function Home() {
  const [data, setData] = useState<PickData>({ location: '', product: '' });
  const [sku, setSku] = useState<string>('');
  const [done, setDone] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [picklistId, setPicklistId] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [nextLocations, setNextLocations] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [debug, setDebug] = useState<boolean>(false);

  useEffect(() => {
    let isNexting = false;
    const fetchData = async () => {
      try {
        const batchRes = await fetch('/api/next-batch');
        if (!batchRes.ok) {
          const t = await batchRes.json().catch(() => ({}));
          throw new Error(t?.error || 'Geen open pickbatch gevonden');
        }
        const { batchId } = await batchRes.json();
        const pickRes = await fetch(`/api/next-pick?batchId=${batchId}`);
        if (!pickRes.ok) {
          const t = await pickRes.json().catch(() => ({}));
          throw new Error(t?.error || 'Geen pick data gevonden');
        }
        const pickData: PickData = await pickRes.json();
        setData(pickData);
        setSku(pickData.items?.[0]?.productcode || pickData.items?.[0]?.sku || '');
        const currentProduct = pickData.items?.find(
          (item: any) => (item.stocklocation || item.stock_location) === pickData.location
        );
        setDone(
          currentProduct?.amountpicked ?? currentProduct?.amount_picked ?? 0
        );
        setTotal(currentProduct?.amount ?? 0);
        setPicklistId(String(pickData.debug?.picklistId || ''));
        const newProgress = pickData.items && pickData.items.length > 0
          ? Math.round(
              (pickData.items.filter((item: any) => item.amountpicked > 0 || item.amount_picked > 0).length /
                pickData.items.length) *
                100
            )
          : 0;
        setProgress(newProgress);
        setNextLocations(
          pickData.items
            ?.filter((item: any) => !item.picked && (item.amountpicked === 0 || item.amount_picked === 0))
            .slice(1, 6)
            .map((item: any) => item.stocklocation || item.stock_location || '') || []
        );
        setError('');

        // Automatisch naar volgende picklijst als klaar
        if (newProgress === 100 && !isNexting) {
          isNexting = true;
          setTimeout(() => {
            fetchData(); // Forceer nieuwe batch ophalen
            isNexting = false;
          }, 1000); // 1 seconde delay voor visuele feedback
        }
      } catch (err: any) {
        setError(err?.message || String(err));
        setData({ location: '', product: '' });
        setSku('');
        setDone(0);
        setTotal(0);
        setPicklistId('');
        setProgress(0);
        setNextLocations([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Navigatiebalk */}
      <nav className="flex items-center justify-between px-8 py-4 bg-gray-900 rounded-b-2xl">
        <div className="flex gap-8 text-lg font-semibold">
          <a href="#" className="hover:text-gray-300">Home</a>
          <a href="#" className="hover:text-gray-300">Station 1</a>
          <button onClick={() => setDebug(d => !d)} className="hover:text-gray-300">Debug {debug ? '🔛' : '🔘'}</button>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-sm text-gray-400">Picklist: <span className="font-bold text-white">{picklistId}</span></span>
          <span className="text-xs text-gray-400">Voortgang: <span className="font-bold text-green-400">{progress}%</span></span>
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {loading ? (
          <h1 className="text-5xl">Loading...</h1>
        ) : error ? (
          <h1 className="text-3xl text-red-500">{error}</h1>
        ) : (
          <div className="flex flex-col items-center w-full">
            {/* Locatie */}
            <h1 className="text-white text-center font-extrabold text-[8vw] mb-4 drop-shadow-lg">{data.location}</h1>
            {/* Productnaam en SKU */}
            <div className="flex flex-col items-center mb-6">
              <span className="text-3xl font-semibold mb-2">{data.product}</span>
              <span className="text-lg text-gray-400">SKU: <span className="font-mono text-white">{sku}</span></span>
            </div>
            {/* Statistieken */}
            <div className="flex gap-8 mb-8">
              <div className="bg-gray-800 rounded-xl px-6 py-4 flex flex-col items-center">
                <span className="text-2xl font-bold text-green-400">{done}</span>
                <span className="text-sm text-gray-400">Gedaan</span>
              </div>
              <div className="bg-gray-800 rounded-xl px-6 py-4 flex flex-col items-center">
                <span className="text-2xl font-bold text-blue-400">{total}</span>
                <span className="text-sm text-gray-400">Totaal</span>
              </div>
            </div>
            {/* Volgende locaties badges */}
            <div className="flex gap-2 mt-8 mb-2 flex-wrap justify-center">
              {nextLocations.map((loc, i) => (
                <span key={i} className="bg-gray-700 text-white rounded-full px-4 py-2 text-sm font-bold shadow">{loc}</span>
              ))}
            </div>
            {/* Debug info */}
            {debug && (
              <pre className="mt-8 bg-gray-900 rounded-xl p-4 text-xs max-w-2xl overflow-x-auto border border-gray-800">
                {JSON.stringify(data, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
