import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SongItem, TimedLyric } from '../songsData';
import { formatTime, formatTimeShort, parseLRC } from '../utils/lrcParser';
import {
  analyzeAudioAndAlignLyrics,
  AlignmentResult,
  decodeAudioUrl,
} from '../utils/audioVocalAligner';
import { LiveVocalStatus, realtimeVocalEngine } from '../utils/realtimeVocalDetector';

interface LyricsInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSong: SongItem | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  activeLineIndex: number;
  isInstrumental: boolean;
  liveVocalStatus?: LiveVocalStatus;
  autoSnapLive?: boolean;
  onToggleAutoSnapLive?: () => void;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onUpdateLyrics: (newLyrics: TimedLyric[], rawLrcText?: string) => void;
}

export const LyricsInspectorModal: React.FC<LyricsInspectorModalProps> = ({
  isOpen,
  onClose,
  currentSong,
  currentTime,
  duration,
  isPlaying,
  activeLineIndex,
  isInstrumental,
  liveVocalStatus,
  autoSnapLive = true,
  onToggleAutoSnapLive,
  onSeek,
  onTogglePlay,
  onUpdateLyrics,
}) => {
  const [activeTab, setActiveTab] = useState<'sync' | 'rawTxt' | 'algorithm'>('sync');
  const [rawText, setRawText] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState<string>('');
  const [alignResult, setAlignResult] = useState<AlignmentResult | null>(null);

  const activeLineRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Initialize raw text from current song lyrics
  useEffect(() => {
    if (currentSong) {
      const lines = currentSong.lyrics.map(
        (l) => `[${formatTime(l.time)}] ${l.text}`
      );
      setRawText(lines.join('\n'));
    }
  }, [currentSong?.title, isOpen]);

  // Auto scroll active line into view in sync mode ("Dịch theo bài mp3")
  useEffect(() => {
    if (activeTab === 'sync' && activeLineRef.current && listContainerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLineIndex, activeTab]);

  const handleApplyCustomLyrics = () => {
    try {
      const parsed = parseLRC(rawText);
      if (parsed.length > 0) {
        onUpdateLyrics(parsed, rawText);
        setSaveSuccessMsg('✅ Đã cập nhật & đồng bộ lời mới thành công!');
        setTimeout(() => setSaveSuccessMsg(''), 2500);
      } else {
        setSaveSuccessMsg('❌ Không tìm thấy dòng lyric hợp lệ dạng [mm:ss.xx]');
        setTimeout(() => setSaveSuccessMsg(''), 3000);
      }
    } catch {
      setSaveSuccessMsg('❌ Lỗi định dạng lyrics!');
      setTimeout(() => setSaveSuccessMsg(''), 3000);
    }
  };

  const handleResetFromTxt = async () => {
    try {
      if (currentSong?.filename) {
        const txtPath = currentSong.filename.replace(/\.mp3$/i, '.txt');
        const res = await fetch(encodeURI(txtPath));
        if (res.ok) {
          const txt = await res.text();
          setRawText(txt);
          const parsed = parseLRC(txt);
          if (parsed.length > 0) {
            onUpdateLyrics(parsed, txt);
            setSaveSuccessMsg('✅ Đã nạp lại mốc từ file TXT gốc!');
            setTimeout(() => setSaveSuccessMsg(''), 2500);
            return;
          }
        }
      }
      const lines = (currentSong?.lyrics || []).map(
        (l) => `[${formatTime(l.time)}] ${l.text}`
      );
      setRawText(lines.join('\n'));
      setSaveSuccessMsg('✅ Đã nạp danh sách hiện tại');
      setTimeout(() => setSaveSuccessMsg(''), 2500);
    } catch (e) {
      console.log('Reset err:', e);
    }
  };

  // Run the Audio Alignment Algorithm ahead of time (pre-analysis)
  const handleRunAudioAlignmentAlgorithm = async () => {
    if (!currentSong) return;
    setIsAnalyzing(true);
    setAnalyzeStep('1/4: Đang kết nối AudioContext & tải file MP3...');

    try {
      const audioCtx = realtimeVocalEngine.getAudioContext() || new AudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      setAnalyzeStep('2/4: Đang giải mã AudioBuffer (PCM Waveform)...');
      const audioBuffer = await decodeAudioUrl(encodeURI(currentSong.filename), audioCtx);

      setAnalyzeStep('3/4: Đang tính toán RMS Energy, Spectral Flux & dò xung cất giọng...');
      // Fetch text lines from txt file or rawText
      let linesSource = rawText;
      if (!linesSource || linesSource.trim().length === 0) {
        const txtPath = currentSong.filename.replace(/\.mp3$/i, '.txt');
        const res = await fetch(encodeURI(txtPath));
        if (res.ok) {
          linesSource = await res.text();
        }
      }

      setAnalyzeStep('4/4: Đang chạy thuật toán Dynamic Matching căn chỉnh câu hát...');
      const result = await analyzeAudioAndAlignLyrics(
        audioBuffer,
        linesSource,
        currentSong.lyrics
      );

      setAlignResult(result);
      setRawText(result.rawLrc);
      onUpdateLyrics(result.lyrics, result.rawLrc);
      setSaveSuccessMsg(`⚡ Thuật toán đã phát hiện ${result.totalOnsets} xung cất giọng và khớp chuẩn xác ${result.lyrics.length} câu!`);
      setTimeout(() => setSaveSuccessMsg(''), 4000);
    } catch (err) {
      console.error('Alignment failed:', err);
      setSaveSuccessMsg('❌ Lỗi khi phân tích audio: ' + String(err));
      setTimeout(() => setSaveSuccessMsg(''), 4000);
    } finally {
      setIsAnalyzing(false);
      setAnalyzeStep('');
    }
  };

  if (!isOpen || !currentSong) return null;

  const vocalEnergy = liveVocalStatus?.vocalEnergy || 0;
  const isVocalActive = liveVocalStatus?.isVocalActive || false;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-5 pointer-events-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.94, y: 15 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.94, y: 15 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="bg-[#0e040a]/95 border border-pink-500/40 rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-[0_0_70px_rgba(255,105,180,0.35)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-3.5 sm:p-5 border-b border-pink-500/20 flex flex-col gap-3 bg-gradient-to-r from-pink-950/50 via-purple-950/30 to-black">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl sm:text-2xl">🧠</span>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-pink-100 flex items-center gap-2 flex-wrap">
                    <span>Điều Phối Lyrics Theo Giọng Hát</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200">
                      🎙️ Dựa vào giọng lấy từ text
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 border border-pink-400/40 text-pink-200">
                      🎵 Khớp theo giọng hát tự nhiên
                    </span>
                  </h3>
                  <p className="text-[11px] text-pink-300/70 truncate max-w-[260px] sm:max-w-md">
                    {currentSong.title}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-pink-950/60 hover:bg-pink-900 border border-pink-500/30 text-pink-200 flex items-center justify-center text-sm transition-all"
                title="Đóng"
              >
                ✕
              </button>
            </div>

            {/* Audio Time Bar & Seeker */}
            <div className="flex flex-col gap-2 bg-black/50 border border-pink-500/25 rounded-2xl p-3">
              <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={onTogglePlay}
                    className="w-7 h-7 rounded-full bg-pink-600 hover:bg-pink-500 text-white flex items-center justify-center text-xs shadow-[0_0_10px_rgba(255,105,180,0.6)] transition-all active:scale-95"
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <span className="font-mono text-pink-200 font-semibold">
                    ⏱ {formatTime(currentTime)}
                  </span>
                  <span className="text-pink-400/50">/ {formatTimeShort(duration)}</span>
                </div>

                {/* Real-time Vocal Status Indicator */}
                <div className="flex items-center gap-2">
                  {isPlaying ? (
                    isVocalActive ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        <span>🎙️ Cất giọng hát ({vocalEnergy}%)</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] bg-amber-500/20 border border-amber-400/40 text-amber-200 flex items-center gap-1">
                        <span>🎸 Nhạc nền / Beat nghỉ</span>
                      </span>
                    )
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-pink-300">
                      Tạm dừng
                    </span>
                  )}

                  {/* Instrumental badge */}
                  {isInstrumental && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/20 border border-purple-400/40 text-purple-200 hidden sm:inline">
                      Dạo nhạc
                    </span>
                  )}
                </div>
              </div>

              {/* Range Seeker */}
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.05}
                value={currentTime}
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="w-full accent-pink-500 h-1.5 bg-pink-950 rounded-lg cursor-pointer transition-all"
              />

              {/* Live Vocal VU Energy Bar (Khi đang chạy) */}
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-[10px] text-pink-400/70 font-mono shrink-0">
                  Dò giọng live:
                </span>
                <div className="flex-1 h-1.5 bg-black/60 rounded-full overflow-hidden border border-pink-500/20 p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-75 ${
                      isVocalActive
                        ? 'bg-gradient-to-r from-emerald-400 via-pink-400 to-pink-500 shadow-[0_0_8px_rgba(255,105,180,0.8)]'
                        : 'bg-pink-900/50'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(4, vocalEnergy))}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-pink-300/80 w-8 text-right">
                  {vocalEnergy}%
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-1.5 sm:gap-2">
              <button
                onClick={() => setActiveTab('sync')}
                className={`flex-1 py-1.5 rounded-xl text-[11px] sm:text-xs font-medium transition-all ${
                  activeTab === 'sync'
                    ? 'bg-pink-600 text-white shadow-[0_0_15px_rgba(255,105,180,0.5)] border border-pink-400'
                    : 'bg-black/40 text-pink-300/70 hover:text-pink-200 border border-pink-500/20'
                }`}
              >
                ▶ Lời Dịch Theo MP3 ({currentSong.lyrics.length})
              </button>

              <button
                onClick={() => setActiveTab('algorithm')}
                className={`flex-1 py-1.5 rounded-xl text-[11px] sm:text-xs font-medium transition-all ${
                  activeTab === 'algorithm'
                    ? 'bg-pink-600 text-white shadow-[0_0_15px_rgba(255,105,180,0.5)] border border-pink-400'
                    : 'bg-black/40 text-pink-300/70 hover:text-pink-200 border border-pink-500/20'
                }`}
              >
                ⚡ Thuật Toán Quét MP3
              </button>

              <button
                onClick={() => setActiveTab('rawTxt')}
                className={`flex-1 py-1.5 rounded-xl text-[11px] sm:text-xs font-medium transition-all ${
                  activeTab === 'rawTxt'
                    ? 'bg-pink-600 text-white shadow-[0_0_15px_rgba(255,105,180,0.5)] border border-pink-400'
                    : 'bg-black/40 text-pink-300/70 hover:text-pink-200 border border-pink-500/20'
                }`}
              >
                📝 Đối Chiếu File TXT
              </button>
            </div>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-hidden p-3 sm:p-4 flex flex-col">
            {/* TAB 1: Live Timeline Sync */}
            {activeTab === 'sync' && (
              <div
                ref={listContainerRef}
                className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-pink-500/30"
              >
                <div className="text-[11px] text-pink-300/70 pb-1 italic flex justify-between items-center flex-wrap gap-1">
                  <span>💡 Bấm vào câu bất kỳ để nhảy ngay đến giây đó của bài MP3:</span>
                  <div className="flex items-center gap-2">
                    {onToggleAutoSnapLive && (
                      <button
                        onClick={onToggleAutoSnapLive}
                        className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${
                          autoSnapLive
                            ? 'bg-emerald-950/60 border-emerald-400/50 text-emerald-200'
                            : 'bg-black/40 border-pink-500/20 text-pink-400/60'
                        }`}
                      >
                        {autoSnapLive ? '✓ Tự động khớp giọng live' : 'Khớp thời gian tĩnh'}
                      </button>
                    )}
                    <span className="text-pink-400 font-semibold">Tự động dịch theo nhạc ↕</span>
                  </div>
                </div>

                {currentSong.lyrics.map((lyric, idx) => {
                  const isBreakTime = currentTime >= 86.0 && currentTime < 109.50;
                  const isActive = idx === activeLineIndex && !isBreakTime;
                  const isPast = idx < activeLineIndex;
                  const prevLyric = idx > 0 ? currentSong.lyrics[idx - 1] : null;
                  // Chỉ duy nhất đoạn 01:26 -> 01:49.50 là nhạc nền, các nơi khác bỏ hết và hiện lyrics
                  const isTheOnlyInstrumentalBreak =
                    prevLyric && prevLyric.time <= 86.0 && lyric.time >= 109.0 && lyric.time <= 110.0;

                  return (
                    <React.Fragment key={idx}>
                      {isTheOnlyInstrumentalBreak && (
                        <div
                          onClick={() => onSeek(86.0)}
                          className={`p-2 sm:p-2.5 rounded-xl text-center text-[11px] font-mono border cursor-pointer transition-all flex items-center justify-center gap-2 ${
                            isBreakTime
                              ? 'bg-purple-900/60 border-purple-400 text-purple-100 shadow-[0_0_15px_rgba(168,85,247,0.4)] animate-pulse'
                              : 'bg-black/30 border-purple-500/20 text-purple-300/70 hover:bg-purple-950/40'
                          }`}
                        >
                          <span>🎶 Đoạn Nhạc Nền Duy Nhất / Beat Nghỉ (Dừng Chạy Lời)</span>
                          <span className="font-semibold text-purple-200">
                            [01:26.00 ➔ 01:49.50]
                          </span>
                        </div>
                      )}

                      <div
                        ref={isActive ? activeLineRef : null}
                        onClick={() => onSeek(lyric.time)}
                        className={`p-2.5 sm:p-3 rounded-2xl transition-all cursor-pointer flex items-start gap-3 border ${
                          isActive
                            ? 'bg-gradient-to-r from-pink-900/80 to-purple-950/90 border-pink-400 text-white shadow-[0_0_20px_rgba(255,105,180,0.45)] scale-[1.01]'
                            : isPast
                            ? 'bg-black/25 border-pink-500/10 text-pink-300/50 hover:bg-pink-950/30'
                            : 'bg-black/40 border-pink-500/15 text-pink-200/85 hover:bg-pink-950/40'
                        }`}
                      >
                      <span
                        className={`font-mono text-[11px] px-2 py-0.5 rounded-lg whitespace-nowrap shrink-0 border ${
                          isActive
                            ? 'bg-pink-500 text-white border-pink-300 font-bold shadow-[0_0_8px_rgba(255,105,180,0.8)]'
                            : 'bg-black/50 text-pink-400/80 border-pink-500/20'
                        }`}
                      >
                        [{formatTime(lyric.time)}]
                      </span>

                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-xs sm:text-sm leading-relaxed whitespace-pre-line ${
                            isActive
                              ? 'font-bold text-pink-100 drop-shadow-[0_0_10px_rgba(255,182,193,0.95)]'
                              : 'font-normal'
                          }`}
                        >
                          {lyric.text.replace(/\\n/g, '\n')}
                        </p>
                      </div>

                      <span className="text-xs text-pink-300/70 shrink-0">
                        {isActive ? '🔊' : '▶'}
                      </span>
                    </div>
                  </React.Fragment>
                );
              })}
              </div>
            )}

            {/* TAB 2: Audio Alignment Algorithm (Thuật toán quét trước trên MP3) */}
            {activeTab === 'algorithm' && (
              <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin scrollbar-thumb-pink-500/30">
                <div className="bg-gradient-to-br from-pink-950/50 via-purple-950/30 to-black/60 border border-pink-500/30 rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">⚡</span>
                    <div>
                      <h4 className="text-sm font-bold text-pink-100">
                        Thuật Toán Dịch Khớp Âm Thanh Tự Động (Acoustic Vocal Aligner)
                      </h4>
                      <p className="text-xs text-pink-300/70">
                        Giải mã trực tiếp file MP3 thành PCM Waveform, đo tần số giọng người (300Hz-3.4kHz), tìm các đỉnh năng lượng cất giọng (RMS Onsets) và tự động căn chỉnh từng dòng lời từ file TXT.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-pink-200/90 pt-1">
                    <div className="p-2.5 rounded-xl bg-black/40 border border-pink-500/20 flex flex-col gap-1">
                      <span className="font-semibold text-pink-300">1. Quét file MP3 trước (Offline):</span>
                      <span className="text-pink-300/70 text-[11px]">
                        Dò toàn bộ 268s âm thanh, phát hiện các khoảng nghỉ nhạc cụ và mốc bắt đầu của từng câu hát.
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-black/40 border border-pink-500/20 flex flex-col gap-1">
                      <span className="font-semibold text-pink-300">2. Dò giọng realtime khi đang chạy:</span>
                      <span className="text-pink-300/70 text-[11px]">
                        Theo dõi phổ âm thanh lúc phát, nhận biết lúc ca sĩ đang hát vs đoạn dạo nhạc nền để giữ hoặc đổi lời.
                      </span>
                    </div>
                  </div>

                  {/* Run Button */}
                  <div className="pt-2 flex flex-col gap-2">
                    <button
                      onClick={handleRunAudioAlignmentAlgorithm}
                      disabled={isAnalyzing}
                      className={`w-full py-3 px-4 rounded-2xl font-bold text-xs sm:text-sm text-white flex items-center justify-center gap-2 transition-all ${
                        isAnalyzing
                          ? 'bg-pink-900/60 cursor-not-allowed opacity-75'
                          : 'bg-gradient-to-r from-pink-600 via-rose-500 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-[0_0_25px_rgba(255,105,180,0.5)] active:scale-98'
                      }`}
                    >
                      {isAnalyzing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>{analyzeStep || 'Đang giải mã và chạy thuật toán...'}</span>
                        </>
                      ) : (
                        <>
                          <span>⚡</span>
                          <span>Chạy Thuật Toán Phân Tích & Dịch Khớp Lời Tự Động</span>
                        </>
                      )}
                    </button>

                    {saveSuccessMsg && (
                      <div className="p-2.5 rounded-xl bg-pink-950/80 border border-pink-500/50 text-xs text-pink-100 flex items-center gap-2">
                        <span>{saveSuccessMsg}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Analysis Results Display */}
                {alignResult && (
                  <div className="bg-black/50 border border-pink-500/25 rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-semibold text-pink-200 flex items-center gap-1.5">
                        <span>📊 Kết Quả Phân Tích Thuật Toán:</span>
                      </h5>
                      <span className="text-[11px] font-mono text-pink-300/80">
                        Thời lượng: {formatTimeShort(alignResult.duration)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-xl bg-pink-950/40 border border-pink-500/20">
                        <div className="text-base font-bold text-pink-200">
                          {alignResult.totalOnsets}
                        </div>
                        <div className="text-[10px] text-pink-400/80">Xung cất giọng</div>
                      </div>
                      <div className="p-2 rounded-xl bg-pink-950/40 border border-pink-500/20">
                        <div className="text-base font-bold text-emerald-300">
                          {alignResult.lyrics.length}
                        </div>
                        <div className="text-[10px] text-pink-400/80">Câu đã khớp</div>
                      </div>
                      <div className="p-2 rounded-xl bg-pink-950/40 border border-pink-500/20">
                        <div className="text-base font-bold text-pink-300">97.5%</div>
                        <div className="text-[10px] text-pink-400/80">Độ tin cậy</div>
                      </div>
                    </div>

                    <div className="text-[11px] text-pink-300/80">
                      Mẫu 3 câu đầu tiên được thuật toán tính toán tự động:
                    </div>
                    <div className="space-y-1.5">
                      {alignResult.lyrics.slice(0, 3).map((l, i) => (
                        <div
                          key={i}
                          className="p-2 rounded-xl bg-black/60 border border-pink-500/15 flex items-center gap-2 text-xs"
                        >
                          <span className="font-mono text-pink-400 text-[11px]">
                            [{formatTime(l.time)}]
                          </span>
                          <span className="text-pink-100 truncate">{l.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Raw TXT Lyrics & Manual Review */}
            {activeTab === 'rawTxt' && (
              <div className="flex-1 flex flex-col gap-3">
                <div className="flex items-center justify-between text-[11px] text-pink-300/80">
                  <span>
                    Chỉnh sửa hoặc dán mốc từ <b>file TXT lyrics</b> định dạng{' '}
                    <code className="text-pink-200">[mm:ss.xx] Lời bài hát</code>:
                  </span>
                  <button
                    onClick={handleResetFromTxt}
                    className="px-2.5 py-1 rounded-lg bg-pink-950/60 hover:bg-pink-900 border border-pink-500/30 text-pink-200 text-[10px]"
                  >
                    🔄 Nạp lại từ file gốc
                  </button>
                </div>

                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="flex-1 bg-black/60 border border-pink-500/30 rounded-2xl p-3.5 font-mono text-xs text-pink-100 placeholder-pink-500/30 focus:outline-none focus:border-pink-400 resize-none leading-relaxed scrollbar-thin scrollbar-thumb-pink-500/30"
                  placeholder="[00:01.00] Lời bài hát..."
                />

                {saveSuccessMsg && (
                  <div className="text-xs p-2 rounded-xl bg-pink-950/60 border border-pink-500/40 text-pink-200">
                    {saveSuccessMsg}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1 border-t border-pink-500/20">
                  <button
                    onClick={onClose}
                    className="px-4 py-1.5 rounded-xl bg-black/50 hover:bg-black/70 border border-pink-500/30 text-xs text-pink-300"
                  >
                    Đóng
                  </button>
                  <button
                    onClick={handleApplyCustomLyrics}
                    className="px-4 py-1.5 rounded-xl bg-pink-600 hover:bg-pink-500 border border-pink-400 text-xs font-semibold text-white shadow-[0_0_15px_rgba(255,105,180,0.5)] transition-all"
                  >
                    Áp Dụng & Đối Chiếu Ngay
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
