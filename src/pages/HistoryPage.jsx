import React, { useState } from 'react';
import { useStore } from '@/store/useStore';
import { dataManager } from '@/services/DataManager';
import { backtestEngine } from '@/services/BacktestEngine';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Play, TrendingUp, TrendingDown, Clock, ShieldAlert, RefreshCw } from 'lucide-react';

export default function HistoryPage() {
  const apiKey = useStore((state) => state.apiKey);
  const symbol = useStore((state) => state.symbol);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  const runSimulation = async () => {
     if (!apiKey) return alert("API Key required backtest data fetch.");
     setLoading(true);
     setError(null);
     
     try {
         // We fetch a larger chunk of memory for a solid backtest
         const data = await dataManager.getCandles(symbol, '1h', 1000);
         const { trades, equityCurve, metrics } = await backtestEngine.runBacktest(data.values);
         setResults({ trades, equityCurve, metrics });
     } catch(e) {
         setError(e.message);
     } finally {
         setLoading(false);
     }
  };

  if (!apiKey) {
      return <div className="p-6">API Key is required to fetch historical data for backtesting.</div>
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-end shrink-0">
          <div>
            <h1 className="text-2xl font-bold">Strategy Backtester</h1>
            <p className="text-muted-foreground text-sm">Simulates the current Machine Learning ensemble across historical data.</p>
          </div>
          <button 
             onClick={runSimulation}
             disabled={loading}
             className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
             {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
             {loading ? 'Simulating...' : 'Run Simulation (1000 Hours)'}
          </button>
      </div>

      {error && (
         <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg shrink-0">
            Error during backtest: {error}
         </div>
      )}

      {!results && !loading && !error && (
         <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl text-muted-foreground bg-muted/5">
             <Clock className="w-16 h-16 mb-4 opacity-20" />
             <p className="text-lg font-medium">Ready to Simulate</p>
             <p className="text-sm">Click "Run Simulation" to execute the strategy over the last ~40 days of H1 data.</p>
         </div>
      )}

      {results && (
        <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
               <div className="bg-card border border-border p-4 rounded-xl flex items-center justify-between shadow-sm">
                   <div>
                      <p className="text-xs text-muted-foreground uppercase font-semibold">Total PnL (Risk Units)</p>
                      <p className={`text-2xl font-bold ${results.metrics.netUnits >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                         {results.metrics.netUnits > 0 ? '+' : ''}{results.metrics.netUnits.toFixed(1)}R
                      </p>
                   </div>
                   {results.metrics.netUnits >= 0 ? <TrendingUp className="text-green-500 opacity-20 w-8 h-8" /> : <TrendingDown className="text-red-500 opacity-20 w-8 h-8" />}
               </div>
               
               <div className="bg-card border border-border p-4 rounded-xl flex items-center justify-between shadow-sm">
                   <div>
                      <p className="text-xs text-muted-foreground uppercase font-semibold">Win Rate</p>
                      <p className="text-2xl font-bold">{(results.metrics.winRate * 100).toFixed(1)}%</p>
                   </div>
               </div>

               <div className="bg-card border border-border p-4 rounded-xl flex items-center justify-between shadow-sm">
                   <div>
                      <p className="text-xs text-muted-foreground uppercase font-semibold">Max Drawdown</p>
                      <p className="text-2xl font-bold text-yellow-500">{(results.metrics.maxDrawdown * 100).toFixed(1)}%</p>
                   </div>
                   <ShieldAlert className="text-yellow-500 opacity-20 w-8 h-8"/>
               </div>

               <div className="bg-card border border-border p-4 rounded-xl flex items-center justify-between shadow-sm">
                   <div>
                      <p className="text-xs text-muted-foreground uppercase font-semibold">Profit Factor</p>
                      <p className="text-2xl font-bold">{results.metrics.profitFactor.toFixed(2)}</p>
                   </div>
               </div>
            </div>

            {/* Equity Curve */}
            <div className="bg-card border border-border p-6 rounded-xl shadow-sm shrink-0">
               <h3 className="font-semibold mb-4 text-primary">Equity Curve (Starting 100 Units)</h3>
               <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                     <LineChart data={results.equityCurve} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                       <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                       <XAxis dataKey="index" hide />
                       <YAxis 
                          domain={['auto', 'auto']} 
                          tick={{fill: '#6b7280', fontSize: 12}} 
                          tickFormatter={(val) => val.toFixed(0)} 
                          axisLine={false} 
                          tickLine={false}
                       />
                       <Tooltip 
                          contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: '#fff' }}
                          labelFormatter={(l) => `Trade Index: ${l}`}
                       />
                       <Line 
                          type="monotone" 
                          dataKey="equity" 
                          stroke="#3b82f6" 
                          strokeWidth={2} 
                          dot={false}
                          activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff' }}
                        />
                     </LineChart>
                  </ResponsiveContainer>
               </div>
            </div>

            {/* Trades Table */}
            <div className="bg-card border border-border rounded-xl shadow-sm flex-1 min-h-0 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-border bg-muted/20 shrink-0">
                    <h3 className="font-semibold">Simulated Trade Log ({results.trades.length})</h3>
                </div>
                <div className="overflow-auto flex-1">
                    <table className="w-full text-sm text-left">
                       <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border sticky top-0">
                          <tr>
                             <th className="px-6 py-3">Entry Time</th>
                             <th className="px-6 py-3">Side</th>
                             <th className="px-6 py-3">Entry Price</th>
                             <th className="px-6 py-3">Exit Price</th>
                             <th className="px-6 py-3 text-right">Result</th>
                          </tr>
                       </thead>
                       <tbody>
                          {results.trades.slice().reverse().map((trade, i) => (
                             <tr key={i} className="border-b border-border/50 hover:bg-muted/10">
                                <td className="px-6 py-3 font-mono text-muted-foreground">{trade.entryTime}</td>
                                <td className="px-6 py-3">
                                   <span className={`font-bold ${trade.side === 'BUY' ? 'text-green-500' : 'text-red-500'}`}>{trade.side}</span>
                                </td>
                                <td className="px-6 py-3 font-mono">{trade.entryPrice.toFixed(5)}</td>
                                <td className="px-6 py-3 font-mono">{trade.exitPrice?.toFixed(5) || '-'}</td>
                                <td className="px-6 py-3 text-right">
                                    {trade.result === 'WIN' && <span className="bg-green-500/20 text-green-500 px-2 py-0.5 rounded text-xs font-bold">+2.0R</span>}
                                    {trade.result === 'LOSS' && <span className="bg-red-500/20 text-red-500 px-2 py-0.5 rounded text-xs font-bold">-1.0R</span>}
                                    {trade.result === 'OPEN (EOD)' && <span className="text-yellow-500 text-xs font-semibold">OPEN</span>}
                                </td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                </div>
            </div>
        </>
      )}
    </div>
  );
}
