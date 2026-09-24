// Synthesizes the UI sound effects as small 16-bit mono WAVs.
// Usage: node scripts/sounds.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44_100;
const OUT = join(import.meta.dirname, '..', 'assets', 'sounds');

/** A soft bell-like note: sine + quiet octave, fast attack, exponential decay. */
function note(freq, ms, { gain = 0.32, decay = 5 } = {}) {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Float32Array(n);
  const attack = Math.round(RATE * 0.006);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, i / attack) * Math.exp((-decay * i) / n);
    out[i] = gain * env * (Math.sin(2 * Math.PI * freq * t) + 0.18 * Math.sin(4 * Math.PI * freq * t));
  }
  return out;
}

function sequence(parts) {
  const total = parts.reduce((s, p) => Math.max(s, p.at + p.samples.length), 0);
  const mix = new Float32Array(total + Math.round(RATE * 0.02));
  for (const p of parts) p.samples.forEach((v, i) => (mix[p.at + i] += v));
  return mix;
}
const at = (ms) => Math.round((RATE * ms) / 1000);

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

const sounds = {
  // Rising fifth: "listening".
  'rec-start.wav': sequence([
    { at: 0, samples: note(659.25, 110) },
    { at: at(75), samples: note(987.77, 150) },
  ]),
  // Rising major third, brighter: "sent".
  'rec-send.wav': sequence([
    { at: 0, samples: note(783.99, 90, { gain: 0.28 }) },
    { at: at(60), samples: note(1174.66, 170, { gain: 0.28 }) },
  ]),
  // Falling fourth, softer: "discarded".
  'rec-cancel.wav': sequence([
    { at: 0, samples: note(587.33, 100, { gain: 0.24 }) },
    { at: at(80), samples: note(440, 160, { gain: 0.24, decay: 6 }) },
  ]),
  // Single soft tone when an answer lands while the user waited.
  'answer.wav': sequence([{ at: 0, samples: note(880, 220, { gain: 0.16, decay: 6 }) }]),
};

for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(join(OUT, name), wav(samples));
  console.log('wrote', name, samples.length, 'samples');
}
