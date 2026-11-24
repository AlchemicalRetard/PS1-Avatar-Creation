// UV profile for the face panel of the rigged base head.
// The panel is projected straight from the front (+Z) onto a square texture, so there is no
// midline seam: u grows with mesh +X (viewer's right), v grows downward from the forehead.
const FACE_PROFILE = {
  id: 'ps1_base_head_v1',
  textureSize: 128,
  bounds: { xMin: -0.23, xMax: 0.23, yMin: 5.14, yMax: 5.84 }, // bind-pose mesh units
  // Where facial landmarks should land, in bind-pose mesh units (x, y). Phase 2 aligns photos to these.
  landmarks: {
    eyeViewerLeft: [-0.085, 5.465],
    eyeViewerRight: [0.085, 5.465],
    noseTip: [0, 5.335],
    mouth: [0, 5.272], // typical proportions: 63% of the way from eyes to chin
    chin: [0, 5.16],
    hairline: [0, 5.68],
  },
};

// Typical human face shape in UV, as [v, half width]. The avatar's jaw is boxier than a real one, so
// photos are masked to this oval; otherwise the background would show at the jaw corners.
const OVAL = [[0.05, 0.34], [0.12, 0.41], [0.28, 0.452], [0.45, 0.46], [0.6, 0.45], [0.72, 0.415], [0.81, 0.35], [0.89, 0.255], [0.95, 0.145], [0.975, 0.05]];

function faceUv([x, y], { bounds: b } = FACE_PROFILE) {
  return [(x - b.xMin) / (b.xMax - b.xMin), (b.yMax - y) / (b.yMax - b.yMin)];
}

// The profile as data for the browser app: landmarks converted to UV, plus texture metadata.
function exportProfile(profile = FACE_PROFILE) {
  const landmarksUv = Object.fromEntries(Object.entries(profile.landmarks).map(([name, p]) =>
    [name, faceUv(p, profile).map(v => Number(v.toFixed(4)))]));
  const { xMin, xMax, yMin, yMax } = profile.bounds;
  return {
    id: profile.id,
    textureSize: profile.textureSize,
    materialName: 'Face_Photo',
    uvOrigin: 'top-left',
    // Width divided by height of the area the square texture covers; use it to undo the stretch.
    surfaceAspect: Number(((xMax - xMin) / (yMax - yMin)).toFixed(4)),
    landmarksUv,
    ovalUv: [...OVAL.map(([v, w]) => [Number((0.5 + w).toFixed(4)), v]), ...OVAL.toReversed().map(([v, w]) => [Number((0.5 - w).toFixed(4)), v])],
  };
}

// Side panels: the head projected from the side onto the same height range as the face, so a row of
// the side texture meets the same row of the face texture. Coordinates are (z, y); the canonical view
// has the nose on the right (the viewer's left side of the avatar). The other side is its mirror image.
const SIDE_PROFILE = {
  id: 'ps1_base_head_side_v1',
  textureSize: 128,
  bounds: { zMin: -0.21, zMax: 0.49, yMin: FACE_PROFILE.bounds.yMin, yMax: FACE_PROFILE.bounds.yMax },
  landmarks: { eye: [0.385, 5.465], ear: [0.16, 5.42], noseTip: [0.473, 5.335], mouth: [0.445, 5.272], chin: [0.4, 5.16], hairline: [0.4, 5.68] },
  // Whole-head silhouette, for the guide.
  silhouette: [[0.4, 5.15], [0.445, 5.25], [0.473, 5.318], [0.462, 5.526], [0.344, 5.825], [-0.08, 5.838], [-0.19, 5.59], [-0.13, 5.42], [-0.12, 5.28], [-0.15, 5.17], [0.1, 5.15]],
  // Photos are used inside this shape. It runs past the panel at the front, where they must not fade, and
  // follows the curve of a real skull at the top; the avatar's flat-topped head is squarer.
  oval: [[0.7, 5.68], [0.4, 5.75], [0.28, 5.81], [0.16, 5.85], [0.06, 5.86], [-0.05, 5.8], [-0.11, 5.69], [-0.13, 5.56], [-0.09, 5.4], [-0.075, 5.28], [-0.05, 5.17], [0.12, 5.145], [0.7, 5.12]],
};

function sideUv([z, y], { bounds: b } = SIDE_PROFILE) {
  return [(z - b.zMin) / (b.zMax - b.zMin), (b.yMax - y) / (b.yMax - b.yMin)];
}

function exportSideProfile() {
  const uv = p => sideUv(p).map(v => Number(v.toFixed(4))), { bounds: b, landmarks } = SIDE_PROFILE;
  return {
    id: SIDE_PROFILE.id,
    textureSize: SIDE_PROFILE.textureSize,
    materialNames: { left: 'Side_ViewerLeft', right: 'Side_ViewerRight' },
    surfaceAspect: Number(((b.zMax - b.zMin) / (b.yMax - b.yMin)).toFixed(4)),
    landmarksUv: Object.fromEntries(Object.entries(landmarks).map(([k, p]) => [k, uv(p)])),
    silhouetteUv: SIDE_PROFILE.silhouette.map(uv),
    ovalUv: SIDE_PROFILE.oval.map(uv),
  };
}

module.exports = { FACE_PROFILE, faceUv, exportProfile, SIDE_PROFILE, sideUv, exportSideProfile };
