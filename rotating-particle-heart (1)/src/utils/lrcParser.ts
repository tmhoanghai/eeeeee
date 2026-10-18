export interface WordTiming {
  word: string;
  startTime: number;
  endTime: number;
}

export interface TimedLyric {
  time: number; // in seconds
  text: string;
  words?: WordTiming[];
}

export interface ActiveLyricState {
  currentText: string;
  nextText: string;
  activeLineIndex: number;
  wordProgress: number; // 0.0 to 1.0
  activeWordIndex: number;
  words: { word: string; active: boolean; progress: number }[];
}

/**
 * Parses standard LRC lyrics format string:
 * [mm:ss.xx] Lyric line text
 */
export function parseLRC(lrcText: string): TimedLyric[] {
  const lines = lrcText.split(/\r?\n/);
  const result: TimedLyric[] = [];

  const timestampRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matches = Array.from(trimmed.matchAll(timestampRegex));
    if (matches.length === 0) continue;

    const lyricText = trimmed.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!lyricText) continue;

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const msStr = match[3];
      const milliseconds = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr, 10);

      const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
      result.push({
        time: parseFloat(timeInSeconds.toFixed(2)),
        text: lyricText,
      });
    }
  }

  // Sort chronologically by time
  result.sort((a, b) => a.time - b.time);

  // Generate punchy, energetic word timings (0.30s per word) across all songs
  for (let i = 0; i < result.length; i++) {
    const curr = result[i];
    const next = result[i + 1];
    const gap = next ? Math.max(0.8, next.time - curr.time) : 4.0;

    const rawWords = curr.text.replace(/\\n/g, ' ').split(/\s+/).filter(Boolean);
    if (rawWords.length > 0) {
      // Fixed punchy cadence: fast word transitions that match quick vocal delivery
      const maxAvailableDur = gap * 0.88;
      const wordDur = Math.min(0.25, Math.max(0.14, maxAvailableDur / rawWords.length));

      curr.words = rawWords.map((w, idx) => ({
        word: w,
        startTime: idx === 0 ? curr.time - 0.08 : curr.time + idx * wordDur,
        endTime: curr.time + (idx + 1) * wordDur,
      }));
    }
  }

  return result;
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export function formatTimeShort(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Phân đoạn nhạc nền DUY NHẤT theo yêu cầu của user:
 * Chỉ dừng và ẩn lyrics duy nhất từ 01:26.00 đến 01:50.25.
 * Bỏ hết toàn bộ các nơi nhạc nền khác, hiện lyrics liên tục tại các vị trí đó!
 */
export const INSTRUMENTAL_TIME_RANGES = [
  { start: 86.00, end: 109.50, name: 'Beat nghỉ nhạc nền (01:26.00 ➔ 01:49.50)' },
];

export function isInstrumentalTime(time: number, lyrics?: TimedLyric[]): boolean {
  if (lyrics && lyrics.length > 0) {
    // Look up if a lyric line is active for this timestamp
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (time >= lyrics[i].time) {
        const currentLine = lyrics[i];
        const nextLine = lyrics[i + 1];
        // If there's a long gap (>15s) until next line and we are 4s past the current line start, consider it instrumental break
        if (nextLine && (nextLine.time - currentLine.time > 15) && (time - currentLine.time >= 4)) {
          return true;
        }
        return false;
      }
    }
  }
  return false;
}

/**
 * Finds the detailed active lyric state for a given audio timestamp (in seconds).
 * QUY TẮC ĐIỀU PHỐI:
 * 1. Chỉ kiểm tra theo giây tại DUY NHẤT đoạn nhạc nền 01:26.00 ➔ 01:50.25.
 * 2. Bỏ hết tất cả các nơi nhạc nền khác: hiện lyrics liên tục, không ẩn!
 */
