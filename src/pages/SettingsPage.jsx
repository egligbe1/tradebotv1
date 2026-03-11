import { useStore } from '@/store/useStore';

export default function SettingsPage() {
  const apiKey = useStore((state) => state.apiKey);
  const setApiKey = useStore((state) => state.setApiKey);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="bg-card p-6 rounded-lg border border-border shadow-sm mb-6">
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

      <div className="text-xs text-muted-foreground mt-8 text-center opacity-70">
        <p className="mb-2 uppercase tracking-wide">Legal Disclaimer</p>
        <p>This application is for educational and informational purposes only. Past model performance does not guarantee future results. This is not financial advice. Never risk money you cannot afford to lose. Always apply your own judgment before executing any trade. The developer of this application bears no responsibility for trading losses.</p>
      </div>
    </div>
  );
}
