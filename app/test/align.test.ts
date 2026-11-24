import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSync, findSpeech, loudness, placeWords } from '../src/align.ts';
import { buildTimeline } from '../src/lipsync.ts';

const RATE = 16000;
/** Tone where spoken, faint noise elsewhere. Spans in seconds. */
function audio(seconds: number, spans: [number, number][], level = 0.3): Float32Array {
  return Float32Array.from({ length: seconds * RATE }, (_, i) => {
    const t = i / RATE, on = spans.some(([a, b]) => t >= a && t < b);
    return (on ? Math.sin(t * 900) * level : 0) + Math.sin(i * 12.9898) * 0.0008;
  });
}
const near = (a: number, b: number, eps = 0.05) => assert.ok(Math.abs(a - b) < eps, `${a} is not near ${b}`);

test('finds speech and ignores the noise floor, at any volume', () => {
  for (const level of [0.03, 0.3, 0.9]) {
    const spans = findSpeech(loudness(audio(3, [[0.4, 1], [1.5, 2.6]], level), RATE), 0.13);
    assert.equal(spans.length, 2);
    near(spans[0].start, 0.4); near(spans[0].end, 1); near(spans[1].start, 1.5); near(spans[1].end, 2.6);
  }
});

test('short closures inside words are not pauses', () => {
  assert.equal(findSpeech(loudness(audio(2, [[0.2, 0.6], [0.66, 1.4]]), RATE), 0.13).length, 1);
});

test('silent or empty audio gives no speech and a resting mouth', () => {
  for (const samples of [new Float32Array(0), new Float32Array(RATE)]) {
    assert.deepEqual(findSpeech(loudness(samples, RATE), 0.13), []);
    assert.equal(new AudioSync(buildTimeline('hello there'), samples, RATE).visemeAt(0.5), 'sil');
  }
});

test('words start with the voice and end with it, however slow it is', () => {
  for (const [a, b] of [[0.3, 1.1], [0.5, 4]] as [number, number][]) {
    const placed = placeWords(buildTimeline('good evening my friend'), [{ start: a, end: b }]);
    assert.equal(placed.length, 4);
    near(placed[0].at, a, 1e-9);
    near(placed[3].at + placed[3].seconds, b, 1e-9);
    for (let i = 1; i < 4; i++) near(placed[i].at, placed[i - 1].at + placed[i - 1].seconds, 1e-9);
  }
});

test('a pause in the audio is matched to the comma, not to the middle of a phrase', () => {
  // The first phrase is spoken much faster than expected.
  const placed = placeWords(buildTimeline('hello my good friend, welcome'), [{ start: 0, end: 0.7 }, { start: 1.3, end: 2.6 }]);
  near(placed[3].at + placed[3].seconds, 0.7, 1e-9);
  near(placed[4].at, 1.3, 1e-9);
  near(placed[4].at + placed[4].seconds, 2.6, 1e-9);
});

test('extra silences do not shift the sentence break', () => {
  const placed = placeWords(buildTimeline('one two three. four five six'), [{ start: 0, end: 0.4 }, { start: 0.55, end: 1 }, { start: 1.6, end: 2.6 }]);
  near(placed[3].at, 1.6, 1e-9);
});

test('a comma the voice runs through is simply spoken through', () => {
  const placed = placeWords(buildTimeline('yes, of course. thank you'), [{ start: 0, end: 1 }, { start: 1.5, end: 2 }]);
  assert.equal(placed.length, 5);
  near(placed[3].at, 1.5, 1e-9);
  placed.forEach((w, i) => i && assert.ok(w.at >= placed[i - 1].at));
});

test('more punctuation than silence, and more silence than punctuation, stay in order', () => {
  for (const [text, spans] of [
    ['a, b, c, d, e.', [[0, 1]]],
    ['just one phrase here', [[0, 0.5], [0.8, 1.2], [1.6, 2], [2.5, 3]]],
  ] as [string, [number, number][]][]) {
    const placed = placeWords(buildTimeline(text), spans.map(([start, end]) => ({ start, end })));
    placed.forEach((w, i) => assert.ok(w.seconds >= 0 && (!i || w.at >= placed[i - 1].at)));
  }
});

test('the mouth moves during speech and rests before, between and after', () => {
  const sync = new AudioSync(buildTimeline('father. father'), audio(3, [[0.5, 1.1], [1.8, 2.4]]), RATE);
  for (const t of [0.2, 1.4, 2.8]) assert.equal(sync.visemeAt(t), 'sil', `at ${t}`);
  assert.equal(sync.visemeAt(0.53), 'FF');
  assert.equal(sync.visemeAt(1.83), 'FF');
  assert.ok(new Set(Array.from({ length: 60 }, (_, i) => sync.visemeAt(0.5 + i * 0.01))).size >= 3);
});
