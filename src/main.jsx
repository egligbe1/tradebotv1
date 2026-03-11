import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Prevent Vite error overlay from stealing the screen on caught API errors
window.addEventListener('unhandledrejection', (event) => {
  console.log('[Global] Caught unhandled rejection:', event.reason?.message || event.reason);
  event.preventDefault();
});

createRoot(document.getElementById('root')).render(
  <App />
)
