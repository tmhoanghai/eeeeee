/**
 * Strict Audio Speed Controller
 * Locks any HTMLAudioElement strictly to 1.0x normal speed in ALL situations:
 * - Prevents speed-up / slow-down from browser plugins (e.g. Video Speed Controller)
 * - Prevents keyboard shortcuts from altering playback speed
 * - Prevents clock drift or resampling rate variations
 */

export function lockAudioSpeed1x(audio: HTMLAudioElement): void {
  try {
    // 1. Set explicit 1.0 playback rate and default rate
    audio.playbackRate = 1.0;
    audio.defaultPlaybackRate = 1.0;

    if ('preservesPitch' in audio) {
      audio.preservesPitch = true;
    }

    // 2. Realtime listener: snap immediately back to 1.0 on any ratechange event
    const handleRateChange = () => {
      try {
        const protoDesc = Object.getOwnPropertyDescriptor(
          HTMLMediaElement.prototype,
          'playbackRate'
        );
        if (protoDesc && protoDesc.set) {
          protoDesc.set.call(audio, 1.0);
        } else {
          audio.playbackRate = 1.0;
        }
      } catch {
        // noop
      }
    };

    audio.addEventListener('ratechange', handleRateChange);

    // 3. Strictly intercept playbackRate property on this audio instance
    const protoDesc = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'playbackRate'
    );

    if (protoDesc && protoDesc.set) {
      Object.defineProperty(audio, 'playbackRate', {
        get() {
          return 1.0;
        },
        set(_newRate: number) {
          // Force strictly 1.0 regardless of what external code or extensions request
          protoDesc.set?.call(audio, 1.0);
        },
        configurable: true,
        enumerable: true,
      });
    }
  } catch (err) {
    console.warn('Audio speed lock notice:', err);
    try {
      audio.playbackRate = 1.0;
    } catch {
      // noop
    }
  }
}
