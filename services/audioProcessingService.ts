import { Marker, OnsetData } from "../types";

// Constants for processing
const FFT_SIZE = 2048;
const HOP_SIZE = 441; // ~10ms at 44.1kHz

export const decodeAudio = async (file: File): Promise<AudioBuffer> => {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  return await audioContext.decodeAudioData(arrayBuffer);
};

// Calculate spectral flux / amplitude onset envelope
export const computeOnsetEnvelope = (buffer: AudioBuffer): OnsetData => {
  const channelData = buffer.getChannelData(0); // Use left channel for mono analysis
  const sampleRate = buffer.sampleRate;
  
  const numWindows = Math.floor((channelData.length - FFT_SIZE) / HOP_SIZE);
  const values: number[] = [];
  const times: number[] = [];

  let prevRms = 0;

  for (let i = 0; i < numWindows; i++) {
    const start = i * HOP_SIZE;
    let sumSq = 0;
    for (let j = 0; j < FFT_SIZE; j++) {
      const sample = channelData[start + j];
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / FFT_SIZE);
    
    // Spectral flux approximation
    const val = Math.max(0, rms - prevRms); 
    values.push(val);
    times.push(start / sampleRate);
    
    prevRms = rms;
  }

  // Normalize values 0-1
  const maxVal = Math.max(...values, 0.00001);
  const normalizedValues = values.map(v => v / maxVal);
  
  // Smoothing
  const smoothedValues = new Array(normalizedValues.length).fill(0);
  const windowSize = 5;
  for(let i=0; i<normalizedValues.length; i++) {
      let sum = 0;
      let count = 0;
      for(let w=-Math.floor(windowSize/2); w<=Math.floor(windowSize/2); w++) {
          if(i+w >=0 && i+w < normalizedValues.length) {
              sum += normalizedValues[i+w];
              count++;
          }
      }
      smoothedValues[i] = sum/count;
  }

  const detectedBpm = estimateBPM(smoothedValues, times);

  return { times, values: smoothedValues, detectedBpm };
};

// Simple BPM Estimator using Interval Histogram
const estimateBPM = (values: number[], times: number[]): number => {
    const peaks: number[] = [];
    for(let i=2; i<values.length-2; i++) {
        if(values[i] > 0.3 && values[i] > values[i-1] && values[i] > values[i+1]) {
            peaks.push(times[i]);
        }
    }
    if(peaks.length < 10) return 0;

    const intervals: number[] = [];
    for(let i=1; i<peaks.length; i++) {
        intervals.push(peaks[i] - peaks[i-1]);
    }

    const bins: {[key: string]: number} = {};
    intervals.forEach(interval => {
        const key = Math.round(interval * 20) / 20; 
        if (key > 0.3 && key < 1.5) { 
            bins[key] = (bins[key] || 0) + 1;
        }
    });

    let bestInterval = 0;
    let maxCount = 0;
    for(const [interval, count] of Object.entries(bins)) {
        if(count > maxCount) {
            maxCount = count;
            bestInterval = parseFloat(interval);
        }
    }
    return bestInterval > 0 ? Math.round(60 / bestInterval) : 0;
}


// --- CORE LOGIC: THE DESPERATION THRESHOLD ALGORITHM ---

interface GenOptions {
    minDuration: number;
    maxDuration: number;
    sensitivity: number; // 0.0 to 1.0
}

