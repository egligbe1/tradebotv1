import { useStore } from '@/store/useStore';
import { notificationManager } from '@/services/NotificationManager';
import { telegramService } from '@/services/TelegramService';
import { Bell, Send, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';

export default function SettingsPage() {
  const apiKey = useStore((state) => state.apiKey);
  const setApiKey = useStore((state) => state.setApiKey);
  
  const telegramBotToken = useStore((state) => state.telegramBotToken);
  const setTelegramBotToken = useStore((state) => state.setTelegramBotToken);
  const telegramChatId = useStore((state) => state.telegramChatId);
  const setTelegramChatId = useStore((state) => state.setTelegramChatId);
  const enableBrowserNotifications = useStore((state) => state.enableBrowserNotifications);
  const setEnableBrowserNotifications = useStore((state) => state.setEnableBrowserNotifications);

  const [testStatus, setTestStatus] = useState({ loading: false, success: null, message: '' });

  const handleTestBrowser = async () => {
     const granted = await notificationManager.requestPermission();
     if (granted) {
        setEnableBrowserNotifications(true);
        notificationManager.notifySignal({
           signal: 'BUY',
           confidence: 0.99,
           entry: 'TEST_SUCCESS',
           stop_loss: '0.0000'
        }, 'TEST_ASSET');
     } else {
        alert("Notification permission denied by browser.");
     }
  };

  const handleTestTelegram = async () => {
    setTestStatus({ loading: true, success: null, message: 'Sending test message...' });
    try {
      await telegramService.sendAlert('TEST_ASSET', {
        signal: 'BUY',
        confidence: 0.99,
        entry: '1.2345',
        stop_loss: '1.2300',
        take_profit_1: '1.2400',
        take_profit_2: '1.2500'
      });
      setTestStatus({ loading: false, success: true, message: 'Message sent! Check your Telegram.' });
      setTimeout(() => setTestStatus({ loading: false, success: null, message: '' }), 5000);
    } catch (e) {
      setTestStatus({ loading: false, success: false, message: e.message });
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="glass-card p-8 rounded-2xl shadow-xl mb-8">
        <h2 className="text-lg font-semibold mb-4 text-primary">Twelve Data API Configuration</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input 
              type="password" 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Twelve Data API key"
              className="w-full p-2 rounded-md bg-background border border-input text-foreground focus:ring-2 focus:ring-ring focus:outline-none"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Your API key is stored securely in your browser's local storage and is never sent to any server except Twelve Data.
            </p>
          </div>
        </div>
      </div>

      <div className="glass-card p-8 rounded-2xl shadow-xl mb-8">
        <div className="flex items-center gap-3 mb-4 text-primary">
          <Bell className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Live Browser Notifications</h2>
        </div>
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-md border border-border/50">
          <div>
            <p className="text-sm font-medium">Enable Desktop Alerts</p>
            <p className="text-xs text-muted-foreground mt-1">Receive signals even when the tab is in the background.</p>
          </div>
          <div className="flex items-center gap-3">
             <button 
                onClick={handleTestBrowser}
                className="text-xs bg-secondary hover:bg-secondary/80 px-3 py-1.5 rounded font-medium transition-colors"
             >
                Test Alert
             </button>
             <button 
                onClick={() => setEnableBrowserNotifications(!enableBrowserNotifications)}
                className={`w-12 h-6 rounded-full transition-colors relative ${enableBrowserNotifications ? 'bg-primary' : 'bg-muted-foreground/30'}`}
             >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${enableBrowserNotifications ? 'left-7' : 'left-1'}`} />
             </button>
          </div>
        </div>
      </div>

      <div className="glass-card p-8 rounded-2xl shadow-xl mb-8">
        <div className="flex items-center gap-3 mb-4 text-primary">
          <Send className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Telegram Mobile Alerts</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          High-conviction signals are pushed to your phone via Telegram Bot API. 
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1">Get a token from @BotFather</a>
        </p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Bot Token</label>
            <input 
              type="password" 
              value={telegramBotToken}
              onChange={(e) => setTelegramBotToken(e.target.value)}
              placeholder="123456789:ABCDefGhIJKlmNoP..."
              className="w-full p-2 rounded-md bg-background border border-input text-foreground focus:ring-2 focus:ring-ring focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Chat ID</label>
            <input 
              type="text" 
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="Your Numeric Chat ID"
              className="w-full p-2 rounded-md bg-background border border-input text-foreground focus:ring-2 focus:ring-ring focus:outline-none"
            />
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              Find your ID via <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="underline hover:text-primary">@userinfobot</a>
            </p>
          </div>

          <button 
            onClick={handleTestTelegram}
            disabled={testStatus.loading || !telegramBotToken || !telegramChatId}
            className="w-full flex justify-center items-center gap-2 bg-secondary text-secondary-foreground font-semibold py-2 rounded-md hover:bg-secondary/90 transition-colors disabled:opacity-50"
          >
            {testStatus.loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Test Telegram Connection
          </button>
          
          {testStatus.message && (
             <div className={`text-xs p-3 rounded-md flex items-center gap-2 ${testStatus.success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-destructive/10 text-destructive'}`}>
                {testStatus.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {testStatus.message}
             </div>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground mt-8 text-center opacity-70">
        <p className="mb-2 uppercase tracking-wide">Legal Disclaimer</p>
        <p>This application is for educational and informational purposes only. Past model performance does not guarantee future results. This is not financial advice. Never risk money you cannot afford to lose. Always apply your own judgment before executing any trade. The developer of this application bears no responsibility for trading losses.</p>
      </div>
    </div>
  );
}
