import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const AVAILABLE_SYMBOLS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD'];

export const useStore = create(
  persist(
    (set) => ({
      // Settings
      apiKey: import.meta.env.VITE_TWELVE_DATA_API_KEY || '',
      setApiKey: (key) => set({ apiKey: key }),

      telegramBotToken: '',
      setTelegramBotToken: (token) => set({ telegramBotToken: token }),

      telegramChatId: '',
      setTelegramChatId: (id) => set({ telegramChatId: id }),

      enableBrowserNotifications: false,
      setEnableBrowserNotifications: (enabled) => set({ enableBrowserNotifications: enabled }),

      symbol: 'EUR/USD',
      setSymbol: (sym) => set({ symbol: sym }),

      timeframe: '1h',
      setTimeframe: (tf) => set({ timeframe: tf }),

      modelWeights: {
        logistic: 0.10,
        lstm: 0.35,
        randomForest: 0.20,
        ruleEngine: 0.35,
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
