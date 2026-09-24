import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaFile } from './api';
import { cue, START_CUE_MS } from './feedback';
import { recordingFile } from './media';

/** Voice questions are short; stop automatically so a forgotten recording can't run away. */
export const MAX_RECORDING_MS = 120_000;
/** Bars in the live waveform (newest last). */
export const LEVEL_BARS = 36;

export type VoiceState = 'idle' | 'starting' | 'recording' | 'denied';

const QUIET: number[] = Array(LEVEL_BARS).fill(0.06);
const OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Metering is dBFS (-160..0). Speech sits roughly in -50..-5; map that to 0..1. */
export function levelFromDb(db: number | undefined, t: number): number {
  if (db === undefined || !Number.isFinite(db)) {
    // No metering (web): a calm synthetic pulse so the UI still shows it's live.
    return 0.18 + 0.12 * Math.abs(Math.sin(t / 260));
  }
  return Math.max(0.06, Math.min(1, (db + 50) / 45));
}

/**
 * expo-audio recorder with permission, sound/haptic cues, a live level history
 * for the waveform, cancel and finish. Kept separate so the composer stays
 * declarative and tests can mock one module.
 */
export function useVoice(onFinished: (file: MediaFile & { durationMs: number }) => void) {
  const recorder = useAudioRecorder(OPTIONS);
  const status = useAudioRecorderState(recorder, 80);
  const [state, setState] = useState<VoiceState>('idle');
  const [wave, setWave] = useState<{ at: number; levels: number[] }>(() => ({ at: -1, levels: QUIET }));
  const finishing = useRef(false);

  // Each recorder status tick appends one bar. Derived during render (not in an
  // effect) so a tick costs one render, not two.
  if (state === 'recording' && status.durationMillis !== wave.at) {
    const level = levelFromDb(status.metering, status.durationMillis);
    setWave({ at: status.durationMillis, levels: [...wave.levels.slice(1 - LEVEL_BARS), level] });
  }

  const start = useCallback(async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setState('denied');
      return;
    }
    setState('starting');
    setWave({ at: -1, levels: QUIET });
    const began = Date.now();
    cue('start');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    // Let the start chirp finish so it isn't in the recording.
    await wait(Math.max(0, START_CUE_MS - (Date.now() - began)));
    recorder.record();
    finishing.current = false;
    setState('recording');
  }, [recorder]);

  /** Back to playback mode, so iOS routes the cue to the speaker, not the earpiece. */
  const release = async () => {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  };

  const cancel = useCallback(async () => {
    finishing.current = true;
    await recorder.stop().catch(() => undefined);
    setState('idle');
    await release();
    cue('cancel');
  }, [recorder]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    const durationMs = status.durationMillis;
    await recorder.stop();
    setState('idle');
    await release();
    if (recorder.uri && durationMs >= 500) {
      cue('send');
      onFinished({ ...recordingFile(recorder.uri), durationMs });
    } else {
      cue('cancel');
    }
  }, [recorder, status.durationMillis, onFinished]);

  useEffect(() => {
    if (state === 'recording' && status.durationMillis >= MAX_RECORDING_MS) void finish();
  }, [state, status.durationMillis, finish]);

  return {
    state,
    durationMs: status.durationMillis,
    levels: wave.levels,
    start,
    cancel,
    finish,
    dismissDenied: () => setState('idle'),
  };
}
