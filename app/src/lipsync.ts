// Decides which mouth shape to show at each moment while a voice is speaking.
import { textToWords } from './g2p.ts';
import { PHONEMES, type VisemeId } from './visemes.ts';

export interface TimedWord {
  start: number;
  end: number;
  frames: { viseme: VisemeId; ms: number }[];
  /** Length of the spoken part and of the silence after it. */
  ms: number;
  pause: number;
}

export function buildTimeline(text: string): TimedWord[] {
  return textToWords(text).map(({ start, end, phonemes, pause }) => {
    const frames = phonemes.flatMap(p => PHONEMES[p] ?? []);
    return { start, end, frames, ms: frames.reduce((sum, f) => sum + f.ms, 0), pause };
  });
}

/**
 * Voices report when each word starts, but not its length. Word events re-anchor the timeline and teach
 * it the voice's pace. Voices that send no events play through on the estimate alone.
 */
export class LipSync {
  private words: TimedWord[];
  private word = 0;
  private anchor = 0;
  private stretch: number;
  private sawBoundary = false;

  constructor(words: TimedWord[], rate = 1) {
    this.words = words;
    this.stretch = 1 / rate;
  }

  /** `lead` is the silence to expect before the first word; voices announce their start early. */
  start(now: number, lead = 0): void {
    this.word = 0;
    this.anchor = now + lead;
  }

  /** A voice event: the word at this text position is starting now. */
  boundary(charIndex: number, now: number): void {
    let next = this.words.findIndex(w => charIndex < w.end);
    if (next < 0) next = this.words.length - 1;
    if (next < 0 || (this.sawBoundary && next < this.word)) return;
    if (this.sawBoundary && next > this.word) {
      const expected = this.words.slice(this.word, next).reduce((sum, w) => sum + w.ms + w.pause, 0);
      if (expected > 0) {
        const observed = Math.min(2.2, Math.max(0.35, (now - this.anchor) / expected));
        this.stretch += (observed - this.stretch) * 0.3;
      }
    }
    // Some voices split one of our words (such as "25") into several events; keep the first.
    if (this.sawBoundary && next === this.word) return;
    this.sawBoundary = true;
    this.word = next;
    this.anchor = now;
  }

  visemeAt(now: number): VisemeId {
    if (now < this.anchor) return 'sil';
    let t = (now - this.anchor) / this.stretch;
    for (let i = this.word; i < this.words.length; i++) {
      const word = this.words[i];
      for (const frame of word.frames) {
        if (t < frame.ms) return frame.viseme;
        t -= frame.ms;
      }
      if (this.sawBoundary || t < word.pause) return 'sil'; // wait for the next word event
      t -= word.pause;
    }
    return 'sil';
  }

  /** Estimated total length in milliseconds. */
  duration(): number {
    return this.words.reduce((sum, w) => sum + w.ms + w.pause, 0) * this.stretch;
  }
}
