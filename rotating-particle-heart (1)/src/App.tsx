/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SONGS, SongItem, TimedLyric } from './songsData';
import { getDetailedActiveLyric, ActiveLyricState } from './utils/lrcParser';
import { fetchLyricsFromLRCLIB } from './services/lyricsApi';
import { LyricsInspectorModal } from './components/LyricsInspectorModal';
import { realtimeVocalEngine, LiveVocalStatus } from './utils/realtimeVocalDetector';
import { lockAudioSpeed1x } from './utils/audioSpeedLock';

// Math helpers for particle heart
interface Particle {
  baseX: number;
  baseY: number;
  baseZ: number;
  startX: number;
  startY: number;
  startZ: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spring: number;
  friction: number;
  size: number;
  hueOffset: number;
  lightness: number;
  color: string;
  screenX: number;
  screenY: number;
  perspective: number;
  zDepth: number;
}

interface Star {
  xRatio: number; // 0 to 1
  yRatio: number; // 0 to 1
  size: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
}

interface LightOrb {
  xRatio: number;
  yRatio: number;
  radiusRatio: number;
  vx: number;
  vy: number;
  phaseX: number;
  phaseY: number;
  colorRgb: string; // e.g. "255, 60, 120"
  maxOpacity: number;
}

interface LyricDust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  hue: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [hasEntered, setHasEntered] = useState(false);
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const [playingAudio, setPlayingAudio] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentLyricText, setCurrentLyricText] = useState<string>('');
  const [showLyrics, setShowLyrics] = useState(true);

  const togglePlayPause = () => {
    const audio = audioRef.current || playingAudio;
    if (!audio) return;
    lockAudioSpeed1x(audio);
    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch((err) => console.log('Play err:', err));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const [activeLyricState, setActiveLyricState] = useState<ActiveLyricState>({
    currentText: '',
    nextText: '',
    activeLineIndex: -1,
    wordProgress: 0,
    activeWordIndex: -1,
    words: [],
  });
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isLyricsInspectorOpen, setIsLyricsInspectorOpen] = useState<boolean>(false);
  const [liveVocalStatus, setLiveVocalStatus] = useState<LiveVocalStatus>({
    vocalEnergy: 0,
    bassEnergy: 0,
    trebleEnergy: 0,
    isVocalActive: false,
    isInstrumental: true,
    confidence: 0,
  });
  const [autoSnapLive, setAutoSnapLive] = useState<boolean>(true);

  const handleSeek = (targetTime: number) => {
    if (playingAudio) {
      lockAudioSpeed1x(playingAudio);
      playingAudio.currentTime = targetTime;
      setCurrentTime(targetTime);
      if (playingAudio.paused) {
        playingAudio.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  };

  const handleUpdateLyrics = (newLyrics: TimedLyric[]) => {
    if (currentSong) {
      setCurrentSong({
        ...currentSong,
        lyrics: newLyrics,
      });
    }
  };

  // Automatically fetch online synced LRC lyrics from LRCLIB API whenever song changes
  useEffect(() => {
    if (!currentSong || !currentSong.title) return;

    let isMounted = true;
    const autoFetchApiLyrics = async () => {
      try {
        // Skip lyrics for "Buồn Hay Vui" per user request
        if (currentSong.title.toLowerCase().includes('buồn hay vui')) {
          return;
        }

        // Do not overwrite built-in songs that already have curated precise LRC lyrics
        const isBuiltIn = SONGS.some((s) => s.title === currentSong.title && s.lyrics.length > 0);
        if (isBuiltIn) {
          return;
        }

        const titleQuery = currentSong.title.replace(/\.mp3$/i, '').trim();
        const res = await fetchLyricsFromLRCLIB(titleQuery);
        if (isMounted && res && res.syncedLyrics && res.syncedLyrics.length > 0) {
          setCurrentSong((prev) => {
            if (!prev || prev.title !== currentSong.title) return prev;
            return {
              ...prev,
              lyrics: res.syncedLyrics,
            };
          });
        }
      } catch (err) {
        console.log('Auto API lyrics fetch note:', err);
      }
    };

    autoFetchApiLyrics();
    return () => {
      isMounted = false;
    };
  }, [currentSong?.title]);

  const currentSongRef = useRef<SongItem | null>(null);
  currentSongRef.current = currentSong;

  const isLyricsInspectorOpenRef = useRef(false);
  isLyricsInspectorOpenRef.current = isLyricsInspectorOpen;

  // Phát bài hát theo vị trí index; hỗ trợ vòng lặp vô tận (hết folder thì quay lại bài 1)
  const playSongAtIndex = useCallback((targetIdx: number) => {
    const validIdx = ((targetIdx % SONGS.length) + SONGS.length) % SONGS.length;
    const nextSong = SONGS[validIdx];
    setCurrentSong(nextSong);
    setCurrentLyricText('');
    setActiveLyricState({
      currentText: '',
      nextText: '',
      activeLineIndex: -1,
      wordProgress: 0,
      activeWordIndex: -1,
      words: [],
    });
    setCurrentTime(0);

    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audioRef.current = audio;
      setPlayingAudio(audio);
    }

    audio.pause();
    const encodedPath = encodeURI(nextSong.filename);
    audio.src = encodedPath;
    audio.currentTime = 0;
    audio.loop = false;
    audio.volume = 0.6;
    lockAudioSpeed1x(audio);

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => {
          console.log('Playback start/switch notice:', err);
        });
    }
  }, []);

  // Chuyển sang bài tiếp theo: khi hết danh sách bài trong folder, tự động quay về bài 1 (index 0)
  const handleNextSong = useCallback(() => {
    const curr = currentSongRef.current;
    const currIdx = curr ? SONGS.findIndex((s) => s.title === curr.title) : 0;
    const nextIdx = (currIdx + 1) % SONGS.length;
    playSongAtIndex(nextIdx);
  }, [playSongAtIndex]);

  // Lắng nghe sự kiện kết thúc bài hát (ended) để tự động phát bài tiếp theo và lặp lại từ bài 1 khi hết folder
  useEffect(() => {
    const audio = audioRef.current || playingAudio;
    if (!audio) return;

    const handleEnded = () => {
      handleNextSong();
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [playingAudio, handleNextSong]);

  // Đồng bộ lyrics theo thời gian thực (hỗ trợ hiển thị mượt mà kể cả khi chuyển bài hoặc bài không có lời)
  useEffect(() => {
    const audio = audioRef.current || playingAudio;
    if (!hasEntered || !audio) return;

    let animFrameId: number;
    let frameCount = 0;
    let lastLyricCheckTime = 0;

    lockAudioSpeed1x(audio);

    const updateLyric = () => {
      if (audio.playbackRate !== 1.0) {
        audio.playbackRate = 1.0;
      }
      const time = audio.currentTime;
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration((prev) => (prev !== audio.duration ? audio.duration : prev));
      }

      const songLyrics = currentSongRef.current?.lyrics;
      if (songLyrics && songLyrics.length > 0) {
        const state = getDetailedActiveLyric(time, songLyrics);
        setActiveLyricState((prev) => {
          if (
            prev.currentText === state.currentText &&
            prev.activeLineIndex === state.activeLineIndex &&
            prev.activeWordIndex === state.activeWordIndex
          ) {
            return prev;
          }
          return state;
        });
        setCurrentLyricText((prev) => (prev !== state.currentText ? state.currentText : prev));
      } else {
        setCurrentLyricText((prev) => (prev !== '' ? '' : prev));
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      updateLyric();
    };

    const loop = () => {
      const now = performance.now();
      if (now - lastLyricCheckTime > 80) {
        lastLyricCheckTime = now;
        updateLyric();
      }

      frameCount++;
      if (frameCount % 6 === 0 && isLyricsInspectorOpenRef.current) {
        const time = audio.currentTime;
        const songLyrics = currentSongRef.current?.lyrics;
        const isInst = (!songLyrics || songLyrics.length === 0) && time > 0;
        const live = realtimeVocalEngine.analyzeLive(time, !audio.paused, isInst);
        setLiveVocalStatus(live);
      }
      animFrameId = requestAnimationFrame(loop);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('seeking', handleTimeUpdate);
    audio.addEventListener('seeked', handleTimeUpdate);

    updateLyric();
    animFrameId = requestAnimationFrame(loop);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('seeking', handleTimeUpdate);
      audio.removeEventListener('seeked', handleTimeUpdate);
      cancelAnimationFrame(animFrameId);
    };
  }, [hasEntered, playingAudio, currentSong]);

  const handleStartApp = () => {
    setHasEntered(true);
    // Bắt đầu phát từ bài 1 ("4 Mùa Thương Em")
    playSongAtIndex(0);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];
    let stars: Star[] = [];
    let lightOrbs: LightOrb[] = [];
    let lyricDusts: LyricDust[] = [];
    
    // Performance optimization: detect mobile to adjust density & eliminate lag
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const numParticles = isMobile ? 2200 : 5000; 
    const numStars = isMobile ? 45 : 120; 
    const numDusts = isMobile ? 16 : 35; 
    const numOrbs = isMobile ? 3 : 6;
    let angleY = -Math.PI / 4; 
    const baseRotSpeed = 0.028; 

    // Initialize Latin Hype floating lyric dust
    for (let d = 0; d < numDusts; d++) {
      lyricDusts.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.2) * 0.4,
        vy: -0.3 - Math.random() * 0.6,
        size: Math.random() * 2.8 + 0.8,
        alpha: Math.random() * 0.6 + 0.2,
        phase: Math.random() * Math.PI * 2,
        hue: 330 + Math.random() * 30
      });
    }

    // Initialize drifting light orbs
    const orbColors = [
      '255, 60, 110',  // Rose pink
      '220, 20, 60',   // Crimson
      '255, 100, 180', // Soft magenta
      '200, 40, 140',  // Deep violet pink
      '255, 80, 80',   // Coral red
      '180, 30, 90',   // Dark rose
    ];

    for (let o = 0; o < numOrbs; o++) {
      lightOrbs.push({
        xRatio: Math.random(),
        yRatio: Math.random(),
        radiusRatio: 0.18 + Math.random() * 0.15,
        vx: (Math.random() - 0.5) * 0.0003,
        vy: (Math.random() - 0.5) * 0.0003,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        colorRgb: orbColors[o % orbColors.length],
        maxOpacity: 0.06 + Math.random() * 0.08,
      });
    }

    // Initialize background star field
    for (let sIdx = 0; sIdx < numStars; sIdx++) {
      stars.push({
        xRatio: Math.random(),
        yRatio: Math.random(),
        size: Math.random() * 1.5 + 0.4,
        baseAlpha: Math.random() * 0.4 + 0.15,
        twinkleSpeed: 0.001 + Math.random() * 0.002,
        phase: Math.random() * Math.PI * 2,
      });
    }
    
    // Resize handler
    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    // Initialize 3D Math Heart Particles
    let i = 0;
    while (i < numParticles) {
      let px = (Math.random() - 0.5) * 4; 
      let py = (Math.random() - 0.5) * 4;
      let pz = (Math.random() - 0.5) * 4;
      
      let x2 = px * px;
      let y2 = py * py;
      let z2 = pz * pz;
      
      let a = x2 + 2.25 * y2 + z2 - 1.0;
      let val = a * a * a - x2 * z2 * pz - 0.1125 * y2 * z2 * pz;
      
      const isTopLobe = pz > 0.0;
      const minVal = isTopLobe ? -0.35 : -0.16;

      if (val <= 0.0 && val > minVal) {
        const scaleFactor = 16;
        const baseX = px * scaleFactor;
        const baseY = -pz * scaleFactor; 
        const baseZ = py * scaleFactor;
        
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = 180 + Math.random() * 220; 
        const startX = r * Math.sin(phi) * Math.cos(theta);
        const startY = r * Math.sin(phi) * Math.sin(theta);
        const startZ = r * Math.cos(phi);
        
        // Hue variation for HSL cycle
        const hueOffset = (Math.random() - 0.5) * 35; // Variation around base hue
        const lightness = isTopLobe ? (50 + Math.random() * 20) : (40 + Math.random() * 20);

        particles.push({
          baseX, baseY, baseZ,
          startX, startY, startZ,
          x: startX, y: startY, z: startZ,
          vx: 0, vy: 0, vz: 0,
          spring: 0.06 + Math.random() * 0.04,
          friction: 0.82 + Math.random() * 0.04,
          size: isTopLobe ? (Math.random() * 1.8 + 1.0) : (Math.random() * 1.5 + 0.7),
          hueOffset,
          lightness,
          color: '',
          screenX: 0,
          screenY: 0,
          perspective: 1,
          zDepth: 0
        });
        i++;
      }
    }

    // Downward tilt
    const tiltX = 0.35; 
    const cosX = Math.cos(tiltX);
    const sinX = Math.sin(tiltX);

    let startTime = performance.now();
    const GATHER_DURATION = 1400;  
    const BLOOM_DURATION = 1600;   
    const TOTAL_ENTRANCE = GATHER_DURATION + BLOOM_DURATION;

    const DISK_TEXT = " CHÚC MỪNG SINH NHẬT HIKA LOVE YOU;D • 19/10/2013❤30/11/2012 • ";
    const textRingRadius = 16.0; 
    const textRingY = 14.5;

    const animate = (now: number) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#050002'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2 - 15;

      // Render drifting background light orbs
      ctx.globalCompositeOperation = 'screen';
      lightOrbs.forEach(orb => {
        orb.phaseX += 0.002;
        orb.phaseY += 0.0015;
        const ox = (orb.xRatio + Math.sin(orb.phaseX) * 0.12) * canvas.width;
        const oy = (orb.yRatio + Math.cos(orb.phaseY) * 0.12) * canvas.height;
        const radius = orb.radiusRatio * Math.min(canvas.width, canvas.height);

        const orbGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
        orbGrad.addColorStop(0, `rgba(${orb.colorRgb}, ${orb.maxOpacity})`);
        orbGrad.addColorStop(0.5, `rgba(${orb.colorRgb}, ${orb.maxOpacity * 0.4})`);
        orbGrad.addColorStop(1, `rgba(${orb.colorRgb}, 0)`);

        ctx.fillStyle = orbGrad;
        ctx.beginPath();
        ctx.arc(ox, oy, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Render subtle twinkling background star field
      stars.forEach(star => {
        const starX = star.xRatio * canvas.width;
        const starY = star.yRatio * canvas.height;
        const twinkle = Math.sin(now * star.twinkleSpeed + star.phase);
        const alpha = Math.max(0.02, Math.min(0.85, star.baseAlpha + twinkle * 0.25));
        
        ctx.fillStyle = `rgba(255, 235, 245, ${alpha})`;
        ctx.fillRect(starX, starY, star.size, star.size);
      });

      // Render Latin Hype style Particle Dust Overlay / Floating Bokeh Particles
      ctx.globalCompositeOperation = 'lighter';
      lyricDusts.forEach(dust => {
        dust.x += dust.vx + Math.sin(now * 0.0008 + dust.phase) * 0.35;
        dust.y += dust.vy;

        if (dust.y < -20) {
          dust.y = canvas.height + 20;
          dust.x = Math.random() * canvas.width;
        }
        if (dust.x < -20) dust.x = canvas.width + 20;
        if (dust.x > canvas.width + 20) dust.x = -20;

        const pulseAlpha = dust.alpha * (0.5 + Math.sin(now * 0.002 + dust.phase) * 0.5);
        
        // Pure soft white to warm pink glowing bokeh overlay
        if (dust.size > 2.2) {
          // Glow bokeh circle
          const grad = ctx.createRadialGradient(dust.x, dust.y, 0, dust.x, dust.y, dust.size * 2);
          grad.addColorStop(0, `rgba(255, 245, 250, ${pulseAlpha})`);
          grad.addColorStop(0.4, `rgba(255, 180, 210, ${pulseAlpha * 0.5})`);
          grad.addColorStop(1, 'rgba(255, 180, 210, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(dust.x, dust.y, dust.size * 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Crisp soft particle dust
          ctx.fillStyle = `rgba(255, 240, 248, ${pulseAlpha})`;
          ctx.beginPath();
          ctx.arc(dust.x, dust.y, dust.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      ctx.globalCompositeOperation = 'source-over';

      // IF USER HAS NOT ENTERED YET -> Render Opening "CLICK TO ENTER"
      if (!canvas.getAttribute('data-entered')) {
        const pulse = 1 + Math.sin(now * 0.006) * 0.08;
        const fontSize = Math.min(canvas.width / 12, 42) * pulse;

        ctx.save();
        ctx.shadowColor = 'rgba(255, 30, 80, 0.9)';
        ctx.shadowBlur = 24 * pulse;
        ctx.font = `italic 800 ${fontSize}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#ff2a55';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CLICK TO ENTER', centerX, centerY);
        ctx.restore();

        startTime = now;
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      const elapsed = now - startTime;
      
      // Calculate gather phase & bloom phase
      let bloomEase = 0;
      let gatherProg = 0;
      if (elapsed < GATHER_DURATION) {
        gatherProg = Math.min(1, elapsed / GATHER_DURATION);
        gatherProg = gatherProg < 0.5 ? 2 * gatherProg * gatherProg : 1 - Math.pow(-2 * gatherProg + 2, 2) / 2;
        bloomEase = 0.02;
      } else {
        gatherProg = 1;
        const bloomProg = Math.min(1, (elapsed - GATHER_DURATION) / BLOOM_DURATION);
        bloomEase = 1 - Math.pow(1 - bloomProg, 3); 
      }

      // HSL Slow Color Cycle (oscillates smoothly through romantic pink, crimson, rose & magenta)
      // Cycle period ~20s
      const currentBaseHue = (345 + Math.sin(now * 0.0003) * 35 + 360) % 360;

      // Glow behind heart
      const glowHue = (currentBaseHue + 360) % 360;
      const gradient = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, Math.min(canvas.width, canvas.height) * (0.2 + 0.35 * bloomEase)
      );
      gradient.addColorStop(0, `hsla(${glowHue}, 90%, 45%, ${0.1 + 0.18 * bloomEase})`);
      gradient.addColorStop(0.5, `hsla(${glowHue}, 80%, 20%, 0.04)`);
      gradient.addColorStop(1, 'rgba(5, 0, 2, 0)');
      
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle heartbeat pulse after full bloom
      const heartbeat = elapsed >= TOTAL_ENTRANCE ? 1 + Math.sin(now * 0.003) * 0.025 : 1;
      
      const scaleBase = Math.min(canvas.width, canvas.height) / 38;
      const scale = scaleBase * (0.15 + 0.85 * bloomEase) * heartbeat;
      
      // Clockwise rotation
      angleY -= baseRotSpeed;

      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const focalLength = 300;
      const zOffset = 60;

      // Update particle positions & HSL dynamic color
      particles.forEach(p => {
        if (elapsed < GATHER_DURATION) {
          p.x = p.startX * (1 - gatherProg);
          p.y = p.startY * (1 - gatherProg);
          p.z = p.startZ * (1 - gatherProg);
        } else {
          p.x = p.baseX * bloomEase;
          p.y = p.baseY * bloomEase;
          p.z = p.baseZ * bloomEase;
        }

        const particleHue = (currentBaseHue + p.hueOffset + 360) % 360;
        p.color = `hsl(${particleHue}, 95%, ${p.lightness}%)`;

        // 3D rotation
        const rotX_Y = p.x * cosY - p.z * sinY;
        const rotZ_Y = p.x * sinY + p.z * cosY;
        const rotY_Y = p.y;

        const rotY = rotY_Y * cosX - rotZ_Y * sinX;
        const rotZ = rotY_Y * sinX + rotZ_Y * cosX;
        const rotX = rotX_Y;
        
        p.perspective = focalLength / (focalLength + rotZ + zOffset);
        p.screenX = centerX + rotX * scale * p.perspective;
        p.screenY = centerY + rotY * scale * p.perspective;
        p.zDepth = rotZ;
      });

      // Render 3D Text Disk Ribbon with JetBrains Mono
      const textNodes: any[] = [];
      if (bloomEase > 0.08) {
        const textAngleY = angleY * 0.7;
        const backTextNodes: any[] = [];
        const frontTextNodes: any[] = [];

        const diskChars = Array.from(DISK_TEXT);
        for (let idx = 0; idx < diskChars.length; idx++) {
          const charRotY = textAngleY - (idx * Math.PI * 2) / diskChars.length;
          const px = Math.sin(charRotY) * textRingRadius * bloomEase;
          const pz = Math.cos(charRotY) * textRingRadius * bloomEase;
          const py = textRingY;

          const rotY = py * cosX - pz * sinX;
          const rotZ = py * sinX + pz * cosX;
          const rotX = px;

          const perspective = focalLength / (focalLength + rotZ + zOffset);

          const node = {
            char: diskChars[idx],
            screenX: centerX + rotX * scale * perspective,
            screenY: centerY + rotY * scale * perspective,
            perspective,
            zDepth: rotZ,
          };

          if (rotZ >= 0) {
            backTextNodes.push(node);
          } else {
            frontTextNodes.push(node);
          }
        }

        // Helper to draw text ribbon letters
        const renderTextNode = (item: any, isFront: boolean) => {
          const opacity = (isFront ? Math.min(1, item.perspective) : Math.max(0.12, item.perspective * 0.25)) * bloomEase;
          const isHeart = item.char === '❤' || item.char === '♥';
          const fillColor = isHeart
            ? (isFront ? '#ff2b6d' : '#ff6699')
            : (isFront ? '#ffffff' : `hsl(${currentBaseHue}, 100%, 75%)`);
          const baseFontSize = diskChars.length > 55 ? 16 : 20;
          const fontSize = Math.max(8, (baseFontSize * item.perspective * scale) / 22);

          ctx.globalAlpha = opacity;
          ctx.fillStyle = fillColor;
          if (isFront) {
            ctx.shadowColor = isHeart ? 'rgba(255, 43, 109, 0.95)' : `hsla(${currentBaseHue}, 100%, 70%, 0.9)`;
            ctx.shadowBlur = isHeart ? 16 : 12;
          } else {
            ctx.shadowBlur = 0;
          }
          ctx.font = `italic 800 ${fontSize}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.char, item.screenX, item.screenY);
          ctx.shadowBlur = 0;
        };

        // 1. Draw background text ribbon (behind heart)
        for (let b = 0; b < backTextNodes.length; b++) {
          renderTextNode(backTextNodes[b], false);
        }

        // 2. Draw heart particles (lightweight batching, no 6500-element quicksort per frame)
        for (let j = 0; j < particles.length; j++) {
          const item = particles[j];
          const drawSize = Math.max(1.2, item.size * item.perspective * 1.8);
          const opacity = Math.min(1, Math.max(0.5, item.perspective)) * Math.max(0.2, bloomEase);

          ctx.globalAlpha = opacity;
          ctx.fillStyle = item.color;
          ctx.fillRect(item.screenX - drawSize / 2, item.screenY - drawSize / 2, drawSize, drawSize);
        }

        // 3. Draw foreground text ribbon (in front of heart)
        for (let f = 0; f < frontTextNodes.length; f++) {
          renderTextNode(frontTextNodes[f], true);
        }
      } else {
        // Just draw particles during initial gathering phase
        for (let j = 0; j < particles.length; j++) {
          const item = particles[j];
          const drawSize = Math.max(1.2, item.size * item.perspective * 1.8);
          const opacity = Math.min(1, Math.max(0.5, item.perspective)) * Math.max(0.2, bloomEase);

          ctx.globalAlpha = opacity;
          ctx.fillStyle = item.color;
          ctx.fillRect(item.screenX - drawSize / 2, item.screenY - drawSize / 2, drawSize, drawSize);
        }
      }

      ctx.globalAlpha = 1.0;
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const onCanvasClick = () => {
    if (!hasEntered) {
      if (canvasRef.current) {
        canvasRef.current.setAttribute('data-entered', 'true');
      }
      handleStartApp();
    } else if (playingAudio && playingAudio.paused) {
      lockAudioSpeed1x(playingAudio);
      playingAudio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  return (
    <div className="w-full h-screen bg-[#050002] text-[#fff0f5] flex flex-col overflow-hidden relative select-none"> 
      <div 
        className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer"
        onClick={onCanvasClick}
        onTouchStart={onCanvasClick}
      >
        <canvas 
          ref={canvasRef} 
          className="block touch-none w-full h-full"
        />
      </div>

      {/* Left-aligned Higher Floating Lyric Overlay with Gentle Swaying Motion */}
      <AnimatePresence>
        {hasEntered && currentLyricText && (
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="absolute top-[16%] sm:top-[18%] left-4 sm:left-7 md:left-12 z-20 max-w-[320px] sm:max-w-[460px] md:max-w-lg lg:max-w-xl pointer-events-none text-left"
          >
            {/* Gentle 2D swaying left-right, up-down floating animation */}
            <motion.div
              animate={{
                x: [-8, 8, -8],
                y: [-6, 6, -6],
                rotate: [-1.2, 1.2, -1.2],
              }}
              transition={{
                duration: 6.5,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <motion.div
                key={`${currentLyricText}-${activeLyricState.activeLineIndex}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
                className={`${
                  currentLyricText.replace(/\\n|\n/g, ' ').trim().length > 55
                    ? 'text-xs sm:text-sm md:text-base lg:text-lg'
                    : 'text-sm sm:text-base md:text-lg lg:text-xl'
                } font-semibold leading-snug sm:leading-relaxed tracking-wider whitespace-pre-line text-pink-100 drop-shadow-[0_0_14px_rgba(255,182,193,0.9)] drop-shadow-[0_0_22px_rgba(255,105,180,0.55)] text-left`}
                style={{
                  fontFamily: '"Caveat", "Dancing Script", "Satisfy", "Mali", "Quicksand", cursive, sans-serif',
                }}
              >
                <p>{currentLyricText.replace(/\\n/g, '\n')}</p>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lyrics Inspector & Live Timeline Modal */}
      <LyricsInspectorModal
        isOpen={isLyricsInspectorOpen}
        onClose={() => setIsLyricsInspectorOpen(false)}
        currentSong={currentSong}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        activeLineIndex={activeLyricState.activeLineIndex}
        isInstrumental={!currentLyricText && hasEntered && currentTime > 0}
        liveVocalStatus={liveVocalStatus}
        autoSnapLive={autoSnapLive}
        onToggleAutoSnapLive={() => setAutoSnapLive((prev) => !prev)}
        onSeek={handleSeek}
        onTogglePlay={togglePlayPause}
        onUpdateLyrics={handleUpdateLyrics}
      />
    </div>
  );
}



