import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

class SyncManager {
  constructor() {
    this.enabled = !!supabase;
  }

  /**
   * Uploads model weights to Supabase
   * @param {string} symbol - e.g. 'EURUSD'
   * @param {string} modelName - 'lstm', 'logistic', or 'randomforest'
   * @param {Object} weights - Serialized model data
   */
  async uploadModel(symbol, modelName, weights) {
    if (!this.enabled) return;

    try {
      const { data, error } = await supabase
        .from('model_sync')
        .upsert({
          symbol: symbol.replace('/', ''),
          model_name: modelName,
          weights: weights,
          updated_at: new Date().toISOString()
        }, { onConflict: 'symbol,model_name' });

      if (error) throw error;
      console.log(`[SyncManager] Successfully uploaded ${modelName} for ${symbol}`);
      return true;
    } catch (e) {
      console.error(`[SyncManager] Upload failed for ${modelName}:`, e.message);
      return false;
    }
  }

  /**
   * Downloads model weights from Supabase
   * @param {string} symbol 
   * @param {string} modelName 
   */
  async downloadModel(symbol, modelName) {
    if (!this.enabled) return null;

    try {
      const { data, error } = await supabase
        .from('model_sync')
        .select('weights')
        .eq('symbol', symbol.replace('/', ''))
        .eq('model_name', modelName)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      console.log(`[SyncManager] Successfully downloaded ${modelName} for ${symbol}`);
      return data.weights;
    } catch (e) {
      console.error(`[SyncManager] Download failed for ${modelName}:`, e.message);
      return null;
    }
  }
}

export const syncManager = new SyncManager();
