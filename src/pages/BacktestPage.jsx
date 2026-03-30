import React, { useState } from 'react';
import { useStore, AVAILABLE_SYMBOLS } from '@/store/useStore';
import { dataManager } from '@/services/DataManager';
import { backtestEngine } from '@/services/BacktestEngine';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import { 
  Play, TrendingUp, Percent, Target, AlertTriangle, List, 
  ChevronRight, ArrowUpRight, ArrowDownRight, Info
} from 'lucide-react';

export default function BacktestPage() {
  const [symbol, setSymbol] = useState(AVAILABLE_SYMBOLS[0]);
  const [balance, setBalance] = useState(10000);
  const [risk, setRisk] = useState(1);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const handleRunTest = async () => {
    setLoading(true);
    setResults(null);
    setError('');

    try {
      // 1. Fetch 1H and 4H history (2000 candles for deep backtest)
      const res1h = await dataManager.getCandles(symbol, '1h', 2000);
      const res4h = await dataManager.getCandles(symbol, '4h', 500);

      const report = await backtestEngine.run(
        symbol, 
        res1h.values, 
        res4h.values, 
        Number(balance), 
        Number(risk) / 100
      );

      setResults(report);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Strategy Backtester</h1>
          <p className="text-muted-foreground text-sm">Simulate institutional signals on historical market data.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-card p-2 rounded-lg border border-border shadow-sm">
          <select 
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="bg-background border border-input rounded px-3 py-1.5 text-sm"
          >
            {AVAILABLE_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          
          <div className="flex items-center gap-2 px-2 border-l border-border">
            <span className="text-xs font-medium text-muted-foreground">Capital:</span>
            <input 
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="bg-background border border-input rounded px-2 py-1 text-sm w-24"
            />
          </div>

          <div className="flex items-center gap-2 px-2 border-l border-border">
            <span className="text-xs font-medium text-muted-foreground">Risk %:</span>
            <input 
              type="number"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="bg-background border border-input rounded px-2 py-1 text-sm w-16"
            />
          </div>

          <button 
            onClick={handleRunTest}
            disabled={loading}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-1.5 rounded text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {loading ? <div className="w-4 h-4 border-2 border-current border-t-transparent animate-spin rounded-full" /> : <Play size={16} />}
            Run Simulation
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg flex items-center gap-3">
          <AlertTriangle size={18} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {!results && !loading && !error && (
        <div className="h-[500px] flex flex-col items-center justify-center text-center bg-card/50 border border-dashed border-border rounded-xl">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <TrendingUp size={32} className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">No Simulation Data</h3>
          <p className="text-muted-foreground max-w-sm">Configure your parameters above and click "Run Simulation" to see the backtested performance of the model ensemble.</p>
        </div>
      )}

      {loading && (
        <div className="h-[500px] flex flex-col items-center justify-center text-center bg-card/50 border border-border rounded-xl">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent animate-spin rounded-full mb-4" />
          <h3 className="text-lg font-semibold">Scanning 2,000 Candles...</h3>
          <p className="text-muted-foreground">Calculating fractal S/R levels and generating AI votes for every hour.</p>
        </div>
      )}

      {results && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Final Balance" value={`$${results.finalBalance.toLocaleString(undefined, {maximumFractionDigits: 2})}`} trend={results.totalReturn > 0 ? 'up' : 'down'} subValue={`${results.totalReturn.toFixed(2)}% ROI`} icon={TrendingUp} />
            <MetricCard label="Win Rate" value={`${results.winRate.toFixed(1)}%`} subValue={`${results.trades.filter(t => t.result === 'WIN').length} Wins / ${results.tradesCount} Total`} icon={Percent} />
            <MetricCard label="Profit Factor" value={results.profitFactor.toFixed(2)} subValue="Gross Profit / Gross Loss" icon={Target} />
            <MetricCard label="Max Drawdown" value={`${results.maxDrawdown.toFixed(2)}%`} subValue="Peak-to-Valley Decline" icon={AlertTriangle} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold">Equity Growth Curve</h3>
                <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">2,000 Candle Simulation</div>
              </div>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={results.equityCurve}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="time" hide />
                    <YAxis domain={['auto', 'auto']} stroke="#666" fontSize={12} tickFormatter={(val) => `$${val/1000}k`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                      itemStyle={{ color: 'white', fontWeight: 'bold' }}
                      formatter={(val) => [`$${val.toFixed(2)}`, 'Balance']}
                    />
                    <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-0 shadow-sm overflow-hidden flex flex-col">
               <div className="p-6 border-b border-border flex items-center justify-between">
                  <h3 className="font-bold flex items-center gap-2">
                     <List size={18} className="text-primary" />
                     Trade Logs
                  </h3>
                  <span className="text-xs text-muted-foreground">{results.trades.length} Executions</span>
               </div>
               <div className="flex-1 overflow-auto max-h-[400px]">
                  {results.trades.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground italic">No trades executed correctly under these conditions.</div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 sticky top-0 border-b border-border">
                        <tr>
                          <th className="px-4 py-2 font-medium">Side</th>
                          <th className="px-4 py-2 font-medium">Entry</th>
                          <th className="px-4 py-2 font-medium">ROI %</th>
                          <th className="px-4 py-2 font-medium text-right">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {results.trades.slice().reverse().map((trade, i) => (
                          <tr key={i} className="hover:bg-muted/20 transition-colors">
                            <td className={`px-4 py-3 font-bold ${trade.side === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>{trade.side}</td>
                            <td className="px-4 py-3 font-mono">${trade.entry.toFixed(5)}</td>
                            <td className="px-4 py-3 font-mono">{(trade.pnlPercent).toFixed(2)}%</td>
                            <td className="px-4 py-3 text-right">
                               <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${trade.result === 'WIN' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                  {trade.result}
                               </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
               </div>
               <div className="p-4 bg-muted/30 border-t border-border text-[10px] text-muted-foreground flex items-center gap-2 italic">
                  <Info size={12} />
                  Simulated results only. Past performance != future gains.
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, subValue, icon: Icon, trend }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm relative overflow-hidden group">
      <div className="flex items-center justify-between mb-3">
        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</span>
        <div className={`p-2 rounded-lg ${trend === 'up' ? 'bg-emerald-500/10 text-emerald-500' : (trend === 'down' ? 'bg-rose-500/10 text-rose-500' : 'bg-primary/10 text-primary')}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground font-medium">{subValue}</div>
      </div>
      {trend && (
        <div className={`absolute bottom-0 left-0 h-1 transition-all group-hover:h-2 ${trend === 'up' ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: '100%' }} />
      )}
    </div>
  );
}
