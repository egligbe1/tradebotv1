import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { dataManager } from '@/services/DataManager';
import { AVAILABLE_SYMBOLS } from '@/store/useStore';
import { Database, ShieldAlert, RefreshCw, Trash2, CheckCircle, Loader2 } from 'lucide-react';

export default function MonitorPage() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ limit: 750, used: 0, candleCacheSize: 0 });
  const [syncStatus, setSyncStatus] = useState({ active: false, current: '', progress: 0 });

  const loadMonitor = async () => {
      // Query used calls today
      const used = dataManager.getDailyCallCount();
      
      // Query Dexie Cache Size
      const candleCacheSize = await dataManager.db.candles.count();
      
      // Query Dexie Logs
      const rawLogs = await dataManager.db.callLog.orderBy('id').reverse().limit(50).toArray();
      
      setStats({ limit: 750, used, candleCacheSize });
      setLogs(rawLogs);
  };

  useEffect(() => {
     loadMonitor();
     const interval = setInterval(loadMonitor, 5000); // Polling for live updates
     return () => clearInterval(interval);
  }, []);

  const handleDeepSync = async () => {
     if (!confirm("This will purge all local data and pull 5,000 fresh candles for EVERY asset. This takes ~1 minute to respect API limits. Proceed?")) return;
     
     setSyncStatus({ active: true, current: 'Purging Cache...', progress: 0 });
     await dataManager.clearCache();
     await loadMonitor();

     for (let i = 0; i < AVAILABLE_SYMBOLS.length; i++) {
        const symbol = AVAILABLE_SYMBOLS[i];
        setSyncStatus({ active: true, current: `Syncing ${symbol}...`, progress: Math.round(((i) / AVAILABLE_SYMBOLS.length) * 100) });
        try {
           await dataManager.fetchHighFidelityHistory(symbol);
           await loadMonitor();
        } catch (e) {
           console.error(`Sync failed for ${symbol}:`, e.message);
        }
     }

     setSyncStatus({ active: false, current: 'Sync Complete', progress: 100 });
     alert("Full Institutional Sync Complete! Your models are now running on high-fidelity historical data.");
  };

  const gaugePercent = Math.min((stats.used / stats.limit) * 100, 100);
  const chartData = [{ name: 'Remaining', value: stats.limit - stats.used }, { name: 'Used', value: stats.used }];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">API Monitor & Telemetry</h1>
          <p className="text-muted-foreground text-sm">Monitor credits and manage local database health.</p>
        </div>
        
        <div className="flex gap-3">
           {syncStatus.active && (
              <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 px-4 py-2 rounded-lg animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <div className="text-sm font-medium">
                   {syncStatus.current} ({syncStatus.progress}%)
                </div>
              </div>
           )}
           <button 
             onClick={handleDeepSync}
             disabled={syncStatus.active}
             className="flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
           >
             <Trash2 size={16} />
             Purge & Deep Sync
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {/* Usage Gauge */}
         <div className="bg-card border border-border p-6 rounded-xl shadow-sm md:col-span-2 flex items-center justify-between">
            <div className="w-1/2">
                <h2 className="text-lg font-semibold mb-2 text-primary">Twelve Data Quota</h2>
                <p className="text-sm text-muted-foreground mb-4">Hard limit enforced daily to protect free tier budget.</p>
                <div className="flex gap-4">
                   <div className="text-3xl font-bold">{stats.used} <span className="text-base font-normal text-muted-foreground">/ {stats.limit}</span></div>
                </div>
                {stats.used > 600 && <p className="text-destructive text-sm font-semibold mt-2 flex items-center gap-1"><ShieldAlert className="w-4 h-4" /> Approaching quota limit</p>}
            </div>
            <div className="h-32 w-1/2">
               <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" barSize={30} margin={{top: 20, right: 30, left: 20, bottom: 5}}>
                     <XAxis type="number" hide domain={[0, stats.limit]} />
                     <YAxis dataKey="name" type="category" hide />
                     <Tooltip cursor={{fill: 'transparent'}} />
                     <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {chartData.map((entry, index) => (
                           <Cell key={`cell-${index}`} fill={index === 0 ? 'rgba(74, 222, 128, 0.2)' : (gaugePercent > 80 ? '#ef4444' : '#eab308')} />
                        ))}
                     </Bar>
                  </BarChart>
               </ResponsiveContainer>
            </div>
         </div>

         {/* Cache Size */}
         <div className="bg-card border border-border p-6 rounded-xl shadow-sm flex flex-col items-center justify-center text-center">
            <Database className="w-12 h-12 text-blue-500 opacity-20 mb-2" />
            <h3 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Cached Candles</h3>
            <p className="text-4xl font-bold mt-2">{stats.candleCacheSize.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-2">IndexedDB records saved avoiding API refetches</p>
         </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
         <div className="p-4 border-b border-border bg-muted/20">
            <h2 className="text-lg font-semibold">Network Logs (Last 50)</h2>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
               <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                  <tr>
                     <th className="px-6 py-3">Timestamp</th>
                     <th className="px-6 py-3">Endpoint</th>
                     <th className="px-6 py-3">Status</th>
                     <th className="px-6 py-3">Latency (ms)</th>
                  </tr>
               </thead>
               <tbody>
                  {logs.map((log, i) => (
                     <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-6 py-3 font-mono">{new Date(log.date).toLocaleTimeString()}</td>
                        <td className="px-6 py-3 font-mono text-primary text-xs truncate max-w-[200px]">{log.endpoint.split('twelvedata.com')[1]}?symbol={log.symbol}&interval={log.interval}</td>
                        <td className="px-6 py-3">
                           <span className={`px-2 py-0.5 rounded text-xs font-semibold ${log.success ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                              {log.success ? '200 OK' : 'FAILED'}
                           </span>
                        </td>
                        <td className={`px-6 py-3 font-mono ${log.latency > 1000 ? 'text-yellow-500' : ''}`}>{log.latency}ms</td>
                     </tr>
                  ))}
                  {logs.length === 0 && (
                     <tr>
                        <td colSpan="4" className="px-6 py-8 text-center text-muted-foreground">No traffic generated yet today.</td>
                     </tr>
                  )}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
}
