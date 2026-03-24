import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const AVAILABLE_SYMBOLS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'SPX', 'AAPL'];

export const useStore = create(
  persist(
    (set) => ({
      // Settings
      apiKey: import.meta.env.VITE_TWELVE_DATA_API_KEY || '',
      setApiKey: (key) => set({ apiKey: key }),

      symbol: 'EUR/USD',
      setSymbol: (sym) => set({ symbol: sym }),

      timeframe: '1h',
      setTimeframe: (tf) => set({ timeframe: tf }),

      modelWeights: {
        logistic: 0.15,
        lstm: 0.40,
        randomForest: 0.25,
        ruleEngine: 0.20,
      },
      setModelWeights: (weights) => set({ modelWeights: weights }),

      // UI State
      isSidebarOpen: false,
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
    }),
    {
      name: 'trading-platform-storage', // saves to localStorage automatically
    }
  )
);
