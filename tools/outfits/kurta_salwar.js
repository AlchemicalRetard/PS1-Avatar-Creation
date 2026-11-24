// Kurta salwar: knee-length teal kurta with gold block print and side slits, loose ivory salwar
// gathered at the ankle, juttis, bangles. Uses the same body UVs as every other outfit, plus a
// skinned skirt piece, because a tunic hem cannot be painted across two separate legs.
// Positions are bind-pose mesh units; see jacket.js for the landmarks.
const { FACE_PROFILE } = require('../lib/face_profile');

const P = {
  skin: [196, 135, 104], skinLight: [213, 153, 117], skinShade: [160, 99, 79],
  hair: [44, 28, 30], hairLight: [72, 46, 44], hairShade: [28, 18, 22], parting: [150, 96, 78],
  kurta: [20, 106, 108], kurtaLight: [34, 130, 126], kurtaShade: [13, 78, 84],
  gold: [222, 172, 74], goldShade: [172, 122, 48], maroon: [128, 28, 56], maroonShade: [92, 18, 42],
  salwar: [232, 218, 186], salwarFold: [204, 186, 150], salwarShade: [184, 166, 134],
  jutti: [128, 28, 56], sole: [60, 36, 32],
  eye: [40, 24, 24], eyeWhite: [236, 224, 204], kohl: [34, 20, 26], brow: [50, 30, 32],
  lip: [178, 62, 78], lipLight: [204, 92, 98], mouth: [112, 34, 50], blush: [208, 132, 108], bindi: [176, 24, 52],
};

const HEM = 1.72;
const mod = (v, n) => ((v % n) + n) % n;

// Offset rows of small gold diamonds.
function isMotif(a, y) {
  const row = Math.floor(y / 0.2), dx = mod(a + (mod(row, 2) ? 0.11 : 0), 0.22) - 0.11, dy = mod(y, 0.2) - 0.1;
  return Math.abs(dx) / 0.038 + Math.abs(dy) / 0.048 < 1;
}

// (a, b) are cloth coordinates: across and along the fabric.
function kurtaCloth(a, b, nz) {
  if (isMotif(a, b)) return nz < -0.35 ? P.goldShade : P.gold;
  return nz > 0.35 ? P.kurtaLight : nz < -0.35 ? P.kurtaShade : P.kurta;
}

function bodyColor([x, y, z], [nx, , nz]) {
  const ax = Math.abs(x);
  const skin = nz > 0.35 ? P.skinLight : nz < -0.35 ? P.skinShade : P.skin;

  if (ax > 0.62 && y > 3.0) { // three-quarter sleeves with a border, then forearm and bangles
    if (ax > 1.74 && ax < 1.78) return P.gold;
    if (ax > 1.79 && ax < 1.83) return P.maroon;
    if (ax > 1.60) return skin;
    if (ax > 1.55) return P.gold;
    if (ax > 1.48) return P.maroon;
    // Sleeves run down and outward, so measure along that direction to keep the print square.
    const along = ax * 0.79 - y * 0.61, around = Math.abs(nz) > 0.6 ? ax * 0.61 + y * 0.79 : z;
    return kurtaCloth(around, along, nz);
  }
  if (y < 0.05) return P.sole;
  if (y < 0.2) return z > 0.12 ? P.gold : P.jutti;
  if (y < 0.3) return skin;
  if (y < 0.37) return P.gold; // salwar ankle cuff
  if (y < 0.42) return P.maroon;
  if (y < 3.4) { // salwar with vertical gathers
    if (nz < -0.5) return P.salwarShade;
    return mod(ax + z * 0.6, 0.11) < 0.03 ? P.salwarFold : P.salwar;
  }
  if (y > 5.1 && ax < 0.3) return headColor(x, y, z, nz);
  if (y > 4.84 && ax < 0.32) return z < -0.14 && ax < 0.19 ? P.hair : nz < -0.3 ? P.skinShade : P.skin; // neck, hair on the nape
  if (nz < -0.3 && ax < 0.17 - Math.max(0, 4.84 - y) * 0.12 && y > 3.9) { // braid down the back
    if (y < 3.98) return P.gold;
    return mod(y + ax * 0.9, 0.13) < 0.04 ? P.hairLight : P.hairShade;
  }
  if (nz > 0.1 && z > 0) { // round neckline with an embroidered yoke and button placket
    const r = Math.hypot(x, (y - 4.84) * 0.85);
    if (r < 0.21) return P.skin;
    if (r < 0.26) return P.gold;
    if (r < 0.31) return P.maroon;
    if (ax < 0.085 && y > 4.02 && y < 4.7) {
      if (ax > 0.06) return P.gold;
      return ax < 0.022 && mod(y, 0.13) < 0.05 ? P.gold : P.maroon;
    }
    if (ax < 0.1 && y > 3.96 && y <= 4.02) return P.gold;
  }
  return kurtaCloth(Math.abs(nx) > Math.abs(nz) ? z : x, y, nz);
}

