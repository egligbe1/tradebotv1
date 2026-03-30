import Dexie from 'dexie';

export class HardLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HardLimitError';
  }
}

class DataManager {
  constructor() {
    this.memCache = new Map();
    this.queue = [];
    this.isProcessing = false;
    
    // Limits based on Twelve Data Free Tier
    this.DAILY_HARD_LIMIT = 750;
    this.CALL_SPACING_MS = 7500; // 8 calls per minute
    this.lastCallTime = 0;

    // Database Initialization
    this.db = new Dexie('TradingDB');
    this.db.version(1).stores({
      candles: '[symbol+interval+datetime], symbol, interval, datetime',
      callLog: '++id, date, endpoint, latency'
    });
  }

  getTodayKey() {
    const today = new Date().toISOString().split('T')[0];
    return `td_calls_${today}`;
  }

  getDailyCallCount() {
    const count = localStorage.getItem(this.getTodayKey());
    return count ? parseInt(count, 10) : 0;
  }

  incrementDailyCallCount() {
    const count = this.getDailyCallCount() + 1;
    localStorage.setItem(this.getTodayKey(), count.toString());
    return count;
  }

  logCall(endpoint, symbol, interval, success, latency) {
    const logEntry = {
      date: new Date().toISOString(),
      endpoint,
      symbol,
      interval,
      success,
      latency
    };
    
    // Asynchronous logging to Dexie so it doesn't block
    this.db.callLog.add(logEntry).then(() => {
       // Optional: prune old logs asynchronously if they grow too large
       this.db.callLog.count().then(count => {
           if (count > 500) {
               this.db.callLog.orderBy('id').limit(count - 500).delete();
           }
       });
    }).catch(e => console.log("Failed to log API call to Dexie", e));
  }

  async fetchWithRateLimit(url, symbol, interval) {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, symbol, interval, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      if (this.getDailyCallCount() >= this.DAILY_HARD_LIMIT) {
        const error = new HardLimitError(`Daily API limit of ${this.DAILY_HARD_LIMIT} calls reached. Data fetching is paused until tomorrow.`);
        this.queue.forEach(req => req.reject(error));
        this.queue = [];
        break;
      }

      const now = Date.now();
      const timeSinceLastCall = now - this.lastCallTime;
      
      // Enforce pacing (7.5s between calls)
      if (timeSinceLastCall < this.CALL_SPACING_MS) {
        const delay = this.CALL_SPACING_MS - timeSinceLastCall;
        await new Promise(r => setTimeout(r, delay));
      }

      const request = this.queue.shift();
      this.lastCallTime = Date.now();
      this.incrementDailyCallCount();

      const startTime = performance.now();
      try {
        const response = await fetch(request.url);
        const data = await response.json();
        const latency = performance.now() - startTime;
        
        const endpointRaw = request.url.split('?')[0];
        const isSuccess = response.ok && data.status !== 'error';
        this.logCall(endpointRaw, request.symbol, request.interval, isSuccess, Math.round(latency));
        
        if (data.status === 'error') {
          if (data.code === 429) {
            console.warn('429 Too Many Requests hit.');
            // Push back to queue to retry later
            this.queue.unshift(request);
            await new Promise(r => setTimeout(r, 30000));
            continue;
          } else if (data.code === 401) {
             throw new Error('API Key invalid');
          }
          throw new Error(data.message || 'Twelve Data API Error');
        }

        request.resolve(data);
      } catch (error) {
        const latency = performance.now() - startTime;
        const endpointRaw = request.url.split('?')[0];
        this.logCall(endpointRaw, request.symbol, request.interval, false, Math.round(latency));
        request.reject(error);
      }
    }
    
