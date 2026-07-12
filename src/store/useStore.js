import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const AVAILABLE_SYMBOLS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD'];

// Normalize a user-typed symbol to Twelve Data's "BASE/QUOTE" (or ticker) form.
export function normalizeSymbol(raw) {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

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
      setSymbol: (sym) => set({ symbol: normalizeSymbol(sym) }),

      // User-added instruments (any Twelve Data symbol) beyond the built-ins.
      customSymbols: [],
      addSymbol: (sym) => set((state) => {
        const s = normalizeSymbol(sym);
        if (!s || AVAILABLE_SYMBOLS.includes(s) || state.customSymbols.includes(s)) {
          return { symbol: s || state.symbol };
        }
        return { customSymbols: [...state.customSymbols, s], symbol: s };
      }),
      removeSymbol: (sym) => set((state) => ({
        customSymbols: state.customSymbols.filter((s) => s !== sym),
      })),

      // Map of symbol → 'ok' | 'plan' | 'error', populated by the plan-access check.
      symbolSupport: {},
      setSymbolSupport: (map) => set((state) => ({ symbolSupport: { ...state.symbolSupport, ...map } })),

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
