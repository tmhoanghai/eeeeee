import { parseLRC, TimedLyric } from '../utils/lrcParser';

export interface LrclibSearchResult {
  id: number;
  name: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
}

/**
 * Fetches time-synced LRC lyrics or plain lyrics from LRCLIB API
 */
export async function fetchLyricsFromLRCLIB(trackName: string, artistName?: string): Promise<{
  syncedLyrics: TimedLyric[];
  rawText: string;
  source: string;
} | null> {
  try {
    const query = artistName ? `${trackName} ${artistName}` : trackName;
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(url);
    if (!response.ok) return null;

    const results: LrclibSearchResult[] = await response.json();
    if (!results || results.length === 0) return null;

    // Prioritize results with syncedLyrics
    const bestMatch = results.find((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0) || results[0];

    if (bestMatch.syncedLyrics) {
      const parsed = parseLRC(bestMatch.syncedLyrics);
      if (parsed.length > 0) {
        return {
          syncedLyrics: parsed,
          rawText: bestMatch.syncedLyrics,
          source: 'LRCLIB API (Synced LRC)',
        };
      }
    }

    if (bestMatch.plainLyrics) {
      // Convert plain lyrics lines into mock timed lyrics spaced ~4s apart
      const lines = bestMatch.plainLyrics.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const mockLrc = lines.map((line, idx) => {
        const mins = Math.floor((idx * 4) / 60);
        const secs = (idx * 4) % 60;
        const padMins = String(mins).padStart(2, '0');
        const padSecs = String(secs).padStart(2, '0');
        return `[${padMins}:${padSecs}.00] ${line}`;
      }).join('\n');

      return {
        syncedLyrics: parseLRC(mockLrc),
        rawText: bestMatch.plainLyrics,
        source: 'LRCLIB API (Plain Lyrics)',
      };
    }

    return null;
  } catch (err) {
    console.warn('LRCLIB API fetch failed:', err);
    return null;
  }
}

/**
 * Fallback fetcher from Lyrics.ovh API
 */
export async function fetchLyricsFromOVH(artist: string, title: string): Promise<{
  syncedLyrics: TimedLyric[];
  rawText: string;
  source: string;
} | null> {
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data && data.lyrics) {
      const lines = data.lyrics.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
      const mockLrc = lines.map((line: string, idx: number) => {
        const mins = Math.floor((idx * 4) / 60);
        const secs = (idx * 4) % 60;
        const padMins = String(mins).padStart(2, '0');
        const padSecs = String(secs).padStart(2, '0');
        return `[${padMins}:${padSecs}.00] ${line}`;
      }).join('\n');

      return {
        syncedLyrics: parseLRC(mockLrc),
        rawText: data.lyrics,
        source: 'Lyrics.ovh API',
      };
    }
    return null;
  } catch (err) {
    console.warn('Lyrics.ovh API fetch failed:', err);
    return null;
  }
}
