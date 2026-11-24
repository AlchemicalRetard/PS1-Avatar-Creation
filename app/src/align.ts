// Times words to recorded speech that comes without timestamps: find the pauses in the audio, match
// them to the punctuation, and share the time between them out over the words. Pure, no DOM.
import type { TimedWord } from './lipsync.ts';
import type { VisemeId } from './visemes.ts';

export const FRAME_SECONDS = 0.01;

/** Seconds. */
export interface Span { start: number; end: number }

/** Loudness of each 10 ms of audio. */
export function loudness(samples: Float32Array, sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * FRAME_SECONDS)), levels = new Float32Array(Math.ceil(samples.length / size));
  for (let f = 0; f < levels.length; f++) {
    const from = f * size, to = Math.min(samples.length, from + size);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    levels[f] = Math.sqrt(sum / (to - from));
  }
  return levels;
}

/** Stretches of speech, joining across silences shorter than `minGap`. */
export function findSpeech(levels: Float32Array, minGap: number): Span[] {
  if (!levels.length) return [];
  const loud = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.95)];
  const threshold = Math.max(0.004, loud * 0.09), spans: Span[] = [];
  for (let f = 0; f < levels.length; f++) {
    if (levels[f] < threshold) continue;
    const start = f * FRAME_SECONDS, end = start + FRAME_SECONDS, last = spans.at(-1);
    if (last && start - last.end < minGap) last.end = end;
    else spans.push({ start, end });
  }
  return spans.filter(s => s.end - s.start >= 0.03);
}

/** Pairs expected pauses with silences, in order, using as many as possible with the least total error. */
function matchPauses(expected: number[], gaps: Span[]): Map<number, Span> {
  const rows = expected.length, columns = gaps.length, need = Math.min(rows, columns);
  const cost = (r: number, c: number) => Math.abs((gaps[c].start + gaps[c].end) / 2 - expected[r]) - (gaps[c].end - gaps[c].start) * 0.5;
  // best[r][c][n]: lowest cost pairing n of the first r pauses with n of the first c silences.
  const best = Array.from({ length: rows + 1 }, () => Array.from({ length: columns + 1 }, () => new Array<number>(need + 1).fill(Infinity)));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= columns; c++) {
      best[r][c][0] = 0;
      for (let n = 1; n <= Math.min(r, c, need); n++) {
        best[r][c][n] = Math.min(best[r - 1][c][n], best[r][c - 1][n], best[r - 1][c - 1][n - 1] + cost(r - 1, c - 1));
      }
    }
  }
  const pairs = new Map<number, Span>();
  for (let r = rows, c = columns, n = need; n > 0;) {
    if (best[r][c][n] === best[r - 1][c][n]) r--;
    else if (best[r][c][n] === best[r][c - 1][n]) c--;
    else {
      pairs.set(r - 1, gaps[c - 1]);
      r--; c--; n--;
    }
  }
  return pairs;
}

export interface PlacedWord { at: number; seconds: number; frames: TimedWord['frames']; ms: number }

export function placeWords(words: TimedWord[], speech: Span[]): PlacedWord[] {
  const spoken = words.filter(w => w.ms > 0);
  if (!spoken.length || !speech.length) return [];
  const from = speech[0].start, to = speech.at(-1)!.end;
  const total = spoken.reduce((sum, w, i) => sum + w.ms + (i < spoken.length - 1 ? w.pause : 0), 0);

  // Where each pause should fall if the whole text were spoken at an even pace.
  const pauses: { after: number; time: number }[] = [];
  let passed = 0;
  spoken.forEach((w, i) => {
    passed += w.ms;
    if (i < spoken.length - 1 && w.pause) pauses.push({ after: i, time: from + (passed + w.pause / 2) / total * (to - from) });
    passed += w.pause;
  });
  const gaps = speech.slice(1).map((s, i) => ({ start: speech[i].end, end: s.start }));
  const matched = matchPauses(pauses.map(p => p.time), gaps);

  const placed: PlacedWord[] = [];
  let first = 0, start = from;
  const fill = (last: number, end: number) => {
    const group = spoken.slice(first, last + 1), length = group.reduce((sum, w, i) => sum + w.ms + (i < group.length - 1 ? w.pause : 0), 0);
    const scale = Math.max(0, end - start) / length;
    let at = start;
    group.forEach(w => {
      placed.push({ at, seconds: w.ms * scale, frames: w.frames, ms: w.ms });
      at += (w.ms + w.pause) * scale;
    });
    first = last + 1;
  };
  pauses.forEach(({ after }, i) => {
    const gap = matched.get(i);
    if (!gap) return;
    fill(after, gap.start);
    start = gap.end;
  });
  fill(spoken.length - 1, to);
  return placed;
}

/** Mouth shapes for a recording, by time in seconds. The mouth also rests whenever the audio is silent. */
export class AudioSync {
  private placed: PlacedWord[];
  private voiced: Span[];

  constructor(words: TimedWord[], samples: Float32Array, sampleRate: number) {
    const levels = loudness(samples, sampleRate);
    this.placed = placeWords(words, findSpeech(levels, 0.13));
    // Shorter silences are part of speech (the closure before a T or K), so they do not count here.
    this.voiced = findSpeech(levels, 0.09);
  }

  visemeAt(time: number): VisemeId {
    if (!this.voiced.some(s => time >= s.start && time < s.end)) return 'sil';
    const word = this.placed.findLast(w => time >= w.at);
    if (!word || time >= word.at + word.seconds) return 'sil';
    let ms = (time - word.at) / word.seconds * word.ms;
    for (const frame of word.frames) {
      if (ms < frame.ms) return frame.viseme;
      ms -= frame.ms;
    }
    return 'sil';
  }
}
