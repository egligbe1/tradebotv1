import React, { useEffect, useRef } from 'react';
import { createChart, CrosshairMode, CandlestickSeries } from 'lightweight-charts';

// Determines the correct decimal precision for the price axis based on the asset
function getSymbolPrecision(symbol) {
  const s = (symbol || '').toUpperCase();
  // JPY pairs: 3 decimal places (e.g., 155.123)
  if (s.includes('JPY')) return { precision: 3, minMove: 0.001 };
  // Major Forex pairs: 5 decimal places / pipettes (e.g., 1.08452)
  if (s.includes('/') && !s.includes('XAU') && !s.includes('XAG') && !s.includes('BTC') && !s.includes('ETH'))
    return { precision: 5, minMove: 0.00001 };
  // Crypto: 2 decimal places
  if (s.includes('BTC') || s.includes('ETH')) return { precision: 2, minMove: 0.01 };
  // Gold/Silver: 2 decimal places
  if (s.includes('XAU') || s.includes('XAG')) return { precision: 2, minMove: 0.01 };
  // Stocks & Indices: 2 decimal places
  return { precision: 2, minMove: 0.01 };
}

export function PriceChart({ data, width = 0, height = 400, support, resistance, supportZones = [], resistanceZones = [], signal, symbol = 'EUR/USD' }) {
  const chartContainerRef = useRef();
  const chartRef = useRef();

  useEffect(() => {
    if (!chartContainerRef.current) return;

    let chart;
    try {
        const safeWidth = chartContainerRef.current.clientWidth > 0 ? chartContainerRef.current.clientWidth : 600;
        const safeHeight = height > 0 ? height : 400;

        // Initialize chart
        chart = createChart(chartContainerRef.current, {
          width: safeWidth,
          height: safeHeight,
          layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#d1d5db',
          },
          grid: {
            vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
            horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
          },
          crosshair: { mode: CrosshairMode.Normal },
          rightPriceScale: { borderColor: 'rgba(197, 203, 206, 0.8)' },
          timeScale: { 
            borderColor: 'rgba(197, 203, 206, 0.8)',
            timeVisible: true,
          },
        });

        chartRef.current = chart;

        // lightweight-charts v5 API change: use addSeries instead of addCandlestickSeries
        const { precision, minMove } = getSymbolPrecision(symbol);
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderVisible: false,
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
          priceFormat: {
            type: 'price',
            precision: precision,
            minMove: minMove,
          },
        });

        // Formatting data for lightweight charts
        if (data && data.length > 0) {
          const formattedData = data.map(c => {
             const dtStr = typeof c.datetime === 'string' ? c.datetime.replace(' ', 'T') + 'Z' : new Date(c.datetime).toISOString();
             const dt = new Date(dtStr);
             return {
                time: Math.floor(dt.getTime() / 1000), 
                open: Number(c.open),
                high: Number(c.high),
                low: Number(c.low),
                close: Number(c.close)
             }
          });
          
          const uniqueData = Array.from(new Map(formattedData.map(item => [item.time, item])).values());
          uniqueData.sort((a,b) => a.time - b.time);
          
          candleSeries.setData(uniqueData);
          
          // --- Strongest Support & Resistance Lines ---
          if (support) {
             candleSeries.createPriceLine({
                price: support,
                color: '#10b981', // green-500
                lineWidth: 2,
                lineStyle: 0, // Solid for primary
                axisLabelVisible: true,
                title: 'Strong Support',
             });
          }
          if (resistance) {
             candleSeries.createPriceLine({
                price: resistance,
                color: '#ef4444', // red-500
                lineWidth: 2,
                lineStyle: 0, // Solid for primary
                axisLabelVisible: true,
                title: 'Strong Resistance',
             });
          }
          if (signal && signal.signal !== 'HOLD' && signal.entry) {
             const markerColor = signal.signal === 'BUY' ? '#10b981' : '#ef4444';
             const lastCandle = uniqueData[uniqueData.length - 1];
             
             // 🎯 Signal Markers on Candles
             candleSeries.setMarkers([
                {
                   time: lastCandle.time,
                   position: signal.signal === 'BUY' ? 'belowBar' : 'aboveBar',
                   color: markerColor,
                   shape: signal.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
                   text: `${signal.signal} @ ${signal.entry}`,
                   size: 2
                }
             ]);

             candleSeries.createPriceLine({
                price: parseFloat(signal.entry),
                color: markerColor,
                lineWidth: 2,
                lineStyle: 1, // Dotted for entry
                axisLabelVisible: true,
                title: `${signal.signal} ENTRY`,
             });

             if (signal.stop_loss) {
                candleSeries.createPriceLine({
                   price: parseFloat(signal.stop_loss),
                   color: '#f87171',
                   lineWidth: 1, lineStyle: 3,
                   axisLabelVisible: true, title: 'SL',
                });
             }
             if (signal.take_profit_1) {
                candleSeries.createPriceLine({
                   price: parseFloat(signal.take_profit_1),
                   color: '#34d399',
                   lineWidth: 1, lineStyle: 3,
                   axisLabelVisible: true, title: 'TP1',
                });
             }
          } else {
             candleSeries.setMarkers([]);
          }

          chart.timeScale().fitContent();
        }

        // Auto-resize handler
        const handleResize = () => {
          if (chart && chartContainerRef.current && chartContainerRef.current.clientWidth > 0) {
             chart.applyOptions({ width: chartContainerRef.current.clientWidth });
          }
        };

        window.addEventListener('resize', handleResize);

        return () => {
          window.removeEventListener('resize', handleResize);
          if (chart) {
             chart.remove();
          }
        };
    } catch (e) {
        console.log("Error initializing chart:", e);
        return () => {};
    }
  }, [data, height, support, resistance, supportZones, resistanceZones, signal, symbol]);

  return (
    <div className="w-full relative bg-card border border-border rounded-xl overflow-hidden shadow-md">
       <div className="absolute top-4 left-4 z-10 text-sm font-semibold tracking-wider opacity-80 backdrop-blur-sm bg-background/50 px-2 py-1 rounded">
         {symbol}  &bull; H1
       </div>
       <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
