import React from 'react';

export function ModelVotes({ signalObject }) {
  if (!signalObject || !signalObject.model_votes) {
     return null;
  }

  const { model_votes } = signalObject;
  
  // Format names for display
  const modelLabels = {
    ruleEngine: 'Technical Rules',
    logistic: 'Logistic Baseline',
    randomForest: 'Random Forest',
    lstm: 'TF.js LSTM'
  };

  const getTheme = (sig) => {
      if (sig === 'BUY') return 'text-green-500 bg-green-500/10 border-green-500/20';
      if (sig === 'SELL') return 'text-red-500 bg-red-500/10 border-red-500/20';
      return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
      {Object.entries(model_votes).map(([key, vote]) => {
         const theme = getTheme(vote.signal);
         // vote.probability is P(up). Show directional conviction = |p-0.5|*2 so a
         // strong SELL reads as high conviction rather than a low percentage.
         const pUp = vote.probability ?? 0.5;
         const conviction = Math.min(Math.abs(pUp - 0.5) * 2, 1);

         return (
           <div key={key} className={`flex flex-col border border-border rounded-lg p-4 bg-card shadow-sm`}>
               <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">{modelLabels[key]}</span>
               <div className="flex justify-between items-end">
                  <span className={`text-xl font-bold px-2 py-0.5 rounded-md ${theme}`}>
                     {vote.signal}
                  </span>
                  <div className="text-right">
                     <span className="text-lg font-mono font-medium">{(conviction * 100).toFixed(0)}%</span>
                     <span className="block text-[10px] text-muted-foreground uppercase leading-none">Conviction</span>
                  </div>
               </div>

               {/* Mini progress bar for directional conviction */}
               <div className="w-full h-1.5 bg-muted rounded-full mt-3 overflow-hidden">
                  <div
                     className={`h-full ${vote.signal === 'BUY' ? 'bg-green-500' : (vote.signal === 'SELL' ? 'bg-red-500' : 'bg-yellow-500')}`}
                     style={{ width: `${conviction * 100}%` }}
                  />
               </div>
               <span className="block text-[10px] text-muted-foreground mt-1 font-mono">P(up) {(pUp * 100).toFixed(0)}%</span>
           </div>
         );
      })}
    </div>
  );
}
