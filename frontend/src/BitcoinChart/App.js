import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import {
  VictoryChart,
  VictoryCandlestick,
  VictoryLine,
  VictoryAxis,
  VictoryCursorContainer,
  VictoryLabel
} from 'victory';
import io from 'socket.io-client';

export default function App() {
  const [rtPrice, setRtPrice] = useState({ ticker: '0', price: 0, color: 'orange' });
  const [candleData, setCandleData] = useState([]);
  const [lineDataMap, setLineDataMap] = useState({});
  const [chartBackfill, setChartBackfill] = useState(120);

  const [selectedCandle, setSelectedCandle] = useState("1 min");
  const [selectedMovingAverages, setSelectedMovingAverages] = useState([]);

  const candleOptions = ["1 min", "5 min", "30 min", "1 hour"];
  const movingAvgOptions = ["5 min", "15 min", "30 min"];

  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });


 useEffect(() => {
     const priceSocket = io('http://localhost:8085/rt-price', {
       transports: ['websocket'],
     });

     priceSocket.on('connect', () => {
       console.log(`priceSocket connected with ${priceSocket.id}`);
     });

     priceSocket.on('update', (data) => {
       const { price, ticker } = data;
       setRtPrice(prev => ({
         ticker,
         price,
         color: prev.price < price ? 'red' : 'green'
       }));
     });
     
     return () => {
         priceSocket.disconnect();
         priceSocket.off('update');
      };
 }, [])

  useEffect(() => {
    const freqMap = {
        "1 min" : 1,
        "5 min" : 5,
        "30 min": 30,
        "1 hour": 60,
    }
    const frequency =  freqMap[selectedCandle] || 1

    const statsSocket = io('http://localhost:8085/rt-stats', {
        query: { frequency: frequency, backfill: chartBackfill },
        transports: ['websocket'],
    });

    statsSocket.on('connect', () => {
      console.log(`statsSocket connected with ${statsSocket.id}`);
    });

    statsSocket.on('init', (data) => {
      const initCandles = data.map(({ id, timestamp, open, close, high, low }) => ({
        id,
        x: new Date(timestamp),
        open,
        close,
        high,
        low,
      }));
      setCandleData(initCandles);
    });

    statsSocket.on('insert', (data) => {
      const { id, timestamp, ...rest } = data;
      setCandleData(prev => [...prev, { id, x: new Date(timestamp), ...rest }]);
    });

    statsSocket.on('replace', (data) => {
      const { id, timestamp, ...rest } = data;
      setCandleData(prev =>
        prev.map(item =>
          item.id === id ? { ...item, x: new Date(timestamp), ...rest } : item
        )
      );
    });

    return () => {
      statsSocket.disconnect();
      statsSocket.off('init');
      statsSocket.off('replace');
    };
  }, [selectedCandle]);


  useEffect(() => {
    const freqMap = { "5 min": 5, "15 min": 15, "30 min": 30 };
    const sockets = [];
    
    setLineDataMap(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(freqKey => {
          const label = Object.entries(freqMap).find(([, val]) => val === +freqKey)?.[0];
          if (label && !selectedMovingAverages.includes(label)) {
            delete updated[freqKey];
          }
        });
        return updated;
      });
  
    selectedMovingAverages.forEach(option => {
      const frequency = freqMap[option];
      if (!frequency) return;
  
      const s = io('http://localhost:8085/rt-moving-stats', {
        query: { frequency, backfill: chartBackfill },
        transports: ['websocket'],
      });
  
      s.on('init', data => {
        setLineDataMap(prev => ({
          ...prev,
          [frequency]: data.map(({ id, timestamp, price }) => ({
            id,
            x: new Date(timestamp),
            y: price,
          })),
        }));
      });
  
      s.on('insert', ({ id, timestamp, price }) => {
        setLineDataMap(prev => ({
          ...prev,
          [frequency]: [...(prev[frequency] || []), { id, x: new Date(timestamp), y: price }],
        }));
      });
  
      s.on('replace', ({ id, timestamp, price }) => {
        setLineDataMap(prev => ({
          ...prev,
          [frequency]: (prev[frequency] || []).map(item =>
            item.id === id ? { id, x: new Date(timestamp), y: price } : item
          ),
        }));
      });
  
      sockets.push(s);
    });
  
    return () => {
      sockets.forEach(s => {
        s.disconnect();
        s.off('init');
        s.off('insert');
        s.off('replace');
      });
    };
  }, [selectedMovingAverages]);


  return (
    <View style={styles.container}>
      <Text style={{ ...styles.priceText, color: rtPrice.color }}>
        {rtPrice.ticker} {new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(rtPrice.price)}
      </Text>

      <View style={styles.buttonsContainer}>
        {/* Candle Type Selection */}
        <View style={styles.buttonGroup}>
          <Text style={styles.buttonGroupTitle}>Candle Type</Text>
          <View style={styles.buttonRow}>
            {candleOptions.map(option => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.pill,
                  selectedCandle === option && styles.pillSelected
                ]}
                onPress={() => setSelectedCandle(option)}
              >
                <Text style={[
                  styles.pillText,
                  selectedCandle === option && styles.pillTextSelected
                ]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Moving Averages Select */}
        <View style={styles.buttonGroup}>
          <Text style={styles.buttonGroupTitle}>Moving Averages</Text>
          <View style={styles.buttonRow}>
            {movingAvgOptions.map(option => (
              <TouchableOpacity
                key={option}
                style={[
                  styles.pill,
                  selectedMovingAverages.includes(option) && styles.pillSelected
                ]}
                onPress={() => {
                  if (selectedMovingAverages.includes(option)) {
                    setSelectedMovingAverages(selectedMovingAverages.filter(item => item !== option));
                  } else {
                    setSelectedMovingAverages([...selectedMovingAverages, option]);
                  }
                }}
              >
                <Text style={[
                  styles.pillText,
                  selectedMovingAverages.includes(option) && styles.pillTextSelected
                ]}>
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View 
        style={styles.chartContainer}
        onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          setChartSize({ width, height });
        }}
      >

    {chartSize.width > 0 && chartSize.height > 0 && (
        <VictoryChart
          width={chartSize.width}
          height={chartSize.height}
          padding={{ top: 20, bottom: 50, left: 80, right: 20 }}
          domainPadding={{ x: 20, y: 20 }}
          containerComponent={
            <VictoryCursorContainer 
              responsive 
              cursorLabel={({ datum }) => [
                `Time: ${new Date(datum.x).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
                `Price: ${datum.y.toFixed(2)}`
              ]}
              cursorLabelComponent={<VictoryLabel dy={-10} />}
            />}
        >
          
          {/* X Axis */}
          <VictoryAxis
            tickFormat={t =>
              new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            }
            style={{ grid: { stroke: 'white', strokeDasharray: '2,2' } }}
          />

          {/* Y Axis */}
          <VictoryAxis
            dependentAxis
            style={{
              tickLabels: { fill: 'black' },
              grid: { stroke: 'white', strokeDasharray: '2,2' }
            }}
          />

          <VictoryCandlestick
              data={candleData}
              candleColors={{ positive: 'green', negative: 'red' }}
              candleWidth={10}
          />

          {Object.entries(lineDataMap).map(([freq, data]) => {
            let strokeColor;
            const numFreq = Number(freq);
            if (numFreq === 5) strokeColor = "#FFB347";
            else if (numFreq === 15) strokeColor = "orange";
            else if (numFreq === 30) strokeColor = "darkorange";
            else strokeColor = "blue";

            return (
              <VictoryLine
                key={freq}
                data={data}
                style={{ data: { stroke: strokeColor, strokeWidth: 2 } }}
              />
            );
          })}

        </VictoryChart>
      )}
          
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  priceText: {
    fontSize: 50,
    textAlign: 'center',
    alignSelf: 'center',
    backgroundColor: 'white',
    justifyContent: 'center',
  },
  buttonsContainer: {
    backgroundColor: 'white',
    flex: 1,
    padding: 10,
    borderRadius: 10,
    marginVertical: 10,
  },
  buttonGroup: {
    marginBottom: 15,
  },
  buttonGroupTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: 'black',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#fff',
    marginRight: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  pillSelected: {
    backgroundColor: '#007bff',
  },
  pillText: {
    fontSize: 14,
    color: '#000',
  },
  pillTextSelected: {
    color: '#fff',
  },
  chartContainer: {
    flex: 4,
    backgroundColor: 'white',
    marginHorizontal: 5,
    marginVertical: 5,
  },
});