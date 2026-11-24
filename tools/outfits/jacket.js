// Default outfit: glossy black croc-embossed leather jacket worn open over a black tee, dark trousers, boots.
// The collar is a small skinned piece; everything else is painted.
// Colors are chosen from bind-pose positions. Landmarks: boots < 0.42, belt 3.14-3.26,
// shoulders 4.8, neck to 5.1, crown 5.85. Arms leave the torso at |x| 0.62; wrists at |x| 1.82.
const { FACE_PROFILE } = require('../lib/face_profile');

const P = {
  skin: [196, 135, 104], skinLight: [213, 153, 117], skinShade: [160, 99, 79],
  hair: [60, 31, 89], hairLight: [96, 54, 127], hairShade: [39, 23, 62],
  leather: [34, 35, 40], leatherLight: [48, 49, 56], leatherShade: [22, 22, 27], leatherEdge: [104, 107, 118], glint: [186, 190, 202],
  groove: [9, 9, 12], seam: [15, 15, 18], zip: [150, 152, 158], zipDark: [66, 67, 72],
  tee: [24, 24, 28], teeFold: [33, 33, 38], teeNeck: [14, 14, 17],
  pants: [26, 27, 33], pantsLight: [38, 39, 47], pantsShade: [18, 18, 23],
  boots: [30, 29, 32], bootLight: [52, 51, 56], bootSole: [16, 15, 17],
  eye: [38, 28, 34], eyeWhite: [231, 216, 188], brow: [62, 34, 44],
  lip: [160, 84, 76], mouth: [104, 48, 50],
};

const mod = (v, n) => ((v % n) + n) % n;

/**
 * Glossy crocodile-embossed leather. (u, v) run across and along the hide. Staggered scales, each with a
 * dark groove, a lit upper edge and, now and then, a bright glint; `lit` (0 to 1) is how much light it faces.
 */
function leather(u, v, lit) {
  const row = Math.floor(v / 0.085), wide = 0.1 + 0.03 * Math.sin(row * 2.3), across = u + (mod(row, 2) ? wide / 2 : 0);
  const column = Math.floor(across / wide), du = mod(across, wide) / wide, dv = mod(v, 0.085) / 0.085;
  if (du < 0.17 || dv < 0.2) return P.groove;
  const chance = mod(Math.sin(column * 12.99 + row * 78.23) * 43758.5, 1);
  if (dv > 0.68 && chance < 0.2 + lit * 0.45) return chance < 0.05 + lit * 0.16 ? P.glint : P.leatherEdge;
  return lit > 0.55 ? P.leatherLight : lit < 0.2 ? P.leatherShade : P.leather;
}

function bodyColor([x, y, z], [nx, ny, nz]) {
  const ax = Math.abs(x), lit = Math.max(0, Math.min(1, 0.3 + nz * 0.35 + ny * 0.35));
  const skin = nz > 0.35 ? P.skinLight : nz < -0.35 ? P.skinShade : P.skin;

  if (ax > 0.62 && y > 3.0) { // arms
    if (ax > 1.82) return skin;
    if (ax > 1.76) return P.seam;
    // Sleeves run down and outward, so measure along that direction to keep the scales square.
    const along = ax * 0.79 - y * 0.61, around = Math.abs(nz) > 0.6 ? ax * 0.61 + y * 0.79 : z;
    return leather(around, along, lit);
  }
  if (y < 0.06) return P.bootSole;
  if (y < 0.42) return nz > 0.4 ? P.bootLight : P.boots;
  if (y < 3.14) return nz > 0.35 ? P.pantsLight : nz < -0.35 ? P.pantsShade : P.pants;
  if (y < 3.2) return P.seam; // jacket hem
  if (y > 5.1 && ax < 0.3) return headColor(y, z, nz);
  if (y > 4.84 && y < 5.02 && z < 0.06) return P.seam; // under the collar
  if (y > 4.84 && ax < 0.32) return nz < -0.3 ? P.skinShade : P.skin; // neck

  if (nz > 0.1 && z > 0) { // worn open over a black tee
    const opening = 0.15 + Math.max(0, y - 3.4) * 0.09;
    if (Math.hypot(x, (y - 4.86) * 0.9) < 0.17) return P.skin;
    if (Math.hypot(x, (y - 4.86) * 0.9) < 0.2 && ax < opening) return P.teeNeck;
    if (ax < opening) return ax < 0.05 && y < 4.3 ? P.teeFold : P.tee;
    if (ax < opening + 0.022) return mod(y, 0.06) < 0.03 ? P.zip : P.zipDark;
    if (ax < opening + 0.05) return P.seam;
  }
  return leather(Math.abs(nx) > Math.abs(nz) ? z : x, y, lit);
}

