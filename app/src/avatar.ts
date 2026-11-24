// The 3D avatar preview: the model, and optionally a PS1-style room with bloom around it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createRoom, type Room } from './room.ts';
import type { Outfit, Pixels } from './types.ts';

export type Framing = 'head' | 'body';
export type Backdrop = 'room' | 'plain';

/** Lines on screen in the room, like an early console. Bigger pixels than the display's. */
const RETRO_LINES = 240;
/** The short side of the retro picture in a video. Video sizes are multiples of it. */
const RETRO_VIDEO_SIDE = 270;
/** Less in close-ups, where a nearby lamp would haze over the face. */
const BLOOM: Record<Framing, number> = { body: 0.55, head: 0.16 };

// Vignette, a little grain, then 15-bit color with ordered dithering. Runs on the final sRGB image.
const RetroShader = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, seed: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float seed;
    varying vec2 vUv;
    float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    void main() {
      vec2 pixel = floor(vUv * resolution);
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      vec2 edge = (vUv - 0.5) * 2.0;
      color *= mix(1.0, 0.42, smoothstep(0.45, 1.75, dot(edge, edge)));
      color += (noise(pixel) - 0.5) * 0.02;
      color = floor(clamp(color, 0.0, 1.0) * 31.0 + bayer4(pixel)) / 31.0;
      gl_FragColor = vec4(color, 1.0);
    }`,
};

export class AvatarView {
  private host: HTMLElement;
  private renderer = new THREE.WebGLRenderer({ antialias: false });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private retro = new ShaderPass(RetroShader);
  private room: Room = createRoom();
  private plainLights = new THREE.Group();
  private root: THREE.Object3D | null = null;
  private loadId = 0;
  private framing: Framing = 'body';
  private yaw = 0;
  private backdrop: Backdrop = 'room';
  /** While a video is made: the view to go back to afterwards. */
  private before: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  credit = '';

  constructor(host: HTMLElement) {
    this.host = host;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '3D avatar preview. Drag to rotate.');
    canvas.setAttribute('role', 'img');
    host.append(canvas);

    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(1, 2, 3);
    this.plainLights.add(new THREE.HemisphereLight(0xffffff, 0xc4c4c4, 2.4), key);
    this.scene.add(this.plainLights, this.room.group);

    this.composer = new EffectComposer(this.renderer);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.body, 0.55, 0.95);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.retro);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    new ResizeObserver(() => this.resize()).observe(host);
    this.setBackdrop('room');
    this.renderer.setAnimationLoop(ms => {
      if (!this.before) this.draw(ms / 1000);
    });
  }

  private draw(seconds: number): void {
    this.controls.update();
    if (this.backdrop === 'plain') return this.renderer.render(this.scene, this.camera);
    this.room.update(seconds, this.camera, this.controls.target);
    this.retro.uniforms.seed.value = Math.floor(seconds * 12) % 97;
    this.composer.render();
  }

  setBackdrop(backdrop: Backdrop): void {
    this.backdrop = backdrop;
    const inRoom = backdrop === 'room';
    this.room.group.visible = inRoom;
    this.plainLights.visible = !inRoom;
    this.scene.background = new THREE.Color(inRoom ? 0x07060a : 0xc9ccd6);
    this.scene.fog = inRoom ? new THREE.Fog(0x0b0710, 14, 30) : null;
    this.renderer.domElement.style.imageRendering = inRoom ? 'pixelated' : '';
    this.root?.traverse(o => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).needsUpdate = true; // fog was added or removed
    });
    this.resize();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h || this.before) return;
    const scale = this.backdrop === 'room' ? Math.min(1, RETRO_LINES / h) : Math.min(devicePixelRatio, 2);
    this.setSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), w / h);
    this.frame(this.framing, this.yaw);
  }

  private setSize(width: number, height: number, aspect: number): void {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%' });
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);
    this.retro.uniforms.resolution.value.set(width, height);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Stops the live view and frames what it shows for a video of this size. */
  beginVideo(width: number, height: number): void {
    const { position } = this.camera, { target } = this.controls, fitted = this.fit()?.distance ?? 1;
    this.before = { position: position.clone(), target: target.clone() };
    const scale = this.backdrop === 'room' ? RETRO_VIDEO_SIDE / Math.min(width, height) : 1;
    this.setSize(Math.round(width * scale), Math.round(height * scale), width / height);
    // Keeps the angle and zoom the person chose, in the new shape.
    this.controls.maxDistance = Infinity;
    position.sub(target).multiplyScalar((this.fit()?.distance ?? 1) / fitted).add(target);
  }

  /** Draws one moment of a video. Copy the picture before doing anything else. */
  drawVideo(seconds: number): HTMLCanvasElement {
    this.draw(seconds);
    return this.renderer.domElement;
  }

  endVideo(): void {
    const { before } = this;
    if (!before) return;
    this.before = null;
    this.resize();
    this.camera.position.copy(before.position);
    this.controls.target.copy(before.target);
    this.controls.update();
  }

  /** Returns false if a newer load replaced this one. */
  async load(outfit: Outfit): Promise<boolean> {
    const id = ++this.loadId;
    const gltf = await new GLTFLoader().loadAsync(outfit.files.glb);
    if (id !== this.loadId) return false;
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        (o.material as THREE.MeshStandardMaterial).map?.dispose();
        (o.material as THREE.Material).dispose();
      });
    }
    this.root = gltf.scene;
    this.scene.add(this.root);
    this.credit = gltf.asset.copyright ?? '';
    this.frame(this.framing, this.yaw);
    return true;
  }

  /** Replaces one material's texture with these pixels (glTF orientation: first row is v = 0). */
  setTexture(materialName: string, image: Pixels): void {
    this.root?.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const material = o.material as THREE.MeshStandardMaterial;
      if (material.name !== materialName) return;
      const current = material.map;
      if (current instanceof THREE.DataTexture && current.image.width === image.width && current.image.height === image.height) {
        (current.image.data as Uint8Array).set(image.data);
        current.needsUpdate = true;
        return;
      }
      const map = new THREE.DataTexture(new Uint8Array(image.data), image.width, image.height, THREE.RGBAFormat);
      map.colorSpace = THREE.SRGBColorSpace;
      map.magFilter = map.minFilter = THREE.NearestFilter;
      map.needsUpdate = true;
      current?.dispose();
      material.map = map;
      material.needsUpdate = true;
    });
  }

  /** `yaw` is how far the camera circles, in degrees: 0 front, 90 the viewer's right side of the avatar. */
  frame(framing: Framing, yaw = 0): void {
    this.framing = framing;
    this.yaw = yaw;
    this.bloom.strength = BLOOM[framing];
    const fit = this.fit();
    if (!fit) return;
    const { target, distance } = fit, angle = THREE.MathUtils.degToRad(yaw);
    this.camera.position.set(target.x + Math.sin(angle) * distance, target.y, target.z + Math.cos(angle) * distance);
    this.controls.target.copy(target);
    this.controls.minDistance = distance * 0.4;
    this.controls.maxDistance = distance * (framing === 'head' ? 3 : 1.4);
    this.controls.update();
  }

  /** The middle of what is framed, and how far away it all fits in the picture. */
  private fit(): { target: THREE.Vector3; distance: number } | null {
    if (!this.root) return null;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root, true), size = box.getSize(new THREE.Vector3());
    const target = box.getCenter(new THREE.Vector3());
    let height = size.y * 1.12, width = size.x * 1.15;
    if (this.framing === 'head') {
      const head = new THREE.Box3(), p = new THREE.Vector3();
      this.root.traverse(o => {
        if (!(o instanceof THREE.SkinnedMesh) || (o.material as THREE.Material).name !== 'Face_Photo') return;
        for (let i = 0; i < o.geometry.attributes.position.count; i++) {
          head.expandByPoint(o.getVertexPosition(i, p).applyMatrix4(o.matrixWorld));
        }
      });
      head.getCenter(target);
      height = width = size.y * 0.21;
    }
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return { target, distance: Math.max(height / 2 / half, width / 2 / (half * this.camera.aspect)) };
  }
}
