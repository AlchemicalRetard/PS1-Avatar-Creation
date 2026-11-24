export type Point = [number, number];
export type Rgb = [number, number, number];

/** Row-major RGBA pixels; ImageData satisfies this. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** assets/ps1_face_profile.json */
export interface FaceProfile {
  id: string;
  textureSize: number;
  materialName: string;
  surfaceAspect: number;
  landmarksUv: Record<'eyeViewerLeft' | 'eyeViewerRight' | 'noseTip' | 'mouth' | 'chin' | 'hairline', Point>;
  /** Silhouette of the avatar's face panel. */
  outlineUv: Point[];
  /** Human face shape that photos are masked to; lies inside the outline. */
  ovalUv: Point[];
}

/** assets/ps1_side_profile.json: the viewer's left side of the head, nose on the right. */
export interface SideProfile {
  id: string;
  textureSize: number;
  materialNames: { left: string; right: string };
  surfaceAspect: number;
  landmarksUv: Record<'eye' | 'ear' | 'noseTip' | 'mouth' | 'chin' | 'hairline', Point>;
  silhouetteUv: Point[];
  ovalUv: Point[];
  outlineUv: Point[];
}

/** One entry of assets/ps1_outfits.json */
export interface Outfit {
  id: string;
  label: string;
  files: Record<'glb' | 'body' | 'face' | 'skinMask' | 'hair' | 'sideLeft' | 'sideRight' | 'sideMaskLeft' | 'sideMaskRight', string>;
  baseSkin: Rgb;
  baseHair: Rgb;
}