// A folded collar standing around the neck, open at the front, following the shoulders.
const COLLAR_STEPS = 10;
function collarPiece() {
  const vertices = [], triangles = [];
  const rows = [ // y, half width, front z, back z
    [4.82, 0.37, 0.29, -0.36],
    [5.07, 0.345, 0.28, -0.325],
    [4.95, 0.5, 0.37, -0.385],
  ];
  rows.forEach(([y, w, front, back], r) => {
    for (let c = 0; c <= COLLAR_STEPS; c++) {
      const t = c / COLLAR_STEPS, angle = (32 + 296 * t) * Math.PI / 180;
      // The flap drops lower at the back and front than over the sloping shoulders.
      const drop = r === 2 ? Math.abs(Math.cos(angle)) * (Math.cos(angle) < 0 ? 0.16 : 0.1) : 0;
      let position = [w * Math.sin(angle), y - drop, (front + back) / 2 + (front - back) / 2 * Math.cos(angle)];
      if (r === 2 && (c === 0 || c === COLLAR_STEPS)) position = [c === 0 ? 0.3 : -0.3, 4.56, 0.42]; // collar points
      const ahead = Math.max(0, Math.min(1, (position[2] + 0.2) / 0.35)), left = Math.max(0, Math.min(1, (position[0] + 0.2) / 0.4));
      vertices.push({
        position,
        uv: [0.02 + 0.96 * t, 0.02 + 0.96 * r / 2],
        weights: [['spine.003_04', 1 - ahead * 0.9], ['shoulder.L_09', ahead * 0.9 * left], ['shoulder.R_017', ahead * 0.9 * (1 - left)]],
      });
    }
  });
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < COLLAR_STEPS; c++) {
      const p = r * (COLLAR_STEPS + 1) + c, q = p + 1, d = p + COLLAR_STEPS + 1, e = d + 1;
      // The band faces outward; the flap folds over it and faces up and out.
      triangles.push(...(r === 0 ? [[p, q, d], [q, e, d]] : [[p, d, q], [q, d, e]].map(t => t.reverse())));
    }
  }
  return {
    name: 'Jacket_Collar', textureSize: 64, vertices, triangles,
    color: ([x, y, z], [, ny, nz]) => leather(Math.abs(x) > 0.25 ? z : x, y * 0.9 + Math.hypot(x, z) * 0.4, Math.max(0, Math.min(1, 0.45 + nz * 0.3 + ny * 0.3))),
  };
}

// Sides, back and top of the head. The front is a separate material.
function headColor(y, z, nz) {
  const scalp = y > 5.68 || (z < 0.12 && y > 5.4) || (z < -0.02 && y > 5.2);
  if (scalp) return nz < -0.35 ? P.hairShade : y > 5.79 ? P.hairLight : P.hair;
  return y < 5.2 || nz < -0.2 ? P.skinShade : P.skin;
}

// Painted in mesh units on the plane the face panel is projected from, so it shows true proportions.
function faceColor(x, y) {
  const ax = Math.abs(x), eye = FACE_PROFILE.landmarks.eyeViewerRight;
  const dx = Math.abs(ax - eye[0]), dy = y - eye[1];
  if (y > 5.68 - (ax > 0.15 ? 0.05 : 0)) return y > 5.79 ? P.hairLight : P.hair;
  if (dx < 0.05 && dy > 0.04 && dy < 0.065) return P.brow;
  if (dx < 0.016 && Math.abs(dy) < 0.019) return P.eye;
  if (dx < 0.044 && Math.abs(dy) < 0.019) return P.eyeWhite;
  if (dx < 0.046 && dy >= 0.019 && dy < 0.03) return P.skinShade;
  if (ax < 0.034 && y > 5.315 && y < 5.332) return P.skinShade;
  if (ax < 0.016 && y >= 5.332 && y < 5.44) return P.skinLight;
  if (ax < 0.066 && y > 5.267 && y < 5.277) return P.mouth;
  if (ax < 0.05 && y > 5.248 && y < 5.288) return P.lip;
  if (y < 5.18) return P.skinShade;
  return P.skin;
}

module.exports = {
  id: 'jacket',
  label: 'Leather jacket',
  files: {
    glb: 'ps1_character_textured.glb',
    body: 'ps1_character_texture.png',
    face: 'ps1_face_placeholder.png',
    Jacket_Collar: 'ps1_character_collar.png',
    skinMask: 'ps1_character_skin_mask.png',
    hair: 'ps1_face_hair.png',
    sideLeft: 'ps1_character_side_left.png',
    sideRight: 'ps1_character_side_right.png',
    sideMaskLeft: 'ps1_character_side_mask_left.png',
    sideMaskRight: 'ps1_character_side_mask_right.png',
  },
  // Palette entries the app may recolor (skin) or keep on top of a pasted photo (hair).
  baseSkin: P.skin,
  baseHair: P.hair,
  skinColors: [P.skin, P.skinLight, P.skinShade],
  hairColors: [P.hair, P.hairLight, P.hairShade],
  bodyColor,
  faceColor,
  pieces: [collarPiece()],
};