export const generateMarkers = (
  onsetData: OnsetData,
  options: GenOptions,
  totalDuration: number
): Marker[] => {
  const { times, values } = onsetData;
  const markers: Marker[] = [];
  
  let cursor = 0.0; // Time pointer
  const noiseFloor = 0.05;

  // Pre-calculate indices to avoid scanning from 0 every time
  let currentIndex = 0;

  while (cursor < totalDuration) {
      const winStart = cursor + options.minDuration;
      const winEnd = Math.min(cursor + options.maxDuration, totalDuration);

      if (winStart >= totalDuration) break;

      // 1. Identification: Collect all valid peaks in the window [min, max]
      const candidates: {index: number, time: number, strength: number}[] = [];
      
      // Advance index to winStart
      while(currentIndex < times.length && times[currentIndex] < winStart) {
          currentIndex++;
      }

      // Scan until winEnd
      // We use a temp index so we don't mess up the main one for next iteration (though we usually jump forward)
      let scanIndex = currentIndex;
      
      while(scanIndex < times.length && times[scanIndex] <= winEnd) {
          const val = values[scanIndex];
          // Local maxima check
          if (scanIndex > 0 && scanIndex < values.length - 1) {
              if (val >= values[scanIndex - 1] && val >= values[scanIndex + 1]) {
                  if (val > noiseFloor) {
                      candidates.push({
                          index: scanIndex,
                          time: times[scanIndex],
                          strength: val
                      });
                  }
              }
          }
          scanIndex++;
      }

      let chosenCandidate = null;
      let isSafety = false;

      if (candidates.length === 0) {
          // No peaks found at all?
          // Force a cut at maxDuration
          isSafety = true;
          chosenCandidate = { time: winEnd, strength: 0, index: -1 };
      } else {
          // 2. Selection: Apply Desperation Threshold
          // We iterate through candidates in time order.
          
          for (const cand of candidates) {
              // Normalized progress through the window (0.0 to 1.0)
              const progress = (cand.time - winStart) / (winEnd - winStart + 0.001);
              
              // Dynamic Threshold Calculation
              // If Sensitivity = 1.0 -> (1 - 1) * ... = 0. Threshold is 0. First peak accepted.
              // If Sensitivity = 0.0 -> (1 - 0) * (1 - progress). Starts at 1.0, decays linearly to 0.0.
              // We use a power curve to make 'medium' sensitivity feel natural.
              const curve = Math.pow(1.0 - progress, 1.5); 
              const threshold = (1.0 - options.sensitivity) * curve;

              if (cand.strength >= threshold) {
                  chosenCandidate = cand;
                  isSafety = false;
                  break; // We found a beat that satisfies our current desperation level
              }
          }

          // 3. Fallback: Safety Net
          // If NO candidate passed the threshold (because we were too picky/low sensitivity),
          // we are now "desperate" at the end of the window.
          // We MUST pick something. To minimize glitchiness, we pick the STRONGEST beat available in the window.
          // (Even if it was early in the window and we skipped it, it's better than cutting on silence).
          if (!chosenCandidate) {
              isSafety = true;
              // Find max strength in candidates
              chosenCandidate = candidates.reduce((prev, current) => (prev.strength > current.strength) ? prev : current);
          }
      }

      // 4. Commit
      markers.push({
          id: crypto.randomUUID(),
          time: chosenCandidate.time,
          strength: chosenCandidate.strength,
          type: isSafety ? 'Safety' : 'Cut'
      });

      cursor = chosenCandidate.time;
  }

  // Cleanup: Remove last marker if it's too close to end
  if (markers.length > 0 && Math.abs(markers[markers.length-1].time - totalDuration) < 0.5) {
      markers.pop();
  }

  return markers;
};

// --- BINARY SEARCH FOR TARGET COUNT ---
// This ensures we respect the Min/Max constraints while trying to hit the target count.
export const generateMarkersByCount = (
    onsetData: OnsetData,
    targetCount: number,
    duration: number,
    constraints: { minDuration: number, maxDuration: number }
): Marker[] => {
    
    let low = 0.0;
    let high = 1.0;
    let bestMarkers: Marker[] = [];
    let minDiff = Infinity;

    // 8 iterations gives us precision ~0.004 on sensitivity, which is plenty.
    for(let i=0; i<8; i++) {
        const mid = (low + high) / 2;
        const result = generateMarkers(onsetData, {
            minDuration: constraints.minDuration,
            maxDuration: constraints.maxDuration,
            sensitivity: mid
        }, duration);

        const diff = Math.abs(result.length - targetCount);
        
        if (diff < minDiff) {
            minDiff = diff;
            bestMarkers = result;
        }

        if (result.length === targetCount) break;

        if (result.length < targetCount) {
            // Too few cuts? We need higher sensitivity (more density).
            low = mid;
        } else {
            // Too many cuts? We need lower sensitivity.
            high = mid;
        }
    }

    return bestMarkers;
}
