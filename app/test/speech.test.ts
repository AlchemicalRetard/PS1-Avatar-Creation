import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasUnsupportedLetters, numberWords, textToWords, wordToPhonemes } from '../src/g2p.ts';
import { LipSync, buildTimeline } from '../src/lipsync.ts';
import { blendMouth, findShift, mouthMask } from '../src/mouth.ts';
import { PHONEMES, VISEMES, VISEME_IDS, resolveViseme, type VisemeId } from '../src/visemes.ts';
import type { FaceProfile, Pixels } from '../src/types.ts';

const profile: FaceProfile = JSON.parse(fs.readFileSync(new URL('../../assets/ps1_face_profile.json', import.meta.url), 'utf8'));
const say = (word: string) => wordToPhonemes(word).join(' ');

test('there are 7 visemes, each reachable from some phoneme', () => {
  assert.deepEqual(VISEMES.map(v => v.id), [...VISEME_IDS]);
  assert.equal(VISEME_IDS.length, 7);
  const used = new Set(Object.values(PHONEMES).flat().map(f => f.viseme));
  for (const id of VISEME_IDS) if (id !== 'sil') assert.ok(used.has(id), `${id} is never used`);
});

test('spelling rules pronounce common patterns', () => {
  const expected: Record<string, string> = {
    map: 'M AE P', bob: 'B AA B', think: 'TH IH NG K', church: 'CH ER CH', phone: 'F OW N', make: 'M EY K', time: 'T AY M',
    night: 'N AY T', rain: 'R EY N', boat: 'B OW T', moon: 'M UW N', sheep: 'SH IY P', jump: 'JH AH M P', quick: 'K W IH K',
    nation: 'N EY SH AX N', walked: 'W AO K T', wanted: 'W AE N T IH D', singing: 'S IH NG IH NG', table: 'T AE B AX L', happy: 'HH AE P IY',
    judge: 'JH AH JH', write: 'R AY T', cry: 'K R AY', box: 'B AA K S', lamb: 'L AE M', red: 'R EH D', shed: 'SH EH D',
  };
  const wrong = Object.entries(expected).filter(([word, phonemes]) => say(word) !== phonemes).map(([w, p]) => `${w}: ${say(w)} (wanted ${p})`);
  assert.ok(wrong.length <= 3, wrong.join('\n'));
});

test('irregular words and contractions', () => {
  assert.equal(say('the'), 'TH AX');
  assert.equal(say('hello'), 'HH AX L OW');
  assert.equal(say("you're"), 'Y UW ER');
  assert.equal(say('you’re'), 'Y UW ER');
  assert.equal(say("isn't"), 'IH Z N T');
  assert.equal(say('TV'), 'T IY V IY');
  assert.equal(say('naïve'), say('naive'));
  assert.equal(textToWords('Café').length, 1);
  assert.equal(say('constructor').length > 0, true);
});

test('every letter sequence yields known phonemes', () => {
  const words = 'abcdefghijklmnopqrstuvwxyz'.split('').flatMap(a => 'abcdefghijklmnopqrstuvwxyz'.split('').map(b => `${a}${b}a`));
  for (const word of words) for (const p of wordToPhonemes(word)) assert.ok(p in PHONEMES, `${word} gave ${p}`);
});

