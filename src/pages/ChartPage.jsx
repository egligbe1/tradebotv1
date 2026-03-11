import React, { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { dataManager } from '@/services/DataManager';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { RefreshCw } from 'lucide-react';

export default function ChartPage() {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const apiKey = useStore(state => state.apiKey);

  const fetchChartData = async () => {
    if (!apiKey) {
       setLoading(false);
       return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await dataManager.getCandles('EUR/USD', '1h', 500);
      setCandles(data.values);
    } catch (err) {
      console.log('API Fetch Error:', err.message);
      setError("Failed to load chart data: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChartData();
  }, [apiKey]);

  if (!apiKey) {
     return <div className="p-6">Requires API Key in Settings to view chart.</div>
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="px-6 py-4 flex justify-between items-center border-b border-border shrink-0">
         <h1 className="text-xl font-bold">Interactive Chart</h1>
         <button 
           onClick={fetchChartData}
           disabled={loading}
           className="flex items-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
         >
           <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
           Refresh
         </button>
      </div>
      <div className="flex-1 min-h-0 p-6 relative">
          {error && <div className="absolute z-50 bg-destructive/90 text-destructive-foreground p-4 ml-4 mt-4 rounded">{error}</div>}
          <div className="h-full w-full grid">
             <PriceChart data={candles} height={window.innerHeight - 150} />
          </div>
      </div>
    </div>
  );
}
