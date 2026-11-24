// An original low-poly evening study for the avatar to stand in. Geometry and textures are made in code.
// Scale: the avatar is about 5.9 units tall. Walls face inward, so the camera can look through them.
import * as THREE from 'three';

type Paint = (ctx: CanvasRenderingContext2D, random: () => number) => void;

/** Repeatable randomness, so the room looks the same every time. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function texture(width: number, height: number, seed: number, paint: Paint, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { width, height });
  paint(canvas.getContext('2d')!, seeded(seed));
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(...repeat);
  return map;
}

const rect = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** The wobble of early 3D consoles: vertices snap to a coarse grid on screen. */
function wobbly<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      gl_Position.xy = floor(gl_Position.xy / gl_Position.w * vec2(200.0, 150.0) + 0.5) / vec2(200.0, 150.0) * gl_Position.w;`);
  };
  return material;
}

const matte = (options: THREE.MeshLambertMaterialParameters) => wobbly(new THREE.MeshLambertMaterial({ flatShading: true, ...options }));
/** Brighter than white, so bloom picks it up. */
const glow = (color: number, strength: number) => wobbly(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), fog: false }));

const planks: Paint = (ctx, random) => {
  for (let row = 0; row < 4; row++) {
    const offset = Math.floor(random() * 32);
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 16; y++) {
        const seam = y === 0 || (x + offset) % 32 === 0, n = random() * 16 + (Math.sin(x * 0.4 + row * 9) > 0.6 ? -10 : 0) + row * 4;
        rect(ctx, seam ? '#2a1812' : `rgb(${96 + n}, ${58 + n * 0.7}, ${36 + n * 0.5})`, x, row * 16 + y, 1, 1);
      }
    }
  }
};
const wallpaper: Paint = (ctx, random) => {
  rect(ctx, '#223a3c', 0, 0, 64, 64);
  for (let x = 0; x < 64; x += 16) rect(ctx, '#294648', x, 0, 8, 64);
  for (let i = 0; i < 8; i++) {
    const x = (i % 4) * 16 + 3, y = Math.floor(i / 4) * 32 + (i % 2) * 16 + 4;
    for (const [dx, dy] of [[0, 0], [-2, 2], [2, 2], [0, 4]]) rect(ctx, '#7d6644', x + dx, y + dy, 2, 2);
  }
  for (let i = 0; i < 260; i++) rect(ctx, 'rgba(0, 0, 0, 0.12)', Math.floor(random() * 64), Math.floor(random() * 64), 1, 1);
};
const rug: Paint = ctx => {
  ['#5d2233', '#c08a43', '#24424a', '#c9b48a', '#5d2233', '#24424a'].forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 32, 32 - i * 5, 0, Math.PI * 2);
    ctx.fill();
  });
};
const night: Paint = (ctx, random) => {
  for (let y = 0; y < 72; y++) rect(ctx, `rgb(${14 + y * 0.5}, ${18 + y * 0.6}, ${52 + y * 0.9})`, 0, y, 64, 1);
  for (let i = 0; i < 40; i++) rect(ctx, '#aab4e0', Math.floor(random() * 64), Math.floor(random() * 40), 1, 1);
  ctx.fillStyle = '#f4ecd0';
  ctx.beginPath();
  ctx.arc(46, 16, 7, 0, Math.PI * 2);
  ctx.fill();
  for (let x = 0; x < 64;) {
    const w = 7 + Math.floor(random() * 7), h = 14 + Math.floor(random() * 26);
    rect(ctx, '#0c1024', x, 72 - h, w, h);
    for (let wy = 74 - h; wy < 70; wy += 4) for (let wx = x + 1; wx < x + w - 1; wx += 3) if (random() > 0.55) rect(ctx, '#ffcf7a', wx, wy, 1, 2);
    x += w;
  }
};
const books: Paint = (ctx, random) => {
  rect(ctx, '#20130f', 0, 0, 64, 128);
  const colors = ['#8c3b3b', '#39626b', '#b78a45', '#54633a', '#6a4560', '#a9602f', '#cdbb93', '#2f3d66'];
  for (let shelf = 0; shelf < 4; shelf++) {
    const bottom = shelf * 32 + 29;
    rect(ctx, '#4a2c1d', 0, bottom, 64, 3);
    for (let x = 2; x < 60;) {
      const w = 3 + Math.floor(random() * 4), h = 16 + Math.floor(random() * 10);
      if (random() > 0.12) {
        rect(ctx, colors[Math.floor(random() * colors.length)], x, bottom - h, w, h);
        rect(ctx, 'rgba(255, 235, 190, 0.55)', x, bottom - h + 4, w, 1);
        rect(ctx, 'rgba(0, 0, 0, 0.35)', x + w - 1, bottom - h, 1, h);
      }
      x += w;
    }
  }
};

const LAMP = 24;

export interface Room {
  group: THREE.Group;
  /** The main light follows the camera, so the face is lit from any angle. */
  update(seconds: number, camera: THREE.Camera, target: THREE.Vector3): void;
}

export function createRoom(): Room {
  const group = new THREE.Group(), floorY = -0.1, backZ = -4.6;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const wood = matte({ color: 0x5a3623 }), darkWood = matte({ color: 0x38211a }), brass = matte({ color: 0x9a7436 });

  // Shell
  const floor = add(new THREE.PlaneGeometry(14, 14, 14, 14), matte({ map: texture(64, 64, 1, planks, [5, 5]) }), 0, floorY, 2);
  floor.rotation.x = -Math.PI / 2;
  const paper = texture(64, 64, 2, wallpaper, [5, 3.4]);
  add(new THREE.PlaneGeometry(14, 9.6, 14, 10), matte({ map: paper }), 0, 4.7, backZ);
  for (const side of [-1, 1]) {
    const wall = add(new THREE.PlaneGeometry(14, 9.6, 14, 10), matte({ map: paper }), side * 7, 4.7, 2);
    wall.rotation.y = -side * Math.PI / 2;
    const skirting = add(box(0.15, 1.5, 14), darkWood, side * 6.95, 0.65, 2);
    skirting.material = darkWood;
  }
  add(box(14, 1.5, 0.15), darkWood, 0, 0.65, backZ + 0.06);
  add(box(14, 0.14, 0.26), wood, 0, 1.45, backZ + 0.1);
  const carpet = add(new THREE.CircleGeometry(3.1, 10), matte({ map: texture(64, 64, 3, rug) }), 0, floorY + 0.03, 0.2);
  carpet.rotation.x = -Math.PI / 2;

  // Night window and curtains
  const window = new THREE.Group();
  window.position.set(-2.75, 5.5, backZ + 0.08);
  group.add(window);
  const view = new THREE.MeshBasicMaterial({ map: texture(64, 72, 4, night), color: new THREE.Color(0.9, 0.9, 1), fog: false });
  add(new THREE.PlaneGeometry(2.5, 3.1), wobbly(view), 0, 0, 0, window);
  for (const x of [-1.3, 0, 1.3]) add(box(0.14, 3.3, 0.14), wood, x, 0, 0.06, window);
  for (const y of [-1.6, 0.2, 1.6]) add(box(2.7, 0.14, 0.14), wood, 0, y, 0.06, window);
  add(box(3.1, 0.16, 0.5), wood, 0, -1.72, 0.2, window);
  const rod = add(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 6), brass, 0, 1.95, 0.3, window);
  rod.rotation.z = Math.PI / 2;
  const cloth = matte({ color: 0x8a3a35, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const curtain = new THREE.PlaneGeometry(1, 4.4, 6, 3), points = curtain.attributes.position;
    for (let i = 0; i < points.count; i++) {
      points.setZ(i, (Math.round((points.getX(i) + 0.5) * 6) % 2) * 0.2);
      if (points.getY(i) > 1 || points.getY(i) < -1) points.setX(i, points.getX(i) * 1.1);
    }
    add(curtain, cloth, side * 1.75, -0.25, 0.22, window);
  }

  // Bookshelf
  add(box(2.9, 6.4, 0.9), darkWood, 4.3, 3.1, backZ + 0.5);
  add(new THREE.PlaneGeometry(2.6, 6), matte({ map: texture(64, 128, 5, books) }), 4.3, 3.1, backZ + 0.97);

  // Floor lamp
  const lampX = 2.15, lampZ = -3.5;
  add(new THREE.CylinderGeometry(0.5, 0.6, 0.15, 8), brass, lampX, floorY + 0.08, lampZ);
  add(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 5), brass, lampX, 2.3, lampZ);
  add(new THREE.CylinderGeometry(0.42, 0.8, 0.95, 8, 1, true), glow(0xffb765, 2.1), lampX, 4.85, lampZ);
  const lamp = new THREE.PointLight(0xffa552, LAMP, 13, 1.7);
  lamp.position.set(lampX, 4.8, lampZ + 0.5);
  group.add(lamp);

  // Side table with a radio
  add(new THREE.CylinderGeometry(0.95, 0.95, 0.12, 8), wood, -2.7, 1.9, -3.3);
  add(new THREE.CylinderGeometry(0.12, 0.3, 2, 6), darkWood, -2.7, 0.9, -3.3);
  add(box(1.1, 0.65, 0.45), matte({ color: 0x9c4a32 }), -2.75, 2.29, -3.3);
  add(box(0.42, 0.24, 0.02), glow(0x8dffb0, 1.5), -2.5, 2.36, -3.06);
  add(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 8), brass, -3.0, 2.3, -3.06).rotation.x = Math.PI / 2;
  const dial = new THREE.PointLight(0x66ff99, 1.6, 3, 2);
  dial.position.set(-2.5, 2.4, -2.7);
  group.add(dial);

  // Potted plant
  add(new THREE.CylinderGeometry(0.55, 0.4, 0.9, 7), matte({ color: 0xa9552f }), 5.3, 0.35, -1.6);
  const leaf = matte({ color: 0x3f6b3a, side: THREE.DoubleSide });
  for (let i = 0; i < 8; i++) {
    const angle = i * 2.4, blade = add(new THREE.ConeGeometry(0.16, 1.9 + (i % 3) * 0.5, 4), leaf, 5.3 + Math.cos(angle) * 0.25, 1.6, -1.6 + Math.sin(angle) * 0.25);
    blade.rotation.set(Math.sin(angle) * 0.28, 0, -Math.cos(angle) * 0.28);
  }

  // String lights
  const colors = [0xff7a5c, 0xffc65c, 0x7fe0c0, 0x8fa8ff, 0xff8fc0], bulbs: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 17; i++) {
    const t = i / 16, sag = Math.abs(((t * 4) % 1) - 0.5);
    const material = glow(colors[i % colors.length], 1.7);
    add(new THREE.OctahedronGeometry(0.11), material, -6.4 + t * 12.8, 8.05 + sag * 1.1, backZ + 0.25);
    bulbs.push(material);
  }

  // Moonlight from the window and a soft key so the face stays readable
  const moon = new THREE.DirectionalLight(0x7f9cff, 1.1);
  moon.position.set(-5, 7, -5);
  const key = new THREE.DirectionalLight(0xffe8d2, 3.1);
  key.position.set(3.5, 5, 9);
  group.add(moon, key, key.target, new THREE.HemisphereLight(0xb4a8cc, 0x5a4034, 1.35));

  const keyOffset = new THREE.Vector3(1.5, 3, 0), base = bulbs.map(b => b.color.clone()), still = matchMedia('(prefers-reduced-motion: reduce)');
  return {
    group,
    update(seconds, camera, target) {
      key.target.position.copy(target);
      key.position.copy(camera.position).sub(target).normalize().multiplyScalar(6).add(keyOffset).add(target);
      if (still.matches) return;
      bulbs.forEach((b, i) => b.color.copy(base[i]).multiplyScalar(0.75 + 0.25 * Math.sin(seconds * 1.6 + i * 1.9)));
      lamp.intensity = LAMP + Math.sin(seconds * 9) * 0.5 + Math.sin(seconds * 23) * 0.4;
    },
  };
}