export function getDetailedActiveLyric(time: number, lyrics: TimedLyric[]): ActiveLyricState {
  if (!lyrics || lyrics.length === 0) {
    return {
      currentText: '',
      nextText: '',
      activeLineIndex: -1,
      wordProgress: 0,
      activeWordIndex: -1,
      words: [],
    };
  }

  // Xong câu cuối thì xoá lyrics (4:00 cho 4 Mùa Thương Em, 4:07 cho Perfect)
  const lastLyricTime = lyrics[lyrics.length - 1]?.time || 0;
  const clearLyricsTime = Math.max(240.0, lastLyricTime + 8.0);
  if (time >= clearLyricsTime) {
    return {
      currentText: '',
      nextText: '',
      activeLineIndex: -1,
      wordProgress: 0,
      activeWordIndex: -1,
      words: [],
    };
  }

  // 1. KIỂM TRA NHẠC NỀN THEO GIÂY: CHỈ KHI CÓ ĐOẠN NGHỈ DÀI KHÔNG CÓ LYRICS
  if (isInstrumentalTime(time, lyrics)) {
    let nextIndexAfterBreak = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time >= time) {
        nextIndexAfterBreak = i;
        break;
      }
    }
    const nextLyric = nextIndexAfterBreak !== -1 ? lyrics[nextIndexAfterBreak] : null;

    return {
      currentText: '', // Ẩn lời DUY NHẤT trong đoạn 01:26.00 -> 01:50.25
      nextText: nextLyric ? nextLyric.text : '',
      activeLineIndex: nextIndexAfterBreak !== -1 ? nextIndexAfterBreak - 1 : -1,
      wordProgress: 1.0,
      activeWordIndex: -1,
      words: [],
    };
  }

  // 2. Trước câu 1 (0s -> 1s): hiện sẵn câu đầu tiên để người nghe theo dõi
  if (time < lyrics[0].time) {
    return {
      currentText: lyrics[0].text,
      nextText: lyrics[1]?.text || '',
      activeLineIndex: 0,
      wordProgress: 0,
      activeWordIndex: 0,
      words: (lyrics[0].words || []).map((w) => ({
        word: w.word,
        active: false,
        progress: 0,
      })),
    };
  }

  // 3. DỰA VÀO GIỌNG ĐỂ LẤY CÂU HÁT TỪ TEXT (Hiện liên tục, không ẩn tại bất kì nơi nào khác)
  let activeIndex = -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (time >= lyrics[i].time) {
      activeIndex = i;
      break;
    }
  }

  if (activeIndex === -1) {
    activeIndex = 0;
  }

  const curr = lyrics[activeIndex];
  const next = lyrics[activeIndex + 1];
  const elapsed = time - curr.time;

  // Thời lượng hát câu (giữ sáng đến khi câu tiếp theo xuất hiện)
  const lineEnd = next ? next.time : curr.time + 4.5;
  const lineDuration = Math.max(0.5, lineEnd - curr.time);

  // Line progress mượt mà
  const wordProgress = Math.min(1.0, Math.max(0.0, elapsed / Math.min(lineDuration, 4.0)));

  // Word level breakdown
  const wordsList = (curr.words || []).map((w) => {
    let progress = 0;
    if (time >= w.endTime) {
      progress = 1.0;
    } else if (time >= w.startTime) {
      progress = (time - w.startTime) / Math.max(0.01, w.endTime - w.startTime);
    }
    return {
      word: w.word,
      active: time >= w.startTime && time < w.endTime,
      progress: Math.min(1.0, Math.max(0.0, progress)),
    };
  });

  const activeWordIdx = wordsList.findIndex((w) => w.active);

  return {
    currentText: curr.text, // HIỆN LYRICS LIÊN TỤC, KHÔNG ẨN
    nextText: next ? next.text : '',
    activeLineIndex: activeIndex,
    wordProgress,
    activeWordIndex: activeWordIdx !== -1 ? activeWordIdx : wordsList.length > 0 && wordProgress >= 1.0 ? wordsList.length - 1 : -1,
    words: wordsList,
  };
}

/**
 * Legacy string helper
 */
export function getActiveLyric(time: number, lyrics: TimedLyric[]): string {
  return getDetailedActiveLyric(time, lyrics).currentText;
}
