import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useStore, AVAILABLE_SYMBOLS } from '@/store/useStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { realtimeAlertManager } from '@/services/RealtimeAlertManager';
import { isTelegramWindowOpen } from '@/lib/signalMessage';
import { classifySymbol } from '@/lib/assetConfig';

// Pages
import DashboardPage from '@/pages/DashboardPage';
import ChartPage from '@/pages/ChartPage';
import ModelsPage from '@/pages/ModelsPage';
import HistoryPage from '@/pages/HistoryPage';
import MonitorPage from '@/pages/MonitorPage';
import SettingsPage from '@/pages/SettingsPage';
import BacktestPage from '@/pages/BacktestPage';
import PortfolioPage from '@/pages/PortfolioPage';

// Icons
import {
  LayoutDashboard, LineChart, BrainCircuit, History, Activity, Settings,
  Menu, TrendingUp, Briefcase, CandlestickChart, ChevronDown, Radio,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    label: 'Trade',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/chart', label: 'Chart', icon: LineChart },
      { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
    ],
  },
  {
    label: 'Research',
    items: [
      { path: '/models', label: 'Models', icon: BrainCircuit },
      { path: '/backtest', label: 'Backtest', icon: TrendingUp },
      { path: '/history', label: 'History', icon: History },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/monitor', label: 'API Monitor', icon: Activity },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// Ticks once per second so the GMT session rail stays live.
function useUtcClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const pad = (n) => String(n).padStart(2, '0');
const gmtTime = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

function Sidebar() {
  const location = useLocation();
  const { isSidebarOpen, toggleSidebar } = useStore();
  const now = useUtcClock();
  const alertsLive = isTelegramWindowOpen(now);

  return (
    <>
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden" onClick={toggleSidebar} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 surface border-r flex flex-col transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand */}
        <div className="px-5 h-16 flex items-center gap-3 border-b border-border">
          <div className="grid place-items-center h-9 w-9 rounded-lg bg-primary text-primary-foreground glow-primary">
            <CandlestickChart className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-display font-bold text-[15px] tracking-tight">TradeBot<span className="text-primary"> AI</span></div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Quant Terminal</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => window.innerWidth < 768 && toggleSidebar()}
                      className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
                    >
                      <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                      <Icon size={17} className={isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer status */}
        <div className="p-3 border-t border-border">
          <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-pulse-soft absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
                Engine
              </span>
              <span className="font-mono text-foreground">Paper</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground"><Radio size={12} /> Alerts</span>
              <span className={`font-mono ${alertsLive ? 'text-success' : 'text-muted-foreground'}`}>
                {alertsLive ? 'LIVE' : 'Off-hours'}
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function TopBar() {
  const { toggleSidebar, symbol, setSymbol, customSymbols } = useStore();
  const now = useUtcClock();
  const alertsLive = isTelegramWindowOpen(now);
  const symbols = [...AVAILABLE_SYMBOLS, ...(customSymbols || [])];
  if (symbol && !symbols.includes(symbol)) symbols.push(symbol);

  return (
    <header className="h-16 flex items-center justify-between gap-4 px-4 sm:px-6 surface border-b shrink-0">
      <div className="flex items-center gap-3">
        <button onClick={toggleSidebar} className="md:hidden text-muted-foreground hover:text-foreground">
          <Menu size={20} />
        </button>

        {/* Instrument ticker */}
        <div className="relative flex items-center rounded-lg bg-secondary/70 border border-border pl-3 pr-8 h-10">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-2 hidden sm:inline">{classifySymbol(symbol)}</span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="appearance-none bg-transparent text-primary font-mono font-bold text-lg tracking-wider cursor-pointer outline-none"
          >
            {symbols.map((sym) => <option key={sym} value={sym} className="bg-popover text-foreground">{sym}</option>)}
          </select>
          <ChevronDown size={16} className="absolute right-2.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Signature: live GMT session rail tied to the 08:00–15:00 alert window */}
      <div className="flex items-center gap-2 sm:gap-3 text-sm">
        <div className="hidden sm:flex items-center gap-2 rounded-full bg-muted/50 border border-border px-3 h-9">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">GMT</span>
          <span className="font-mono tnum font-semibold text-foreground">{gmtTime(now)}</span>
        </div>
        <div className={`flex items-center gap-2 rounded-full px-3 h-9 border transition-colors ${alertsLive ? 'bg-success/10 border-success/30 text-success' : 'bg-muted/40 border-border text-muted-foreground'}`}>
          <span className="relative flex h-2 w-2">
            {alertsLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${alertsLive ? 'bg-success' : 'bg-muted-foreground'}`} />
          </span>
          <span className="text-xs font-medium whitespace-nowrap">{alertsLive ? 'Signal window open' : 'Signals 08–15 GMT'}</span>
        </div>
      </div>
    </header>
  );
}

function Layout({ children }) {
  useEffect(() => {
    document.documentElement.classList.add('dark');
    realtimeAlertManager.start();
    return () => realtimeAlertManager.stop();
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground dark">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        {/* thin gradient accent rail */}
        <div className="h-0.5 w-full bg-gradient-to-r from-primary/70 via-accent/40 to-transparent" />
        <TopBar />
        <main className="flex-1 overflow-auto">
          <div className="animate-fade-up">{children}</div>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
            <Route path="/chart" element={<ErrorBoundary><ChartPage /></ErrorBoundary>} />
            <Route path="/models" element={<ErrorBoundary><ModelsPage /></ErrorBoundary>} />
            <Route path="/history" element={<ErrorBoundary><HistoryPage /></ErrorBoundary>} />
            <Route path="/backtest" element={<ErrorBoundary><BacktestPage /></ErrorBoundary>} />
            <Route path="/portfolio" element={<ErrorBoundary><PortfolioPage /></ErrorBoundary>} />
            <Route path="/monitor" element={<ErrorBoundary><MonitorPage /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