test('every irregular entry uses known phonemes', () => {
  const source = fs.readFileSync(new URL('../src/g2p.ts', import.meta.url), 'utf8').match(/fromEntries\(`([^`]+)`/)![1];
  for (const entry of source.trim().split(/[|\n]/)) {
    const [word, ...phonemes] = entry.split(' ');
    assert.ok(phonemes.length && phonemes.every(p => p in PHONEMES), `bad entry: ${word}`);
  }
});

test('numbers, symbols, pauses and positions', () => {
  assert.equal(numberWords(1234567).join(' '), 'one million two hundred thirty four thousand five hundred sixty seven');
  const words = textToWords('Hi, I am 25. 50% off!');
  assert.deepEqual(words.map(w => w.pause), [200, 0, 0, 420, 0, 0, 420]);
  assert.deepEqual(words.map(w => 'Hi, I am 25. 50% off!'.slice(w.start, w.end)), ['Hi', 'I', 'am', '25', '50', '%', 'off']);
  assert.equal(words[3].phonemes.join(' '), [...wordToPhonemes('twenty'), ...wordToPhonemes('five')].join(' '));
  assert.deepEqual(textToWords(' ?! '), []);
});

test('non-Latin text is reported, accents are not', () => {
  assert.equal(hasUnsupportedLetters('नमस्ते'), true);
  assert.equal(hasUnsupportedLetters('Café, hello! 12'), false);
});

test('missing shapes fall back to the closest photographed one', () => {
  const only = (...ids: VisemeId[]) => new Set<VisemeId>(['sil', ...ids]);
  assert.equal(resolveViseme('aa', only('aa', 'E')), 'aa');
  assert.equal(resolveViseme('aa', only('E')), 'E');
  assert.equal(resolveViseme('O', only('U')), 'U');
  assert.equal(resolveViseme('FF', only('aa')), 'sil');
  for (const p of ['P', 'B', 'M']) assert.deepEqual(PHONEMES[p].map(f => f.viseme), ['sil'], 'lips close');
  for (const id of VISEME_IDS) assert.equal(resolveViseme(id, only()), 'sil');
});

test('without word events the timeline plays through to the end', () => {
  const words = buildTimeline('fat. bob'), sync = new LipSync(words);
  sync.start(1000);
  assert.equal(sync.visemeAt(1000), 'FF');
  assert.equal(sync.visemeAt(1000 + 100), 'aa');
  assert.equal(sync.visemeAt(1000 + words[0].ms + 100), 'sil', 'pause after the full stop');
  assert.equal(sync.visemeAt(1000 + words[0].ms + words[0].pause + 100), 'aa');
  assert.equal(sync.visemeAt(1000 + 60000), 'sil');
});

test('the mouth rests until the first word, which can cut the wait short', () => {
  const sync = new LipSync(buildTimeline('fat'));
  sync.start(0, 200);
  assert.equal(sync.visemeAt(100), 'sil');
  assert.equal(sync.visemeAt(210), 'FF');
  sync.start(1000, 200);
  sync.boundary(0, 1100);
  assert.equal(sync.visemeAt(1101), 'FF');
});

test('speech rate scales the timeline', () => {
  const words = buildTimeline('fat');
  assert.ok(Math.abs(new LipSync(words, 2).duration() * 2 - new LipSync(words, 1).duration()) < 1e-9);
});

test('word events re-anchor, wait for the next word, and learn the pace', () => {
  const text = 'fat fat fat fat fat fat', words = buildTimeline(text), sync = new LipSync(words), slow = words[0].ms * 1.8;
  sync.start(0);
  sync.boundary(0, 100);
  assert.equal(sync.visemeAt(100), 'FF');
  assert.equal(sync.visemeAt(100 + words[0].ms + 5), 'sil', 'waits for the next event');
  words.forEach((w, i) => sync.boundary(w.start, 100 + i * slow));
  const last = 100 + 5 * slow;
  // After learning a slower voice, the word lasts noticeably longer than the estimate.
  assert.notEqual(sync.visemeAt(last + words[0].ms * 1.3), 'sil');
  assert.equal(sync.visemeAt(last + words[0].ms * 2.5), 'sil');
});

test('repeated and late word events do not restart or rewind a word', () => {
  const words = buildTimeline('25 fat'), sync = new LipSync(words);
  sync.start(0);
  sync.boundary(0, 0);
  const middle = sync.visemeAt(200);
  sync.boundary(1, 190);
  assert.equal(sync.visemeAt(200), middle);
  sync.boundary(3, 900);
  sync.boundary(0, 910);
  assert.equal(sync.visemeAt(910), 'FF');
  new LipSync([]).boundary(0, 0); // no words: must not throw
});

// --- Mouth images -------------------------------------------------------------------------------
function face(shift: [number, number] = [0, 0], gain = 1, mouth = 20): Pixels {
  const size = 128, data = new Uint8ClampedArray(size * size * 4), L = profile.landmarksUv;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - shift[0] + 0.5) / size, v = (y - shift[1] + 0.5) / size;
      const near = ([a, b]: readonly number[], r: number) => Math.hypot(u - a, v - b) < r;
      let c = 150 + Math.sin(u * 9) * 10;
      if (near(L.eyeViewerLeft, 0.05) || near(L.eyeViewerRight, 0.05)) c = 40;
      if (near(L.noseTip, 0.03)) c = 110;
      if (near(L.mouth, 0.06)) c = mouth;
      data.set([c * gain, c * 0.8 * gain, c * 0.7 * gain, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}
const red = (p: Pixels, [u, v]: readonly number[]) => p.data[(Math.floor(v * 128) * 128 + Math.floor(u * 128)) * 4];

test('only the mouth region changes', () => {
  const mask = mouthMask(profile, 128), neutral = face(), out = blendMouth(neutral, face([0, 0], 1, 230), mask);
  assert.ok(red(out, profile.landmarksUv.mouth) > 200, 'mouth comes from the shape photo');
  for (const name of ['eyeViewerLeft', 'eyeViewerRight', 'noseTip', 'hairline'] as const) {
    assert.equal(red(out, profile.landmarksUv[name]), red(neutral, profile.landmarksUv[name]), name);
  }
  for (let y = 0; y < 85; y++) for (let x = 0; x < 128; x++) assert.equal(mask[y * 128 + x], 0);
});

test('a darker photo is color matched, so skin around the mouth does not flash', () => {
  const mask = mouthMask(profile, 128), neutral = face(), out = blendMouth(neutral, face([0, 0], 0.75), mask);
  const { mouth } = profile.landmarksUv, skin = [mouth[0] + 0.15, mouth[1] + 0.03];
  assert.ok(Math.abs(red(out, skin) - red(neutral, skin)) < 8, `${red(out, skin)} vs ${red(neutral, skin)}`);
});

test('uncovered areas of a mouth photo keep the neutral face', () => {
  const mask = mouthMask(profile, 128), neutral = face(), empty = face();
  for (let i = 3; i < empty.data.length; i += 4) empty.data[i] = 0;
  assert.deepEqual(blendMouth(neutral, empty, mask).data, neutral.data);
});

test('head movement between shots is found, even with a different mouth and exposure', () => {
  for (const [dx, dy] of [[0, 0], [5, -3], [-8, 6]] as [number, number][]) {
    const found = findShift(face(), face([dx, dy], 0.7, 220), profile);
    assert.ok(found, 'no match found');
    assert.deepEqual(found.map(v => v + 0), [-dx + 0, -dy + 0]);
  }
});

test('an unrelated photo is not shifted', () => {
  const noise = face();
  for (let i = 0; i < noise.data.length; i += 4) noise.data.fill((i * 7919) % 251, i, i + 3);
  assert.equal(findShift(face(), noise, profile), null);
});
