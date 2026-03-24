import React, { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { dataManager } from '@/services/DataManager';
import { FeatureEngine } from '@/services/FeatureEngine';
import { signalAggregator } from '@/services/SignalAggregator';
import { notificationManager } from '@/services/NotificationManager';

// Components
import { SignalCard } from '@/components/dashboard/SignalCard';
import { ModelVotes } from '@/components/dashboard/ModelVotes';
import { PriceChart } from '@/components/dashboard/PriceChart';
import { Activity, RefreshCw } from 'lucide-react';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboardData, setDashboardData] = useState({
      candles: [],
      signal: null,
      currentPrice: null
  });
  
  const apiKey = useStore(state => state.apiKey);
  const symbol = useStore(state => state.symbol);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch live OHLCV
      const data = await dataManager.getCandles(symbol, '1h', 500);
      const candles = data.values;
      const currentPrice = candles[candles.length - 1].close;

      // 2. Generate Features & Signal
      const features = FeatureEngine.extractFeatures(candles);
      const signal = await signalAggregator.generateSignal(features, currentPrice);
      
      const latestFeature = features[features.length - 1];
      const support = latestFeature ? latestFeature.support_50 : null;
      const resistance = latestFeature ? latestFeature.resistance_50 : null;

      setDashboardData(prev => {
          // If the signal was previously HOLD, and is now BUY/SELL, notify!
          // We also require a confidence threshold to avoid spam (e.g. > 40%)
          if (prev.signal && prev.signal.signal === 'HOLD' && signal.signal !== 'HOLD' && signal.confidence > 0.40) {
              notificationManager.notifySignal(signal);
          }
          let newSignal = signal;
          if (!prev.signal || prev.signal.signal === 'HOLD' && signal.signal === 'HOLD'){
              // Do nothing special
          }
          return {
             candles,
             signal: newSignal,
             currentPrice,
             support,
             resistance
          }
      });

    } catch (err) {
      console.log('API Fetch Error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (apiKey) {
       const init = async () => {
          try {
             await signalAggregator.initializeAllModels();
          } catch (e) {
             console.log('[Dashboard] Model init skipped:', e.message);
          }
          try {
             await fetchDashboardData();
          } catch (e) {
             console.log('[Dashboard] Data fetch failed:', e.message);
             setError(e.message);
             setLoading(false);
          }
       };
       init();
       // Request Notification Permissions on load
       try { notificationManager.requestPermission(); } catch(e) {}
    } else {
       fetchDashboardData();
    }
  }, [apiKey, symbol]);

  if (!apiKey) {
    return (
       <div className="p-6 h-full flex items-center justify-center">
         <div className="text-center space-y-4 max-w-sm">
            <Activity className="w-12 h-12 mx-auto text-muted-foreground opacity-50" />
            <h2 className="text-xl font-bold">API Key Required</h2>
            <p className="text-muted-foreground">Please navigate to Settings and enter your Twelve Data API key to activate the dashboard.</p>
         </div>
       </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Header Actions */}
      <div className="flex justify-between items-end">
         <div>
            <h1 className="text-2xl font-bold">Trading Intelligence</h1>
            <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
               <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${loading ? 'bg-yellow-400' : 'bg-green-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${loading ? 'bg-yellow-500' : 'bg-green-500'}`}></span>
               </span>
               {loading ? 'Analyzing Market Data...' : 'Live Model Running'}
            </p>
         </div>
         <button 
           onClick={fetchDashboardData}
           disabled={loading}
           className="flex items-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
         >
           <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
           Force Refresh
         </button>
      </div>

      {error && (
         <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg">
           Error syncing data: {error}
         </div>
      )}

      {/* Top Grid: Signal Card & Model Votes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 h-full min-h-[400px]">
            <SignalCard signalObject={dashboardData.signal} currentPrice={dashboardData.currentPrice} />
        </div>
        <div className="lg:col-span-8 h-full flex flex-col">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Model Consensus</h3>
              <ModelVotes signalObject={dashboardData.signal} />
            </div>
            <div className="flex-1 min-h-[250px] relative mt-2">
              <PriceChart 
                 data={dashboardData.candles} 
                 height={350} 
                 support={dashboardData.support}
                 resistance={dashboardData.resistance}
                 signal={dashboardData.signal}
                 symbol={symbol}
              />
            </div>
        </div>
      </div>
    </div>
  );
}
