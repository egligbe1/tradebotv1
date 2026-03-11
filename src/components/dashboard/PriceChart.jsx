import React, { useEffect, useRef } from 'react';
import { createChart, CrosshairMode, CandlestickSeries } from 'lightweight-charts';

export function PriceChart({ data, width = 0, height = 400 }) {
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
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderVisible: false,
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
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
  }, [data, height]);

  return (
    <div className="w-full relative bg-card border border-border rounded-xl overflow-hidden shadow-md">
       <div className="absolute top-4 left-4 z-10 text-sm font-semibold tracking-wider opacity-80 backdrop-blur-sm bg-background/50 px-2 py-1 rounded">
         EUR/USD  &bull; H1
       </div>
       <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
