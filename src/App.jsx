import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useStore } from '@/store/useStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Pages
import DashboardPage from '@/pages/DashboardPage';
import ChartPage from '@/pages/ChartPage';
import ModelsPage from '@/pages/ModelsPage';
import HistoryPage from '@/pages/HistoryPage';
import MonitorPage from '@/pages/MonitorPage';
import SettingsPage from '@/pages/SettingsPage';

// Icons
import { LayoutDashboard, LineChart, BrainCircuit, History, Activity, Settings, Menu } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/chart', label: 'Chart', icon: LineChart },
  { path: '/models', label: 'Models', icon: BrainCircuit },
  { path: '/history', label: 'History', icon: History },
  { path: '/monitor', label: 'API Monitor', icon: Activity },
  { path: '/settings', label: 'Settings', icon: Settings },
];

function Sidebar() {
  const location = useLocation();
  const { isSidebarOpen, toggleSidebar } = useStore();

  return (
    <>
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={toggleSidebar}
        />
      )}
      
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 h-16 flex items-center border-b border-border">
          <span className="font-bold text-lg tracking-tight text-primary">EURUSD Intelligence</span>
        </div>
        
        <nav className="p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link 
                key={item.path} 
                to={item.path}
                onClick={() => window.innerWidth < 768 && toggleSidebar()}
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  );
}

function TopBar() {
  const { toggleSidebar } = useStore();
  
  return (
    <header className="h-16 flex items-center justify-between px-6 bg-card border-b border-border shrink-0">
      <div className="flex items-center">
        <button onClick={toggleSidebar} className="mr-4 md:hidden text-muted-foreground hover:text-foreground">
          <Menu size={20} />
        </button>
        <div className="flex items-center space-x-4">
          <span className="font-mono font-bold text-xl tracking-wider">EUR/USD</span>
        </div>
      </div>
      <div className="flex items-center space-x-4 text-sm">
        <div className="hidden sm:flex items-center space-x-2 bg-muted/50 px-3 py-1 rounded-full border border-border">
          <Activity size={14} className="text-primary" />
          <span className="text-muted-foreground font-mono">Budget:</span>
          <span className="font-bold">0 / 750</span>
        </div>
      </div>
    </header>
  );
}

function Layout({ children }) {
  // Theme initialization
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground dark">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto bg-background">
          {children}
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
            <Route path="/monitor" element={<ErrorBoundary><MonitorPage /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
          </Routes>
        </ErrorBoundary>
      </Layout>
    </BrowserRouter>
  );
}

export default App;

