import React from 'react';
import { Share2, Clock, AlertTriangle } from 'lucide-react';

export function SignalCard({ signalObject, currentPrice }) {
  if (!signalObject) {
    return (
       <div className="bg-card border border-border rounded-xl p-6 h-full flex flex-col items-center justify-center text-muted-foreground">
          <Clock className="w-12 h-12 mb-4 opacity-20" />
          <p>Awaiting Signal Generation...</p>
       </div>
    );
  }

  const { signal, confidence, timestamp, entry, stop_loss, take_profit_1, take_profit_2, top_reasons, invalidation } = signalObject;
  
  const getColors = () => {
    switch (signal) {
      case 'BUY': return { bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/20' };
      case 'SELL': return { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20' };
      default: return { bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/20' };
    }
  };

  const colors = getColors();
  const signalStyle = signal === 'BUY' ? 'signal-card-buy' : signal === 'SELL' ? 'signal-card-sell' : 'glass-card border-yellow-500/20';
  const timeStr = new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

  return (
    <div className={`glass-card ${signalStyle} rounded-2xl p-7 relative overflow-hidden flex flex-col h-full shadow-2xl transition-all duration-500`}>
      {/* Background glow sync'd to signal */}
      <div className={`absolute -top-32 -right-32 w-64 h-64 ${colors.bg} rounded-full blur-[100px] opacity-40 pointer-events-none transition-all duration-1000`} />

      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Master Signal</h2>
          <div className="flex items-center gap-3">
             <span className={`text-5xl font-extrabold tracking-tighter ${colors.text}`}>{signal}</span>
             <div className="flex flex-col">
                <span className="text-xl font-bold">{(confidence * 100).toFixed(0)}%</span>
                <span className="text-xs text-muted-foreground">Confidence</span>
             </div>
          </div>
        </div>
        <div className="text-right">
           <p className="text-sm text-muted-foreground">Generated at</p>
           <p className="font-mono text-lg">{timeStr}</p>
        </div>
      </div>

      {signal !== 'HOLD' ? (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Entry Price</p>
            <p className="font-mono font-medium text-lg">{entry?.toFixed(5)}</p>
          </div>
          <div className="bg-destructive/10 p-3 rounded-lg border border-destructive/20">
            <p className="text-xs text-destructive mb-1 uppercase tracking-wider">Stop Loss</p>
            <p className="font-mono font-medium text-lg text-destructive">{stop_loss?.toFixed(5)}</p>
          </div>
          <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/20">
            <p className="text-xs text-green-500 mb-1 uppercase tracking-wider">Take Profit 1</p>
            <p className="font-mono font-medium text-lg text-green-500">{take_profit_1?.toFixed(5)}</p>
            <p className="text-[10px] text-green-600/70 mt-1">Reward 1:2</p>
          </div>
          <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/20">
            <p className="text-xs text-green-500 mb-1 uppercase tracking-wider">Take Profit 2</p>
            <p className="font-mono font-medium text-lg text-green-500">{take_profit_2?.toFixed(5)}</p>
            <p className="text-[10px] text-green-600/70 mt-1">Reward 1:4</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
           Wait for valid technical momentum and model consensus.
        </div>
      )}

      {top_reasons && top_reasons.length > 0 && (
        <div className="mt-auto space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">Market Intelligence Feed</h3>
          <ul className="space-y-2">
            {top_reasons.map((r, i) => (
              <li key={i} className="text-[13px] font-medium leading-snug flex items-start group">
                 <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 mr-3 shrink-0 shadow-[0_0_8px_rgba(251,191,36,0.4)]" />
                 <span className="opacity-90 group-hover:opacity-100 transition-opacity">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invalidation && signal !== 'HOLD' && (
         <div className="mt-4 pt-4 border-t border-border/50 flex items-center text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 mr-2 text-yellow-500/70" />
            <span>{invalidation}</span>
         </div>
      )}
    </div>
  );
}
