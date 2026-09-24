import { type AudioPlayer, createAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Short UI sounds plus matching haptics for voice recording and answers.
 * Players are created lazily once and reused, so a cue costs a seek + play.
 */
const SOURCES = {
  start: require('../../assets/sounds/rec-start.wav'),
  send: require('../../assets/sounds/rec-send.wav'),
  cancel: require('../../assets/sounds/rec-cancel.wav'),
  answer: require('../../assets/sounds/answer.wav'),
} as const;

export type Cue = keyof typeof SOURCES;

/** Length of the start cue; recording begins after it so the chirp isn't captured. */
export const START_CUE_MS = 220;

let enabled = true;
const players = new Map<Cue, AudioPlayer>();

export function setFeedbackEnabled(on: boolean): void {
  enabled = on;
}

function player(cue: Cue): AudioPlayer | undefined {
  try {
    let p = players.get(cue);
    if (!p) {
      p = createAudioPlayer(SOURCES[cue]);
      p.volume = cue === 'answer' ? 0.5 : 0.8;
      players.set(cue, p);
    }
    return p;
  } catch {
    return undefined;
  }
}

/** Warm the players so the first tap has no decode delay. */
export function preloadFeedback(): void {
  for (const cue of Object.keys(SOURCES) as Cue[]) player(cue);
}

function haptic(cue: Cue): void {
  if (Platform.OS === 'web') return;
  const run =
    cue === 'start'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      : cue === 'send'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : cue === 'cancel'
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          : Haptics.selectionAsync();
  run.catch(() => undefined);
}

export function cue(name: Cue): void {
  if (!enabled) return;
  haptic(name);
  const p = player(name);
  if (!p) return;
  try {
    void p.seekTo(0).then(() => p.play());
  } catch {
    // Sound is decoration; never let it break the flow.
  }
}
