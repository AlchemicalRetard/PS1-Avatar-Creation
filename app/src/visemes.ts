// A reduced set of 7 mouth shapes, and which one each phoneme needs. Sounds that look alike on a
// low-resolution face share a shape; P, B and M use the neutral face, whose lips are closed.

export const VISEME_IDS = ['sil', 'FF', 'aa', 'E', 'I', 'O', 'U'] as const;
export type VisemeId = (typeof VISEME_IDS)[number];

/** A simple mouth drawing: lip width and height, how far it is open (0 to 1), teeth and tongue. */
export interface MouthShape { width: number; height: number; open: number; teeth?: 'top' | 'both'; tongue?: boolean }

export interface Viseme {
  id: VisemeId;
  sounds: string;
  say: string;
  how: string;
  mouth: MouthShape;
  /** Closest shapes to use when this one has not been photographed. */
  fallback: VisemeId[];
}

export const VISEMES: Viseme[] = [
  { id: 'sil', sounds: 'Rest P B M', say: 'nothing', how: 'Relax your face with your lips closed.', mouth: { width: 0.7, height: 0.26, open: 0 }, fallback: [] },
  { id: 'FF', sounds: 'F V', say: '“fff” as in five', how: 'Rest your top teeth on your lower lip.', mouth: { width: 0.66, height: 0.3, open: 0.3, teeth: 'top' }, fallback: ['sil'] },
  { id: 'aa', sounds: 'AH', say: '“ah” as in father', how: 'Drop your jaw and open wide.', mouth: { width: 0.68, height: 0.82, open: 0.8, teeth: 'top', tongue: true }, fallback: ['E', 'O', 'I'] },
  { id: 'E', sounds: 'EH T D K N L', say: '“eh” as in bed', how: 'Open a little, lips relaxed.', mouth: { width: 0.7, height: 0.44, open: 0.55, teeth: 'top' }, fallback: ['I', 'aa'] },
  { id: 'I', sounds: 'EE S Z', say: '“ee” as in see', how: 'Teeth close together, corners pulled back like a small smile.', mouth: { width: 0.86, height: 0.38, open: 0.55, teeth: 'both' }, fallback: ['E'] },
  { id: 'O', sounds: 'OH', say: '“oh” as in go', how: 'Make a round, open O.', mouth: { width: 0.48, height: 0.62, open: 0.7 }, fallback: ['U', 'aa'] },
  { id: 'U', sounds: 'OO W R SH', say: '“oo” as in you', how: 'Pucker into a small, tight circle.', mouth: { width: 0.36, height: 0.42, open: 0.45 }, fallback: ['O'] },
];

const BY_ID = Object.fromEntries(VISEMES.map(v => [v.id, v])) as Record<VisemeId, Viseme>;
export const viseme = (id: VisemeId): Viseme => BY_ID[id];

/** The wanted shape if it was photographed, otherwise the closest one that was. */
export function resolveViseme(wanted: VisemeId, available: ReadonlySet<VisemeId>): VisemeId {
  if (available.has(wanted)) return wanted;
  return BY_ID[wanted].fallback.find(id => available.has(id)) ?? 'sil';
}

// Phoneme → mouth shapes and typical length in milliseconds. Diphthongs move between two shapes.
const T = (ms: number, ...ids: VisemeId[]) => ids.map(id => ({ viseme: id, ms: ms / ids.length }));
export const PHONEMES: Record<string, { viseme: VisemeId; ms: number }[]> = {
  AA: T(120, 'aa'), AE: T(120, 'aa'), AH: T(95, 'aa'), AX: T(65, 'E'), AO: T(125, 'O'),
  AW: T(165, 'aa', 'U'), AY: T(160, 'aa', 'I'), EH: T(105, 'E'), ER: T(120, 'U'), EY: T(145, 'E', 'I'),
  IH: T(85, 'I'), IY: T(120, 'I'), OW: T(150, 'O', 'U'), OY: T(165, 'O', 'I'), UH: T(90, 'U'), UW: T(125, 'U'),
  P: T(80, 'sil'), B: T(75, 'sil'), M: T(80, 'sil'), F: T(95, 'FF'), V: T(75, 'FF'), TH: T(85, 'E'),
  T: T(65, 'E'), D: T(65, 'E'), K: T(75, 'E'), G: T(70, 'E'), NG: T(80, 'E'),
  CH: T(105, 'U'), JH: T(95, 'U'), SH: T(105, 'U'), ZH: T(90, 'U'), S: T(95, 'I'), Z: T(85, 'I'),
  N: T(70, 'E'), L: T(70, 'E'), R: T(70, 'U'), W: T(70, 'U'), Y: T(60, 'I'), HH: [],
};
