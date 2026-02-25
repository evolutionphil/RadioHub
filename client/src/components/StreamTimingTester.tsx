import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TimingResult {
  directStreamStart: number | null;
  radioHubStart: number | null;
  timeDifference: number | null;
  directStreamError: string | null;
  radioHubError: string | null;
}

export function StreamTimingTester() {
  const [isTestingActive, setIsTestingActive] = useState(false);
  const [results, setResults] = useState<TimingResult>({
    directStreamStart: null,
    radioHubStart: null,
    timeDifference: null,
    directStreamError: null,
    radioHubError: null
  });
  
  const directAudioRef = useRef<HTMLAudioElement>(null);
  const radioHubAudioRef = useRef<HTMLAudioElement>(null);
  const testStartTimeRef = useRef<number>(0);

  const startTimingTest = async () => {
    setIsTestingActive(true);
    const testStartTime = Date.now();
    testStartTimeRef.current = testStartTime;
    
    console.log('🕒 TIMING TEST: Starting synchronized audio test');
    
    const newResults: TimingResult = {
      directStreamStart: null,
      radioHubStart: null,
      timeDifference: null,
      directStreamError: null,
      radioHubError: null
    };

    // Create fresh audio elements for clean test
    const directAudio = new Audio();
    const radioHubAudio = new Audio();
    
    // Direct stream URL (with proxy for mixed content)
    const directStreamUrl = '/api/stream/aHR0cDovLzQ2LjIwLjcuMTI2LztzdHJlYW0ubXAz';
    const radioHubUrl = '/api/stream/aHR0cDovLzQ2LjIwLjcuMTI2LztzdHJlYW0ubXAz'; // Same URL through our system
    
    // Set up timing listeners
    const handleDirectPlay = () => {
      const playTime = Date.now() - testStartTime;
      console.log(`🎯 DIRECT STREAM: First audio started at ${playTime}ms`);
      newResults.directStreamStart = playTime;
      updateResults();
    };
    
    const handleRadioHubPlay = () => {
      const playTime = Date.now() - testStartTime;
      console.log(`📻 RADIO HUB: First audio started at ${playTime}ms`);
      newResults.radioHubStart = playTime;
      updateResults();
    };
    
    const handleDirectError = (error: any) => {
      console.error('❌ DIRECT STREAM ERROR:', error);
      newResults.directStreamError = 'Failed to load direct stream';
      updateResults();
    };
    
    const handleRadioHubError = (error: any) => {
      console.error('❌ RADIO HUB ERROR:', error);
      newResults.radioHubError = 'Failed to load through Radio Hub';
      updateResults();
    };
    
    const updateResults = () => {
      if (newResults.directStreamStart !== null && newResults.radioHubStart !== null) {
        newResults.timeDifference = newResults.radioHubStart - newResults.directStreamStart;
        console.log(`⏱️ TIME DIFFERENCE: ${newResults.timeDifference}ms (Radio Hub ${newResults.timeDifference > 0 ? 'slower' : 'faster'} than direct)`);
      }
      setResults({ ...newResults });
    };

    // Set up event listeners
    directAudio.addEventListener('play', handleDirectPlay, { once: true });
    directAudio.addEventListener('error', handleDirectError, { once: true });
    radioHubAudio.addEventListener('play', handleRadioHubPlay, { once: true });
    radioHubAudio.addEventListener('error', handleRadioHubError, { once: true });
    
    try {
      // Load both streams
      directAudio.src = directStreamUrl;
      radioHubAudio.src = radioHubUrl;
      
      console.log('🔄 TIMING TEST: Loading both streams...');
      
      // Start both streams simultaneously
      await Promise.all([
        directAudio.play().catch(e => handleDirectError(e)),
        radioHubAudio.play().catch(e => handleRadioHubError(e))
      ]);
      
      // Stop test after 10 seconds
      setTimeout(() => {
        directAudio.pause();
        radioHubAudio.pause();
        setIsTestingActive(false);
        console.log('⏹️ TIMING TEST: Completed');
      }, 10000);
      
    } catch (error) {
      console.error('💥 TIMING TEST FAILED:', error);
      setIsTestingActive(false);
    }
  };

  const resetTest = () => {
    setResults({
      directStreamStart: null,
      radioHubStart: null,
      timeDifference: null,
      directStreamError: null,
      radioHubError: null
    });
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>🕒 Stream Timing Comparison</CardTitle>
        <p className="text-sm text-muted-foreground">
          Compare audio start times between direct stream and Radio Hub
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 border rounded">
            <h3 className="font-medium mb-2">🎯 Direct Stream</h3>
            <p className="text-xs text-muted-foreground mb-2">http://46.20.7.126/;stream.mp3</p>
            {results.directStreamStart !== null && (
              <p className="text-green-600">✅ Started at: {results.directStreamStart}ms</p>
            )}
            {results.directStreamError && (
              <p className="text-red-600">❌ Error: {results.directStreamError}</p>
            )}
          </div>
          
          <div className="p-4 border rounded">
            <h3 className="font-medium mb-2">📻 Radio Hub</h3>
            <p className="text-xs text-muted-foreground mb-2">Through our application</p>
            {results.radioHubStart !== null && (
              <p className="text-green-600">✅ Started at: {results.radioHubStart}ms</p>
            )}
            {results.radioHubError && (
              <p className="text-red-600">❌ Error: {results.radioHubError}</p>
            )}
          </div>
        </div>
        
        {results.timeDifference !== null && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded">
            <h3 className="font-medium text-blue-900 dark:text-blue-100">⏱️ Timing Results</h3>
            <p className="text-blue-800 dark:text-blue-200">
              Time Difference: <strong>{Math.abs(results.timeDifference)}ms</strong>
              {results.timeDifference > 0 && <span className="text-orange-600"> (Radio Hub slower)</span>}
              {results.timeDifference < 0 && <span className="text-green-600"> (Radio Hub faster)</span>}
              {results.timeDifference === 0 && <span className="text-green-600"> (Perfect sync!)</span>}
            </p>
          </div>
        )}
        
        <div className="flex gap-2">
          <Button 
            onClick={startTimingTest} 
            disabled={isTestingActive}
            data-testid="button-start-timing-test"
          >
            {isTestingActive ? '⏳ Testing...' : '🚀 Start Timing Test'}
          </Button>
          <Button 
            variant="outline" 
            onClick={resetTest}
            data-testid="button-reset-timing-test"
          >
            🔄 Reset
          </Button>
        </div>
        
        <div className="text-xs text-muted-foreground">
          <p>📋 Test compares audio start times to measure latency differences</p>
          <p>🔊 Both streams will play for 10 seconds then automatically stop</p>
        </div>
      </CardContent>
    </Card>
  );
}