function headColor(x, y, z, nz) {
  const hair = y > 5.4 || z < 0.1 || (y > 5.3 && z < 0.18);
  if (hair && y > 5.14) {
    if (y > 5.79 && Math.abs(x) < 0.016) return P.parting;
    return nz < -0.35 ? P.hairShade : mod(y + z * 0.5, 0.15) < 0.035 ? P.hairLight : P.hair;
  }
  return z < -0.1 ? P.hair : y < 5.2 ? P.skinShade : P.skin;
}

function faceColor(x, y) {
  const ax = Math.abs(x), eye = FACE_PROFILE.landmarks.eyeViewerRight;
  const dx = ax - eye[0], dy = y - eye[1];
  // Center-parted hair sweeping down to the temples.
  if (y > 5.74 - ax * 0.55 || ax > 0.2 - Math.max(0, 5.5 - y) * 0.06 + (y < 5.3 ? 0.1 : 0)) {
    return ax < 0.01 && y > 5.74 ? P.parting : ax > 0.06 && ax < 0.075 ? P.hairLight : P.hair;
  }
  if (Math.hypot(x, y - 5.565) < 0.014) return P.bindi;
  const brow = 0.068 - Math.abs(dx - 0.01) * 0.28;
  if (Math.abs(dx) < 0.054 && dy > brow - 0.01 && dy < brow + 0.008) return P.brow;
  if (Math.abs(dx) < 0.05 && dy > 0.02 && dy < 0.034) return P.kohl;
  if (dx > 0.044 && dx < 0.066 && dy > 0.012 && dy < 0.04) return P.kohl;
  if (Math.abs(dx) < 0.019 && Math.abs(dy) < 0.021) return P.eye;
  if (Math.abs(dx) < 0.045 && Math.abs(dy) < 0.021) return P.eyeWhite;
  if (Math.abs(dx) < 0.04 && dy <= -0.021 && dy > -0.029) return P.kohl;
  if (x > 0.028 && x < 0.042 && y > 5.335 && y < 5.349) return P.gold; // nose stud
  if (ax < 0.028 && y > 5.318 && y < 5.332) return P.skinShade;
  if (ax < 0.012 && y >= 5.335 && y < 5.43) return P.skinLight;
  if (ax < 0.06 && Math.abs(y - 5.27) < 0.005) return P.mouth;
  if (ax < 0.052 - Math.max(0, y - 5.275) * 0.7 && y >= 5.275 && y < 5.295) return P.lip;
  if (ax < 0.048 - Math.max(0, 5.265 - y) * 0.7 && y > 5.238 && y <= 5.265) return P.lipLight;
  if (Math.hypot((ax - 0.14) / 1.3, y - 5.36) < 0.028) return P.blush;
  return y < 5.18 ? P.skinShade : P.skin;
}

// Loosen the legs into a salwar: widest at the knee and calf, gathered back in at the ankle.
const LEG_RINGS = [ // y range, ring center (|x|, z), scale
  [1.6, 1.75, 0.55, -0.08, 1.42],
  [1.05, 1.2, 0.60, -0.26, 1.5],
  [0.3, 0.4, 0.74, -0.31, 1.22],
];
function deform([x, y, z]) {
  const ring = Math.abs(x) < 1.1 && LEG_RINGS.find(r => y > r[0] && y < r[1]);
  if (!ring) return [x, y, z];
  const [, , cx, cz, s] = ring, side = Math.sign(x);
  return [side * (cx + (Math.abs(x) - cx) * s), y, cz + (z - cz) * s];
}

