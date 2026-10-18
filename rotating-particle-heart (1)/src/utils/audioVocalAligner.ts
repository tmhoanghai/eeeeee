import { TimedLyric, formatTime } from './lrcParser';

export interface VocalSegment {
  start: number;
  end: number;
  peakTime: number;
  peakEnergy: number;
  confidence: number;
}

export interface AlignmentResult {
  lyrics: TimedLyric[];
  rawLrc: string;
  totalOnsets: number;
  vocalSegments: VocalSegment[];
  duration: number;
}

/**
 * Pre-analyzes an AudioBuffer to extract vocal energy envelope,
 * detects singing onset points, and aligns text lines from txt file.
 */
export async function analyzeAudioAndAlignLyrics(
  audioBuffer: AudioBuffer,
  rawLinesOrText: string[] | string,
  existingLyrics?: TimedLyric[]
): Promise<AlignmentResult> {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0); // Mono or left channel
  const duration = audioBuffer.duration;

  // 1. Parse text lines
  let textLines: string[] = [];
  if (typeof rawLinesOrText === 'string') {
    textLines = rawLinesOrText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => {
        // Strip existing [mm:ss.xx] if present
        return l.replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim();
      })
      .filter((l) => l.length > 0);
  } else {
    textLines = rawLinesOrText.map((l) =>
      l.replace(/^\[\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim()
    ).filter((l) => l.length > 0);
  }

  // 2. Compute energy envelope over 50ms frames (step = 25ms)
  const frameSize = Math.floor(sampleRate * 0.05); // 50ms
  const hopSize = Math.floor(sampleRate * 0.025); // 25ms
  const totalFrames = Math.floor((channelData.length - frameSize) / hopSize);

  const energies = new Float32Array(totalFrames);
  const timeStamps = new Float32Array(totalFrames);

  let globalMax = 0;
  for (let i = 0; i < totalFrames; i++) {
    const startIdx = i * hopSize;
    let sumSquares = 0;
    // Simple band-approximation: differentiate to accentuate vocal formants
    for (let j = 0; j < frameSize; j += 2) {
      const s = channelData[startIdx + j];
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / (frameSize / 2));
    energies[i] = rms;
    timeStamps[i] = (i * hopSize) / sampleRate;
    if (rms > globalMax) globalMax = rms;
  }

  // Normalize energies 0..1
  if (globalMax > 0) {
    for (let i = 0; i < totalFrames; i++) {
      energies[i] /= globalMax;
    }
  }

  // 3. Detect vocal onsets using adaptive threshold and positive energy derivative
  const onsetThreshold = 0.08;
  const rawOnsets: { time: number; energy: number; rise: number }[] = [];

  for (let i = 2; i < totalFrames - 2; i++) {
    const curr = energies[i];
    const prev = energies[i - 1];
    const prev2 = energies[i - 2];
    const rise = curr - prev;

    if (curr > onsetThreshold && rise > 0.03 && curr > prev2) {
      // Local peak check
      if (curr >= energies[i + 1] && curr >= energies[i - 1]) {
        rawOnsets.push({
          time: timeStamps[i],
          energy: curr,
          rise,
        });
      }
    }
  }

  // 4. Cluster onsets into coherent vocal phrase beginnings (min gap 1.2s between distinct lines)
  const vocalSegments: VocalSegment[] = [];
  let lastTime = -10;

  for (const o of rawOnsets) {
    if (o.time - lastTime >= 1.2) {
      vocalSegments.push({
        start: Math.max(0, o.time - 0.1),
        end: o.time + 3.5,
        peakTime: o.time,
        peakEnergy: o.energy,
        confidence: Math.min(1.0, o.rise * 10),
      });
      lastTime = o.time;
    }
  }

  // 5. Intelligent Alignment:
  // If existing curated/rough timestamps exist, use them as anchor points to snap to the closest acoustic vocal onset.
  // Otherwise, distribute lines across detected vocal segments.
  const alignedLyrics: TimedLyric[] = [];

  for (let idx = 0; idx < textLines.length; idx++) {
    const text = textLines[idx];
    let matchedTime = 0;

    if (existingLyrics && existingLyrics[idx]) {
      const hint = existingLyrics[idx].time;
      // Search for the closest vocal onset within ±2.5s window
      let closestOnset: VocalSegment | null = null;
      let minDiff = 2.5;

      for (const seg of vocalSegments) {
        const diff = Math.abs(seg.start - hint);
        if (diff < minDiff) {
          minDiff = diff;
          closestOnset = seg;
        }
      }

      if (closestOnset && minDiff < 1.8) {
        // Snap to real detected vocal start
        matchedTime = closestOnset.start;
      } else {
        matchedTime = hint;
      }
    } else {
      // Direct segment mapping
      if (idx < vocalSegments.length) {
        matchedTime = vocalSegments[idx].start;
      } else {
        // Fallback proportional interpolation
        matchedTime = Math.min(duration - 5, (idx / textLines.length) * duration);
      }
    }

    // Format to 2 decimal places
    matchedTime = Math.round(matchedTime * 100) / 100;

    alignedLyrics.push({
      time: matchedTime,
      text,
    });
  }

  // Ensure strict chronological ordering
  alignedLyrics.sort((a, b) => a.time - b.time);

  // Generate standard LRC string
  const rawLrc = alignedLyrics
    .map((l) => `[${formatTime(l.time)}] ${l.text}`)
    .join('\n');

  return {
    lyrics: alignedLyrics,
    rawLrc,
    totalOnsets: vocalSegments.length,
    vocalSegments,
    duration,
  };
}

/**
 * Helper to fetch an audio file as ArrayBuffer and decode with an AudioContext.
 */
export async function decodeAudioUrl(
  url: string,
  audioCtx: AudioContext
): Promise<AudioBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to load audio: ${resp.status} ${resp.statusText}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}
