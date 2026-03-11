import { useStore } from '@/store/useStore';

export class NotificationManager {
  constructor() {
    this.granted = false;
    this.checkPermission();
  }

  checkPermission() {
    if (!("Notification" in window)) {
      console.log("This browser does not support desktop notification");
      return;
    }

    if (Notification.permission === "granted") {
      this.granted = true;
    }
  }

  async requestPermission() {
     if (!("Notification" in window)) return false;
     
     if (Notification.permission !== "denied") {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
           this.granted = true;
           return true;
        }
     }
     return false;
  }

  /**
   * Emits a system notification for a trading signal
   * @param {Object} signalObj 
   */
  notifySignal(signalObj) {
     if (!this.granted || !signalObj || signalObj.signal === 'HOLD') return;

     const symbol = useStore.getState().symbol;
     const title = `🚨 TradeBot: ${symbol} ${signalObj.signal}`;
     const body = `Confidence: ${(signalObj.confidence * 100).toFixed(0)}%\nEntry: ${signalObj.entry}\nSL: ${signalObj.stop_loss}`;
     
     // Generate notification
     const notification = new Notification(title, {
        body: body,
        icon: '/vite.svg', // Default vite icon for now
        tag: 'tradebot-signal' // prevents spam, replaces existing
     });

     notification.onclick = () => {
         window.focus();
         notification.close();
     };
  }
}

export const notificationManager = new NotificationManager();
