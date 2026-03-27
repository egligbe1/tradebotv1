import React, { useState, useEffect } from 'react';
import { useStore, AVAILABLE_SYMBOLS } from '@/store/useStore';
import { dataManager } from '@/services/DataManager';
import { FeatureEngine } from '@/services/FeatureEngine';
import { signalAggregator } from '@/services/SignalAggregator';
import { supabase } from '@/services/SyncManager';
import { Brain, Play, Save, RefreshCw, Clock } from 'lucide-react';

export default function ModelsPage() {
  const weights = useStore(state => state.modelWeights);
  const setModelWeights = useStore(state => state.setModelWeights);
  const apiKey = useStore(state => state.apiKey);

  const [trainingState, setTrainingState] = useState({
      isTraining: false,
      epoch: 0,
      loss: 0,
      accuracy: 0,
      sequences: 0,
      validRows: 0,
      message: 'Ready to train on latest cache.'
  });

  const [localWeights, setLocalWeights] = useState({ ...weights });
  const [lastTrained, setLastTrained] = useState(null);

  // Fetch the last trained timestamp from Supabase
  useEffect(() => {
    if (!supabase) return;
    const fetchLastTrained = async () => {
      try {
        const { data } = await supabase
          .from('model_sync')
          .select('updated_at')
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
        if (data?.updated_at) setLastTrained(new Date(data.updated_at));
      } catch (e) { /* table may not exist yet */ }
    };
    fetchLastTrained();
  }, [trainingState.isTraining]);

  // Listen to remote cloud training progress via Supabase WebSockets
  useEffect(() => {
    if (!supabase) return;
    
    const channel = supabase.channel('training_status_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'training_status' },
        (payload) => {
           const newData = payload.new;
           if (newData && newData.message) {
              setTrainingState(prev => ({
                  ...prev,
                  isTraining: newData.is_training,
                  message: newData.message,
                  // Visually simulate epoch slider based on remote completion percentage
                  epoch: Math.round((newData.progress_percent / 100) * 30)
              }));
           }
        }
      )
      .subscribe();
      
    return () => {
       supabase.removeChannel(channel);
    };
  }, []);

  const handleRetrainAllModels = async () => {
     if (!apiKey) return alert("API Key required to fetch data for training.");
     const symbol = useStore.getState().symbol;
     
     setTrainingState({ 
        isTraining: true, epoch: 0, loss: 0, accuracy: 0, sequences: 0, validRows: 0,
        message: `Fetching historical data for ${symbol}...` 
     });
     
     try {
       const data = await dataManager.getCandles(symbol, '1h', 3000);
       const features = FeatureEngine.extractFeatures(data.values);
       
       // 1. Train Logistic Regression (Fast)
       setTrainingState(prev => ({ ...prev, message: 'Training Logistic Regression...' }));
       await signalAggregator.models.logistic.train(features);

       // 2. Train Random Forest (Fast)
       setTrainingState(prev => ({ ...prev, message: 'Training Random Forest...' }));
       await signalAggregator.models.randomForest.train(features);

       // 3. Train LSTM (Slow)
       setTrainingState(prev => ({ ...prev, message: 'Compiling TensorFlow layers...' }));
       
       await signalAggregator.models.lstm.train(
          features, 
          (epoch, logs) => {
             setTrainingState(prev => ({
                 ...prev,
                 epoch: epoch + 1,
                 loss: logs.loss || 0,
                 accuracy: logs.acc || 0,
                 message: `Training LSTM epoch ${epoch + 1}/50...`
             }));
          },
          (stats) => {
             setTrainingState(prev => ({
                ...prev,
                sequences: stats.sequences,
                validRows: stats.validRows
             }));
          }
       );

       setTrainingState(prev => ({ 
          ...prev, 
          isTraining: false, 
          epoch: 30, 
          message: 'All models trained and synced to Cloud.' 
       }));
     } catch (e) {
         setTrainingState(prev => ({ 
            ...prev, 
            isTraining: false, 
            message: `Training failed: ${e.message}` 
         }));
     }
  };

  const handleBatchTrainAllAssets = async () => {
     const ghToken = import.meta.env.VITE_GITHUB_PAT;
     if (!ghToken) {
         alert("Please add VITE_GITHUB_PAT to your .env file to authorize the GitHub Runner.");
         return;
     }

     if (!apiKey) return alert("API Key required to fetch data for training.");
     
     setTrainingState({
         isTraining: true, epoch: 0, loss: 0, accuracy: 0, sequences: 0, validRows: 0,
         message: `Dispatching Cloud Runner to GitHub Actions...` 
     });

     try {
         const res = await fetch('https://api.github.com/repos/egligbe1/tradebotv1/actions/workflows/batch-train.yml/dispatches', {
             method: 'POST',
             headers: {
                 'Accept': 'application/vnd.github.v3+json',
                 'Authorization': `Bearer ${ghToken}`,
                 'Content-Type': 'application/json'
             },
             body: JSON.stringify({ ref: 'main' })
         });
         
         if (!res.ok) {
             const errorData = await res.json().catch(() => ({}));
             throw new Error(errorData.message || res.statusText);
         }
         
         setTrainingState(prev => ({ 
            ...prev, 
            message: 'Cloud Runner dispatched! Linking telemetry...' 
         }));
         
         // Wait for the remote WebSockets listener to take over UI updates
     } catch (e) {
         setTrainingState(prev => ({ 
            ...prev, 
            isTraining: false, 
            message: `Dispatch failed: ${e.message}` 
         }));
     }
  };

  const saveWeights = () => {
      // Normalize to sum to 1.0 safely
      const total = Object.values(localWeights).reduce((a,b) => a + Number(b), 0);
      if (total <= 0) return alert("Weights must sum > 0");
      
      const normalized = {
          ruleEngine: Number((localWeights.ruleEngine / total).toFixed(2)),
          logistic: Number((localWeights.logistic / total).toFixed(2)),
          randomForest: Number((localWeights.randomForest / total).toFixed(2)),
          lstm: 1.0 - Number((localWeights.ruleEngine / total).toFixed(2)) - Number((localWeights.logistic / total).toFixed(2)) - Number((localWeights.randomForest / total).toFixed(2))
      };
      
      setModelWeights(normalized);
      setLocalWeights(normalized);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Models & AI Pipeline</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Retrain Panel */}
        <div className="bg-card border border-border p-6 rounded-xl shadow-sm">
           <div className="flex items-center gap-2 mb-4">
              <Brain className="text-primary w-5 h-5" />
              <h2 className="text-lg font-semibold">AI Neural Ensemble Training</h2>
           </div>
           
           <p className="text-sm text-muted-foreground mb-6">
              Sequences are trained directly in your browser. Train all models for the current asset, or initiate a <strong>Batch Train</strong> to sequentially process all available assets and sync them to your cloud backup.
           </p>

           <div className="bg-muted/30 p-4 rounded-lg border border-border/50 mb-6">
              <div className="flex justify-between text-xs mb-1 font-mono">
                 <span className={`${trainingState.isTraining ? 'text-primary animate-pulse' : 'text-muted-foreground'}`}>
                    {trainingState.message}
                 </span>
                 {trainingState.isTraining && <span>Epoch {trainingState.epoch}/30</span>}
              </div>
              <div className="w-full bg-background rounded-full h-2 overflow-hidden mb-2">
                 <div className="bg-primary h-2 transition-all duration-300" style={{ width: `${(trainingState.epoch / 30) * 100}%` }}></div>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                 <span>Loss: {trainingState.loss.toFixed(4)}</span>
                 <span>Acc: {(trainingState.accuracy * 100).toFixed(1)}%</span>
                 <span>Seqs: {trainingState.sequences}</span>
              </div>
               {lastTrained && (
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                     <Clock className="w-3.5 h-3.5" />
                     <span>Last Trained: <strong className="text-foreground">{lastTrained.toLocaleString()}</strong></span>
                  </div>
               )}
           </div>

           <div className="flex flex-col gap-3">
             <button 
                onClick={handleRetrainAllModels}
                disabled={trainingState.isTraining}
                className="w-full flex justify-center items-center gap-2 bg-secondary text-secondary-foreground font-semibold py-2 rounded-md hover:bg-secondary/90 transition-colors disabled:opacity-50"
             >
                {trainingState.isTraining ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {trainingState.isTraining ? 'Training...' : 'Train Current Asset'}
             </button>
             
             <button 
                onClick={handleBatchTrainAllAssets}
                disabled={trainingState.isTraining}
                className="w-full flex justify-center items-center gap-2 bg-primary text-primary-foreground font-semibold py-2 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.2)]"
             >
                {trainingState.isTraining ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                {trainingState.isTraining ? 'Batch Training...' : 'Batch Train All Assets'}
             </button>
           </div>
        </div>

        {/* Ensemble Tuning Panel */}
        <div className="bg-card border border-border p-6 rounded-xl shadow-sm flex flex-col">
           <h2 className="text-lg font-semibold mb-4">Ensemble Voting Weights</h2>
           <p className="text-sm text-muted-foreground mb-6">
              Adjust the voting power of each individual model. The SignalAggregator uses these weights to formulate the master output probability.
           </p>

           <div className="space-y-4 flex-1">
             {Object.entries(localWeights).map(([key, value]) => (
                <div key={key}>
                   <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className="font-mono text-primary">{(value * 100).toFixed(0)}%</span>
                   </div>
                   <input 
                     type="range" 
                     min="0" max="1" step="0.05"
                     value={value}
                     onChange={(e) => setLocalWeights({...localWeights, [key]: parseFloat(e.target.value)})}
                     className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                   />
                </div>
             ))}
           </div>

           <button 
              onClick={saveWeights}
              className="mt-6 w-full flex justify-center items-center gap-2 bg-secondary text-secondary-foreground font-semibold py-2 rounded-md hover:bg-secondary/90 transition-colors"
           >
              <Save className="w-4 h-4" /> Save Weights
           </button>
        </div>
      </div>
    </div>
  );
}
