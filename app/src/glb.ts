// Puts finished textures into a GLB. The mesh, skeleton, animation and credit are left exactly as they are.

const GLTF = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const padded = (n: number) => Math.ceil(n / 4) * 4;

interface Gltf {
  buffers: { byteLength: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  images: { bufferView: number; mimeType: string }[];
  textures: { source: number }[];
  materials: { name: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
}

/** `pngs` holds PNG files by material name. */
export function replaceTextures(glb: Uint8Array, pngs: ReadonlyMap<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.length < 28 || view.getUint32(0, true) !== GLTF || view.getUint32(16, true) !== JSON_CHUNK) throw new Error('Not a GLB');
  const binStart = 20 + view.getUint32(12, true);
  if (view.getUint32(binStart + 4, true) !== BIN_CHUNK) throw new Error('GLB has no binary data');
  const gltf: Gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, binStart)));
  const bin = glb.subarray(binStart + 8, binStart + 8 + view.getUint32(binStart, true));

  const replaced = new Map<number, Uint8Array>(); // by buffer view
  for (const [name, png] of pngs) {
    const texture = gltf.materials.find(m => m.name === name)?.pbrMetallicRoughness?.baseColorTexture;
    if (!texture) throw new Error(`No textured material called ${name}`);
    const image = gltf.images[gltf.textures[texture.index].source];
    image.mimeType = 'image/png';
    replaced.set(image.bufferView, png);
  }
  const parts = gltf.bufferViews.map((v, i) => replaced.get(i) ?? bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  let end = 0;
  const offsets = parts.map((part, i) => {
    const at = end;
    Object.assign(gltf.bufferViews[i], { byteOffset: at, byteLength: part.length });
    end = padded(at + part.length);
    return at;
  });
  gltf.buffers[0].byteLength = end;

  const json = new TextEncoder().encode(JSON.stringify(gltf)), jsonSize = padded(json.length);
  const out = new Uint8Array(28 + jsonSize + end), write = new DataView(out.buffer);
  [GLTF, 2, out.length, jsonSize, JSON_CHUNK].forEach((n, i) => write.setUint32(i * 4, n, true));
  out.fill(0x20, 20, 20 + jsonSize); // JSON is padded with spaces
  out.set(json, 20);
  write.setUint32(20 + jsonSize, end, true);
  write.setUint32(24 + jsonSize, BIN_CHUNK, true);
  parts.forEach((part, i) => out.set(part, 28 + jsonSize + offsets[i]));
  return out;
}
