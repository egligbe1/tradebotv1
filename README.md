# TradeBot AI

TradeBot AI is a sophisticated, browser-based algorithmic trading dashboard. It fuses traditional Technical Analysis with advanced Machine Learning (TensorFlow.js) to generate high-probability trade signals across Forex, Crypto, Stocks, and Indices.

Everything—data fetching, feature engineering, neural network training, and signal aggregation—happens entirely client-side, making it incredibly fast, private, and cost-effective.

## 🔥 Key Features

### 1. Dynamic Asset Selection
Instantly switch between major markets (e.g., `EUR/USD`, `XAU/USD`, `BTC/USD`, `SPX`, `AAPL`) using the global dropdown selector. The dashboard, charts, and AI brains automatically sync to the new asset.

### 2. Multi-Model AI Ensemble
The `SignalAggregator` acts as the master brain, weighing the votes of four independent models:
- **Deep Learning (LSTM)**: A recurrent neural network built with TensorFlow.js. It analyzes sequential time-series data to understand market context and trends.
- **Random Forest**: Decision trees that look for non-linear indicator clusters to filter out noise.
- **Logistic Regression**: A linear statistical model that evaluates immediate term probabilities.
- **Technical Rule Engine**: Hardcoded traditional analysis (e.g., Engulfing candles bouncing off Support lines).

You can dynamically adjust the voting weight of each model in the **Models** dashboard based on your strategy.

### 3. Isolated "Brains" (IndexedDB)
When you train a model on a specific asset (like Gold), the neural network weights are securely saved to your browser's persistent IndexedDB via `@tensorflow/tfjs`, logically scoped by the asset symbol (e.g., `indexeddb://xauusd-lstm-model`). This prevents cross-asset contamination (e.g., predicting Gold using Euro logic).

### 4. Interactive Visualizations
- **TradingView Charts**: High-performance, interactive candlestick charts powered by `lightweight-charts`.
- **Dynamic Structure**: The bot's internal calculation of dynamic Support & Resistance zones, as well as calculated Trade Entry / Stop Loss vectors, are drawn directly onto the charts in real-time.
- **Historical Backtesting**: An integrated simulator charts equity curves over 1,000+ historical candles.

### 5. Smart Data Management
Built on top of the **Twelve Data API**, specifically optimized to squeeze maximum performance out of the Free Tier. The `DataManager` utilizes smart indexed caching to prevent redundant API calls, backfills missing historical memory, and honors tight rate-limit parameters sequentially.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- A [Twelve Data API Key](https://twelvedata.com/)

### Installation

1. Clone the repository and navigate into the folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and add your Twelve Data API key:
   ```env
   VITE_TWELVE_DATA_API_KEY=your_api_key_here
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

### Production Deployment (Render)
This project is configured as a Node.js Web Service to bypass frontend static-site limitations and handle Single Page Application (SPA) routing manually using Express 5.

**Commands for Render Setup:**
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (Runs `server.js`)

---

## 🧠 How to Train the AI

When you select a brand new asset for the first time, its Neural Network (LSTM) will be empty. To maximize accuracy:

1. Select your target asset (e.g., `BTC/USD`) from the top navigation bar.
2. Wait a few seconds for the `DataManager` to query and cache the maximum historical limit (~5,000 hourly candles).
3. Navigate to the **Models** tab in the sidebar.
4. Click **Trigger Walk-Forward Retrain**.
5. The browser will compile TensorFlow layers and step through 50 epochs of deep learning right on your device. Once finished, the bot is ready to generate live signals!

---

## 🛠 Tech Stack
- **Frontend**: React, Vite, Tailwind CSS, Lucide Icons, Zustand (State Management)
- **Machine Learning**: `@tensorflow/tfjs`, `ml-random-forest`, `ml-logistic-regression`
- **Charting / Visualization**: `lightweight-charts`, `recharts`
- **Storage / Caching**: `dexie` (IndexedDB)
- **Routing & Server**: `react-router-dom`, Express.js
