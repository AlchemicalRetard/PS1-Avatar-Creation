// Geometry for lining a photo up with the face blueprint. No DOM, so it can be unit tested.
import type { FaceProfile, Point, SideProfile } from './types.ts';

/** The stage is a fixed logical canvas; the blueprint's face box sits in the middle at true proportions. */
export const STAGE = { width: 600, height: 800 };
const FACE_BOX_HEIGHT = 540;

export interface Rect { x: number; y: number; width: number; height: number }

export function faceBox(profile: FaceProfile | SideProfile): Rect {
  const height = FACE_BOX_HEIGHT, width = height * profile.surfaceAspect;
  return { x: (STAGE.width - width) / 2, y: (STAGE.height - height) / 2, width, height };
}

export const uvToStage = ([u, v]: Point, box: Rect): Point => [box.x + u * box.width, box.y + v * box.height];

/** Where the photo sits on the stage. Offsets move its center away from the stage center. */
export interface Placement {
  x: number;
  y: number;
  scale: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
  /** Extra horizontal stretch, for faces narrower or wider than the blueprint. */
  stretch: number;
}

/** Canvas-style matrix [a b c d e f]: photo pixels to stage units. */
export type Matrix = [number, number, number, number, number, number];

/** Fills the stage with the photo, like object-fit: cover. The live camera uses the same fit. */
export function coverPlacement(photoWidth: number, photoHeight: number): Placement {
  return { x: 0, y: 0, scale: Math.max(STAGE.width / photoWidth, STAGE.height / photoHeight), rotation: 0, stretch: 1 };
}

export function placementMatrix(p: Placement, photoWidth: number, photoHeight: number): Matrix {
  const angle = p.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  // Rotate first, then stretch along the screen's horizontal, so the slider always widens the upright face.
  const a = p.scale * cos * p.stretch, b = p.scale * sin, c = -p.scale * sin * p.stretch, d = p.scale * cos;
  const cx = STAGE.width / 2 + p.x, cy = STAGE.height / 2 + p.y;
  return [a, b, c, d, cx - a * photoWidth / 2 - c * photoHeight / 2, cy - b * photoWidth / 2 - d * photoHeight / 2];
}

export const apply = ([a, b, c, d, e, f]: Matrix, [x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f];

/** Stage units to pixels of a square texture covering the face box. */
export function textureMatrix(box: Rect, size: number): Matrix {
  return [size / box.width, 0, 0, size / box.height, -box.x * size / box.width, -box.y * size / box.height];
}

/** outer ∘ inner */
export function compose(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

export const LIMITS = { rotation: 45, stretch: [0.75, 1.3] as const, zoom: [0.5, 6] as const };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampPlacement(p: Placement, coverScale: number): Placement {
  return {
    x: clamp(p.x, -STAGE.width * 2, STAGE.width * 2),
    y: clamp(p.y, -STAGE.height * 2, STAGE.height * 2),
    scale: clamp(p.scale, coverScale * LIMITS.zoom[0], coverScale * LIMITS.zoom[1]),
    rotation: clamp(p.rotation, -LIMITS.rotation, LIMITS.rotation),
    stretch: clamp(p.stretch, ...LIMITS.stretch),
  };
}

/** Scales and rotates about a stage point, so the spot under the cursor or fingers stays put. */
export function zoomAbout(p: Placement, [px, py]: Point, factor: number, turn = 0): Placement {
  const angle = turn * Math.PI / 180, cos = Math.cos(angle) * factor, sin = Math.sin(angle) * factor;
  // Work in unstretched space, where the transform is a plain similarity.
  const dx = (p.x - (px - STAGE.width / 2)) / p.stretch, dy = p.y - (py - STAGE.height / 2);
  return {
    ...p,
    x: px - STAGE.width / 2 + (dx * cos - dy * sin) * p.stretch,
    y: py - STAGE.height / 2 + dx * sin + dy * cos,
    scale: p.scale * factor,
    rotation: p.rotation + turn,
  };
}
