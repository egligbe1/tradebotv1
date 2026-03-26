export class NewsFilterService {
  constructor() {
    // Free JSON endpoint proxying the ForexFactory economic calendar
    this.API_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
    this.cache = null;
    this.lastFetch = 0;
  }

  async fetchCalendar() {
    const now = Date.now();
    // Cache the calendar for 4 hours to avoid unecessary network calls
    if (this.cache && (now - this.lastFetch < 4 * 60 * 60 * 1000)) {
      return this.cache;
    }

    try {
      const res = await fetch(this.API_URL);
      if (!res.ok) throw new Error('Network response was not ok');
      this.cache = await res.json();
      this.lastFetch = now;
      console.log("[NewsFilter] Successfully synced weekly economic calendar.");
      return this.cache;
    } catch (error) {
      console.error("[NewsFilter] Error fetching economic calendar. Defaulting to safe (fail-open):", error.message);
      return []; // Fail open so the bot doesn't completely freeze if the unofficial API goes down
    }
  }

  /**
   * Evaluates if there is dangerous Tier-1 economic news imminent.
   * @param {string} symbol - e.g. 'EUR/USD' or 'BTC/USD'
   * @param {number} thresholdHours - How many hours before/after news to block trading
   * @returns {boolean} true if safe to trade, false if dangerous
   */
  async isSafeToTrade(symbol, thresholdHours = 2) {
    const calendar = await this.fetchCalendar();
    if (!calendar || calendar.length === 0) return true; // Fail open

    const currencies = symbol.split('/');
    if (currencies.length !== 2) return true;

    const baseCurrency = currencies[0];
    const quoteCurrency = currencies[1];

    const nowTime = new Date().getTime();
    const thresholdMs = thresholdHours * 60 * 60 * 1000;

    for (const event of calendar) {
      if (event.impact === 'High') {
        const eventCurrency = event.country.trim().toUpperCase();
        // Check if the high impact news affects our specific asset pair
        if (eventCurrency === baseCurrency || eventCurrency === quoteCurrency) {
          const eventTime = new Date(event.date).getTime();
          
          if (!isNaN(eventTime)) {
            const timeDiff = Math.abs(eventTime - nowTime);
            
            // If we are inside the blast radius of the news event
            if (timeDiff <= thresholdMs) {
              console.warn(`[NewsFilter] 🚨 KILL SWITCH ACTIVATED 🚨 -> ${symbol} blocked due to High Impact News: "${event.title}" for ${eventCurrency} within ${thresholdHours} hours.`);
              return false;
            }
          }
        }
      }
    }

    return true; // Coast is clear
  }
}

export const newsFilterService = new NewsFilterService();