    this.isProcessing = false;
  }

  async getCandles(symbol, interval, outputsize = 500) {
    const storageRaw = localStorage.getItem('trading-platform-storage');
    const apiKey = storageRaw ? JSON.parse(storageRaw).state?.apiKey : null;
    
    if (!apiKey) {
       throw new Error('Twelve Data API Key is missing. Please set it in Settings.');
    }

    const cachedCandles = await this.db.candles
      .where('[symbol+interval+datetime]')
      .between([symbol, interval, Dexie.minKey], [symbol, interval, Dexie.maxKey])
      .reverse()
      .limit(outputsize)
      .toArray();

    // Sort ascending for the engine
    cachedCandles.sort((a, b) => a.datetime.localeCompare(b.datetime));

    const mostRecentItem = cachedCandles.length > 0 ? cachedCandles[cachedCandles.length - 1] : null;
    const mostRecentCachedTime = mostRecentItem ? new Date(mostRecentItem.datetime.replace(' ', 'T') + 'Z') : null;
    const now = new Date();
    const diffMinutes = mostRecentCachedTime ? (now.getTime() - mostRecentCachedTime.getTime()) / 1000 / 60 : Infinity;
    
    const isFresh = (interval === '1h' && diffMinutes < 65) || 
                    (interval === '4h' && diffMinutes < 245) ||
                    (interval === '1day' && diffMinutes < 1440);

    const cacheKey = `${symbol}_${interval}`;
    
    // We cap fetch at 5000 for Twelve Data standard requests (Free Tier max).
    let fetchOutputSize = Math.min(outputsize, 5000);

    // Smart Delta Logic
    if (cachedCandles.length >= outputsize) {
       if (isFresh) {
          console.log(`[DataManager] Using pure cache for ${cacheKey}. Data is fresh.`);
          return {
             meta: { symbol, interval, currency_base: symbol.split('/')[0], currency_quote: symbol.split('/')[1] },
             values: cachedCandles,
             status: 'ok',
             isCached: true
          };
       } else {
          // Data stale, fetch latest delta
          console.log(`[DataManager] Data is stale for ${cacheKey}. Fetching latest updates.`);
          fetchOutputSize = 48; 
       }
    } else {
       // We don't have enough data at all, fetch up to the requested size
       console.log(`[DataManager] Insufficient cache for ${cacheKey}. Fetching full outputsize.`);
       fetchOutputSize = Math.min(outputsize, 5000);
    }

    // 2. Fetch from API
    console.log(`[DataManager] Fetching ${fetchOutputSize} candles from API for ${cacheKey}. (Requested: ${outputsize})`);
    const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${fetchOutputSize}&apikey=${apiKey}`;
    
    const apiData = await this.fetchWithRateLimit(url, symbol, interval);

    // 3. Persist fetched data to IndexedDB
    if (apiData && apiData.values) {
       // Convert values to DB schema
       const newCandles = apiData.values.map(c => ({
           symbol,
           interval,
           datetime: c.datetime,
           open: parseFloat(c.open),
           high: parseFloat(c.high),
           low: parseFloat(c.low),
           close: parseFloat(c.close),
           volume: parseFloat(c.volume)
       }));

       // bulkPut updates existing records (by primary key array) or inserts new ones
       await this.db.candles.bulkPut(newCandles);
       console.log(`[DataManager] Saved ${newCandles.length} new/updated candles to IndexedDB.`);

       // 4. Merge API data and Cache Data for correct return
       const mergedCandles = await this.db.candles
          .where('[symbol+interval+datetime]')
          .between([symbol, interval, Dexie.minKey], [symbol, interval, Dexie.maxKey])
          .reverse()
          .limit(outputsize)
          .toArray();

       // Sort Ascending before returning to the UI
       mergedCandles.sort((a, b) => a.datetime.localeCompare(b.datetime));

       // Map it back to the expected API shape
       apiData.values = mergedCandles;
       apiData.isCached = false;
       return apiData;
    }

    return apiData;
  }
  /**
   * Clears the entire candle cache to allow for a fresh start.
   */
  async clearCache() {
    console.log("[DataManager] Purging candle cache...");
    await this.db.candles.clear();
    this.memCache.clear();
    console.log("[DataManager] Cache cleared successfully.");
  }

  /**
   * Fetches the maximum allowable history (5,000 candles) for a symbol to maximize AI accuracy.
   */
  async fetchHighFidelityHistory(symbol, interval = '1h') {
    console.log(`[DataManager] Deep fetching 5,000 candles for ${symbol}...`);
    return await this.getCandles(symbol, interval, 5000);
  }
}

export const dataManager = new DataManager();