// --- Skirt --------------------------------------------------------------------------------------
// Rows from just under the waist to the hem: y, half width, front z, back z, slit angle, thigh weight.
const ROWS = [
  [3.56, 0.445, 0.475, -0.275, 0, 0.05],
  [3.15, 0.50, 0.475, -0.36, 0, 0.6],
  [2.70, 0.64, 0.46, -0.40, 0.05, 0.85],
  [2.22, 0.74, 0.45, -0.44, 0.14, 0.95],
  [HEM, 0.84, 0.44, -0.48, 0.22, 0.95],
];
const COLUMNS = 6; // per sheet

function skirtPiece() {
  const vertices = [], triangles = [];
  for (const sheet of [0, 1]) { // 0 front, 1 back
    const start = vertices.length;
    ROWS.forEach(([y, a, zf, zb, slit, thigh], r) => {
      for (let c = 0; c <= COLUMNS; c++) {
        const t = c / COLUMNS, angle = Math.PI * sheet + slit + (Math.PI - 2 * slit) * t;
        // Round at the waist to sit flush, boxier below to clear the hips.
        const round = v => Math.sign(v) * Math.abs(v) ** (r === 0 ? 0.9 : 2 / 3);
        const x = a * round(Math.cos(angle)), z = (zf + zb) / 2 + (zf - zb) / 2 * round(Math.sin(angle));
        const s = Math.max(0, Math.min(1, (x + 0.4) / 0.8)), left = s * s * (3 - 2 * s);
        vertices.push({
          position: [x, y, z],
          // Front sheet fills the left half of the texture, back sheet the right half.
          uv: [(sheet + 0.02 + 0.96 * t) / 2, 0.01 + 0.98 * r / (ROWS.length - 1)],
          weights: [['spine_01', 1 - thigh], ['thigh.L_030', thigh * left], ['thigh.R_035', thigh * (1 - left)]],
        });
      }
    });
    for (let r = 0; r < ROWS.length - 1; r++) {
      for (let c = 0; c < COLUMNS; c++) {
        const a = start + r * (COLUMNS + 1) + c, b = a + 1, d = a + COLUMNS + 1, e = d + 1;
        // Outward-facing winding for both sheets.
        triangles.push([a, b, d], [b, e, d]);
      }
    }
  }
  return { name: 'Kurta_Skirt', textureSize: 128, vertices, triangles, color: skirtColor };
}

function skirtColor([x, y, z], [nx, , nz]) {
  if (y < HEM + 0.035) return P.maroon;
  if (y < HEM + 0.10) return P.gold;
  if (y < HEM + 0.19) return mod(x, 0.1) < 0.05 ? P.maroon : P.maroonShade;
  if (y < HEM + 0.225) return P.gold;
  return kurtaCloth(Math.abs(nx) > Math.abs(nz) ? z : x, y, nz);
}

module.exports = {
  id: 'kurta_salwar',
  label: 'Kurta salwar',
  files: {
    glb: 'ps1_character_kurta_salwar.glb',
    body: 'ps1_kurta_salwar_texture.png',
    face: 'ps1_kurta_salwar_face.png',
    skinMask: 'ps1_kurta_salwar_skin_mask.png',
    hair: 'ps1_kurta_salwar_hair.png',
    sideLeft: 'ps1_kurta_salwar_side_left.png',
    sideRight: 'ps1_kurta_salwar_side_right.png',
    sideMaskLeft: 'ps1_kurta_salwar_side_mask_left.png',
    sideMaskRight: 'ps1_kurta_salwar_side_mask_right.png',
    Kurta_Skirt: 'ps1_kurta_salwar_skirt.png',
  },
  // Palette entries the app may recolor (skin) or keep on top of a pasted photo (hair).
  baseSkin: P.skin,
  baseHair: P.hair,
  skinColors: [P.skin, P.skinLight, P.skinShade],
  hairColors: [P.hair, P.hairLight, P.hairShade, P.parting],
  bodyColor,
  faceColor,
  deform,
  pieces: [skirtPiece()],
};
