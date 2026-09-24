import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaFile } from './api';
import { recordingFile } from './media';

/** Voice questions are short; stop automatically so a forgotten recording can't run away. */
export const MAX_RECORDING_MS = 120_000;

export type VoiceState = 'idle' | 'recording' | 'denied';

/**
 * Thin wrapper over expo-audio's recorder: permission, start, cancel, finish.
 * Kept separate so the composer stays declarative and tests can mock one module.
 */
export function useVoice(onFinished: (file: MediaFile & { durationMs: number }) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const status = useAudioRecorderState(recorder, 250);
  const [state, setState] = useState<VoiceState>('idle');
  const finishing = useRef(false);

  const start = useCallback(async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setState('denied');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    finishing.current = false;
    setState('recording');
  }, [recorder]);

  const cancel = useCallback(async () => {
    finishing.current = true;
    await recorder.stop().catch(() => undefined);
    setState('idle');
  }, [recorder]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    const durationMs = status.durationMillis;
    await recorder.stop();
    setState('idle');
    if (recorder.uri && durationMs >= 500) onFinished({ ...recordingFile(recorder.uri), durationMs });
  }, [recorder, status.durationMillis, onFinished]);

  useEffect(() => {
    if (state === 'recording' && status.durationMillis >= MAX_RECORDING_MS) void finish();
  }, [state, status.durationMillis, finish]);

  return { state, durationMs: status.durationMillis, start, cancel, finish, dismissDenied: () => setState('idle') };
}
