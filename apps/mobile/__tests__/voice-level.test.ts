jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} } }));
jest.mock('../src/lib/feedback', () => ({ cue: jest.fn(), START_CUE_MS: 0 }));
import { levelFromDb } from '../src/lib/useVoice';

describe('levelFromDb', () => {
  it('maps speech loudness to 0..1 with a visible floor', () => {
    expect(levelFromDb(-160, 0)).toBeCloseTo(0.06);
    expect(levelFromDb(-50, 0)).toBeCloseTo(0.06);
    expect(levelFromDb(-27.5, 0)).toBeCloseTo(0.5);
    expect(levelFromDb(0, 0)).toBe(1);
  });

  it('pulses gently when the platform has no metering', () => {
    const a = levelFromDb(undefined, 0);
    const b = levelFromDb(undefined, 400);
    expect(a).toBeGreaterThan(0.1);
    expect(b).not.toBe(a);
  });
});
