import React, { useState } from 'react';
import { Calculator, DollarSign, Percent, ShieldCheck } from 'lucide-react';

export function RiskCalculator({ signal, currentPrice }) {
  const [balance, setBalance] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(1);

  if (!signal || signal.signal === 'HOLD') return null;

  const entry = signal.entry || currentPrice;
  const sl = signal.stop_loss;
  const stopPips = Math.abs(entry - sl);
  
  // Account Risk in Dollars
  const dollarRisk = balance * (riskPercent / 100);
  
  // Position Size (Standard calculation: Risk / (Stop Distance / Entry))
  const positionSize = stopPips > 0 ? (dollarRisk / (stopPips / entry)) : 0;
  
  // For FX: 1 lot = 100k units. For Gold/Stocks, it varies.
  // We'll show "Units" and approximate "Lots"
  const lots = (positionSize / 100000).toFixed(2);

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm animate-in fade-in slide-in-from-right-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/10 rounded-lg text-primary">
          <Calculator size={18} />
        </div>
        <h3 className="font-bold text-sm uppercase tracking-wider">Institutional Position Sizer</h3>
      </div>
      
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 focus-within:text-primary transition-colors">
            <label className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
              <DollarSign size={10} />
              Balance ($)
            </label>
            <input 
              type="number"
              value={balance}
              onChange={(e) => setBalance(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5 focus-within:text-primary transition-colors">
            <label className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
              <Percent size={10} />
              Risk (%)
            </label>
            <input 
              type="number"
              value={riskPercent}
              step="0.1"
              onChange={(e) => setRiskPercent(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="p-4 bg-primary/5 rounded-lg border border-primary/10 space-y-3">
          <div className="flex justify-between items-end border-b border-primary/5 pb-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase">Risk Amount</div>
            <div className="text-lg font-bold text-primary">${dollarRisk.toLocaleString()}</div>
          </div>
          
          <div className="flex justify-between items-end border-b border-primary/5 pb-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase">Recommended Size</div>
            <div className="text-right">
              <div className="text-lg font-bold text-foreground">{positionSize.toLocaleString(undefined, {maximumFractionDigits: 0})} Units</div>
              <div className="text-[10px] font-bold text-muted-foreground">{lots} Standard Lots</div>
            </div>
          </div>

          <div className="pt-2 grid grid-cols-2 gap-4">
            <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
              <div className="text-[9px] font-bold text-emerald-500/80 uppercase mb-1">Target 1 (1:2 RR)</div>
              <div className="text-base font-bold text-emerald-500">+${(dollarRisk * 2).toLocaleString()}</div>
            </div>
            <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
              <div className="text-[9px] font-bold text-emerald-500/80 uppercase mb-1">Target 2 (1:4 RR)</div>
              <div className="text-base font-bold text-emerald-500">+${(dollarRisk * 4).toLocaleString()}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground italic leading-tight pt-1">
            <ShieldCheck size={12} className="text-emerald-500 shrink-0" />
            Size calculated to cap total loss at exactly {riskPercent}% (${dollarRisk.toLocaleString()}).
          </div>
        </div>
      </div>
    </div>
  );
}
