import React, { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { dataManager } from '@/services/DataManager';
import { FeatureEngine } from '@/services/FeatureEngine';
import { signalAggregator } from '@/services/SignalAggregator';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { RefreshCw } from 'lucide-react';

export default function ChartPage() {
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [support, setSupport] = useState(null);
  const [resistance, setResistance] = useState(null);
  const [signal, setSignal] = useState(null);
  const apiKey = useStore(state => state.apiKey);

  const fetchChartData = async () => {
    if (!apiKey) {
       setLoading(false);
       return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await dataManager.getCandles('EUR/USD', '1h', 5000);
      const fetchedCandles = data.values;
      setCandles(fetchedCandles);

      if (fetchedCandles.length > 0) {
         const currentPrice = fetchedCandles[fetchedCandles.length - 1].close;
         const features = FeatureEngine.extractFeatures(fetchedCandles);
         const activeSignal = await signalAggregator.generateSignal(features, currentPrice);
         
         const latestFeature = features[features.length - 1];
         setSupport(latestFeature ? latestFeature.support_50 : null);
         setResistance(latestFeature ? latestFeature.resistance_50 : null);
         setSignal(activeSignal);
      }
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
             <PriceChart 
                data={candles} 
                height={window.innerHeight - 150} 
                support={support}
                resistance={resistance}
                signal={signal}
             />
          </div>
      </div>
    </div>
  );
}
