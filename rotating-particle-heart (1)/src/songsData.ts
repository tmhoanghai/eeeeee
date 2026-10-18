import { parseLRC, TimedLyric } from './utils/lrcParser';

export type { TimedLyric };

export interface SongItem {
  filename: string;
  title: string;
  lyrics: TimedLyric[];
  lrcRaw?: string;
}

export const SONGS: SongItem[] = [
  {
    title: "Sơn Tùng MTP - Nơi Này Có Anh",
    filename: "/music/Sơn Tùng MTP - Nơi Này Có Anh (Việt Nam Lyrics  Subtitles) - Subtify.mp3",
    lrcRaw: '',
    lyrics: []
  },
  {
    title: "Sandwich and story - Mono",
    filename: "/music/Sandwich and story - Mono I Lyrics - Dale's music.mp3",
    lrcRaw: '',
    lyrics: []
  }
];
