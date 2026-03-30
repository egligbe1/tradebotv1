import React, { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';
import { createClient } from '@supabase/supabase-js';
import { 
  Briefcase, Wallet, BarChart3, Clock, CheckCircle2, XCircle, 
  ArrowUpRight, ArrowDownRight, RefreshCcw, MoreVertical, ShieldCheck
} from 'lucide-react';

// Initialize Supabase Client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function PortfolioPage() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalPnl: 0, winRate: 0, activeCount: 0 });

  const fetchPortfolio = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTrades(data || []);
      calculateStats(data || []);
    } catch (e) {
      console.error("Failed to fetch portfolio:", e.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (data) => {
    const closed = data.filter(t => t.status === 'CLOSED');
    const wins = closed.filter(t => t.pnl > 0).length;
    const totalPnl = closed.reduce((acc, t) => acc + (t.pnl || 0), 0);
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    const activeCount = data.filter(t => t.status === 'OPEN').length;

    setStats({ totalPnl, winRate, activeCount });
  };

  useEffect(() => {
    fetchPortfolio();
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
        fetchPortfolio();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Institutional Portfolio</h1>
          <p className="text-muted-foreground text-sm">Real-time performance tracking of your AI-generated signals.</p>
        </div>
        <button 
           onClick={fetchPortfolio}
           className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground"
        >
          <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm overflow-hidden relative">
          <div className="flex items-center gap-3 mb-4 text-muted-foreground">
            <Wallet size={20} className="text-primary" />
            <span className="text-sm font-semibold uppercase tracking-wider">Total Mock P/L</span>
          </div>
          <div className={`text-3xl font-bold ${stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {stats.totalPnl >= 0 ? '+' : ''}{stats.totalPnl.toFixed(2)}%
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">Cumulative account growth</div>
          <div className={`absolute bottom-0 left-0 h-1 w-full ${stats.totalPnl >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm overflow-hidden relative">
          <div className="flex items-center gap-3 mb-4 text-muted-foreground">
            <BarChart3 size={20} className="text-primary" />
            <span className="text-sm font-semibold uppercase tracking-wider">Signal Win Rate</span>
          </div>
          <div className="text-3xl font-bold">{stats.winRate.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">Based on {trades.filter(t=>t.status==='CLOSED').length} closed signals</div>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-primary" />
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-sm overflow-hidden relative">
          <div className="flex items-center gap-3 mb-4 text-muted-foreground">
            <Clock size={20} className="text-primary" />
            <span className="text-sm font-semibold uppercase tracking-wider">Active Monitoring</span>
          </div>
          <div className="text-3xl font-bold">{stats.activeCount}</div>
          <div className="text-xs text-muted-foreground mt-1 font-medium">Currently monitoring target levels</div>
          <div className="absolute bottom-0 left-0 h-1 w-full bg-orange-500" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2">
            <Briefcase size={18} className="text-primary" />
            Execution Ledger
          </h3>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
            <ShieldCheck size={14} className="text-emerald-500" />
            Verified Cloud Signals
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-[10px]">Symbol</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-[10px]">Side</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-[10px]">Entry</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-[10px]">Target</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-[10px]">Stop</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-[10px]">Status</th>
                <th className="px-6 py-3 font-medium uppercase tracking-wider text-[10px] text-right">P/L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                   <td colSpan={7} className="px-6 py-12 text-center animate-pulse text-muted-foreground italic">Fetching verified ledger data...</td>
                </tr>
              ) : trades.length === 0 ? (
                <tr>
                   <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground italic">No historical executions found.</td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4 font-bold">{trade.symbol}</td>
                    <td className="px-6 py-4">
                      <span className={`flex items-center gap-1 font-bold ${trade.side === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {trade.side === 'BUY' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        {trade.side}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">${trade.entry_price.toFixed(5)}</td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">${trade.tp_price.toFixed(5)}</td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">${trade.sl_price.toFixed(5)}</td>
                    <td className="px-6 py-4">
                      <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex ${trade.status === 'OPEN' ? 'bg-orange-500/10 text-orange-500' : 'bg-muted text-muted-foreground'}`}>
                        {trade.status === 'OPEN' ? <Clock size={12} /> : <CheckCircle2 size={12} />}
                        {trade.status}
                      </div>
                    </td>
                    <td className={`px-6 py-4 text-right font-mono font-bold ${trade.pnl > 0 ? 'text-emerald-500' : (trade.pnl < 0 ? 'text-rose-500' : 'text-muted-foreground')}`}>
                      {trade.status === 'CLOSED' ? (trade.pnl > 0 ? `+${trade.pnl.toFixed(2)}%` : `${trade.pnl.toFixed(2)}%`) : '--'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
