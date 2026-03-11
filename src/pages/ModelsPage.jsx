import React, { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { dataManager } from '@/services/DataManager';
import { FeatureEngine } from '@/services/FeatureEngine';
import { signalAggregator } from '@/services/SignalAggregator';
import { Brain, Play, Save, RefreshCw } from 'lucide-react';

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

  const handleRetrainLSTM = async () => {
     if (!apiKey) return alert("API Key required to fetch data for training.");
     const symbol = useStore.getState().symbol;
     
     setTrainingState({ 
        isTraining: true, epoch: 0, loss: 0, accuracy: 0, sequences: 0, validRows: 0,
        message: `Fetching historical data for ${symbol}...` 
     });
     
     try {
       const data = await dataManager.getCandles(symbol, '1h', 3000);
       const features = FeatureEngine.extractFeatures(data.values);
       
       setTrainingState(prev => ({ ...prev, message: 'Compiling TensorFlow layers...' }));
       
       await signalAggregator.models.lstm.train(
          features, 
          (epoch, logs) => {
             setTrainingState(prev => ({
                 ...prev,
                 epoch: epoch + 1,
                 loss: logs.loss || 0,
                 accuracy: logs.acc || 0,
                 message: `Training epoch ${epoch + 1}/50...`
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
          epoch: 50, 
          message: 'Training complete. Weights saved to IndexedDB.' 
       }));
     } catch (e) {
         setTrainingState(prev => ({ 
            ...prev, 
            isTraining: false, 
            message: `Training failed: ${e.message}` 
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
              <h2 className="text-lg font-semibold">TensorFlow.js LSTM Serverless Training</h2>
           </div>
           
           <p className="text-sm text-muted-foreground mb-6">
              Sequences are trained directly in your browser. This model learns from the latest 500 H1 candles 
              and maps sequential Feature Matrices to identify trend continuations.
           </p>

           <div className="bg-muted/30 p-4 rounded-lg border border-border/50 mb-6">
              <div className="flex justify-between text-xs mb-1 font-mono">
                 <span className={`${trainingState.isTraining ? 'text-primary animate-pulse' : 'text-muted-foreground'}`}>
                    {trainingState.message}
                 </span>
                 {trainingState.isTraining && <span>Epoch {trainingState.epoch}/50</span>}
              </div>
              <div className="w-full bg-background rounded-full h-2 overflow-hidden mb-2">
                 <div className="bg-primary h-2 transition-all duration-300" style={{ width: `${(trainingState.epoch / 50) * 100}%` }}></div>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                 <span>Loss: {trainingState.loss.toFixed(4)}</span>
                 <span>Acc: {(trainingState.accuracy * 100).toFixed(1)}%</span>
                 <span>Seqs: {trainingState.sequences}</span>
              </div>
           </div>

           <button 
              onClick={handleRetrainLSTM}
              disabled={trainingState.isTraining}
              className="w-full flex justify-center items-center gap-2 bg-primary text-primary-foreground font-semibold py-2 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
           >
              {trainingState.isTraining ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {trainingState.isTraining ? 'Training Model...' : 'Trigger Walk-Forward Retrain'}
           </button>
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
