import {
  LIMITS, STAGE, clampPlacement, compose, coverPlacement, faceBox, placementMatrix, textureMatrix, zoomAbout,
  type Placement,
} from './alignment.ts';
import { AudioSync } from './align.ts';
import { AvatarView, type Backdrop, type Framing } from './avatar.ts';
import { drawBlueprint, drawSideBlueprint } from './blueprint.ts';
import { decodeVoice, makeClip, type Shape } from './clip.ts';
import { PhotoError, closeCamera, openCamera, readPhotoFile, takePhoto, type Photo } from './camera.ts';
import { hasUnsupportedLetters } from './g2p.ts';
import { replaceTextures } from './glb.ts';
import { LipSync, buildTimeline } from './lipsync.ts';
import { blendMouth, findShift, mouthMask } from './mouth.ts';
import { fetchSpeech, onlineVoices, type OnlineVoice } from './online.ts';
import { ShapeGrid, mouthTiles, sideTiles } from './shapes.ts';
import { SIDE_IDS, blendSide, flip, hairTone, isSide, matchTone, mirrorProfile, panelMask, sideMask, wrapSides, type SideId } from './sides.ts';
import { Talker, localVoices } from './talk.ts';
import { buildFace, coverage, downscale, photoMask, grain, recolor, skinTone, stylize, type Look, type Recolor } from './texture.ts';
import type { FaceProfile, Outfit, Pixels, Point, SideProfile } from './types.ts';
import { VISEME_IDS, resolveViseme, viseme, type VisemeId } from './visemes.ts';

/**
 * start: no photo. camera: live view. align: placing the neutral face. pasted: neutral face on the avatar.
 * shape: a mouth shape or side without a photo is selected. adjust: one with a photo is.
 */
type Step = 'start' | 'camera' | 'align' | 'pasted' | 'shape' | 'adjust';

/** 'sil' is the neutral face, the other visemes are mouth shapes, and the sides are profiles. */
type ShotId = VisemeId | SideId;
/** One photo and where it sits on its blueprint. */
interface Shot { photo: Photo; placement: Placement; sampled: Pixels | null; blueprint: FaceProfile | SideProfile }
interface OutfitAssets {
  outfit: Outfit;
  body: Pixels;
  skinMask: Pixels;
  hair: Pixels;
  sides: Record<SideId, { base: Pixels; regions: Pixels }>;
}
/** Everything the side photos decide, shared by all mouth shapes. */
interface Sides { textures: Record<SideId, Pixels>; under: Pixels | null; hair: Recolor | null }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLCanvasElement>('stage'), video = $<HTMLVideoElement>('video');
const stageCtx = stage.getContext('2d')!;
const zoom = $<HTMLInputElement>('zoom'), tilt = $<HTMLInputElement>('tilt'), stretch = $<HTMLInputElement>('stretch');
const outfitSelect = $<HTMLSelectElement>('outfit'), lookSelect = $<HTMLSelectElement>('look');
const keepHair = $<HTMLInputElement>('keepHair'), matchSkin = $<HTMLInputElement>('matchSkin');
const voiceSelect = $<HTMLSelectElement>('voice'), textBox = $<HTMLTextAreaElement>('text'), rate = $<HTMLInputElement>('rate');
const SUPERSAMPLE = 4;
const COUNTDOWN_SECONDS = 5;

let step: Step = 'start';
let active: ShotId = 'sil';
let pasted = false;
const shots = new Map<ShotId, Shot>();
/** Finished face textures, built when first needed. */
const frames = new Map<VisemeId, Pixels>();
let shown: VisemeId | null = null;
let preview: VisemeId = 'sil';
let sides: Sides | null = null;
/** Finished textures other than the face, by material name. */
let painted = new Map<string, Pixels>();
/** Sides the person has finished adjusting. */
const reviewed = new Set<SideId>();
/** Sides that are still a mirrored copy of the other one. */
const mirroredSides = new Set<SideId>();

let profile: FaceProfile;
let mask: Float32Array;
let mouth: Float32Array;
let avatar: AvatarView;
let grid: ShapeGrid<VisemeId>;
let sideGrid: ShapeGrid<SideId>;
let sideProfiles: Record<SideId, SideProfile>;
let sideMasks: Record<SideId, Float32Array>;
let depth: Pixels;
let assets: OutfitAssets | null = null;
let stream: MediaStream | null = null;
let cameraRequest = 0;
let photoRequest = 0;
let redrawQueued = false;
let thumbTimer = 0;

const shot = () => shots.get(active);
const coverScale = (photo: Photo) => coverPlacement(photo.width, photo.height).scale;
const missing = () => VISEME_IDS.filter(id => id !== 'sil' && !shots.has(id));
const missingSides = () => SIDE_IDS.filter(id => !shots.has(id) || mirroredSides.has(id));
const available = () => new Set(VISEME_IDS.filter(id => shots.has(id)));
const opposite = (id: SideId): SideId => (id === 'sideL' ? 'sideR' : 'sideL');

// --- State --------------------------------------------------------------------------------------
function hintFor(next: Step): string {
  if (isSide(active)) {
    const turn = active === 'sideL' ? 'left so your right cheek' : 'right so your left cheek';
    if (next === 'adjust') return mirroredSides.has(active) ? 'Copied from your other side. Adjust it here, or retake it.' : 'Drag and zoom to match your ear, eye and chin to the guides.';
    if (next === 'camera') return `Tap Take photo, then turn your head to your ${turn} faces the camera. You have ${COUNTDOWN_SECONDS} seconds.`;
    return `Turn your head to your ${turn} faces the camera.`;
  }
  if (active !== 'sil' && next !== 'pasted') {
    const { sounds, say, how } = viseme(active);
    if (next === 'adjust') return `${sounds}: match the eyes and nose to the guides. The avatar shows the result.`;
    return `${sounds}: say ${say}. ${how}`;
  }
  return {
    start: '',
    camera: 'Fill the yellow oval, eyes on the eye line, lips closed.',
    align: 'Drag and zoom until your eyes, nose and mouth match the guides.',
    pasted: shots.size > 1 ? '' : 'Pasted. Now add the sides of your head, and mouth shapes so your avatar can talk.',
    shape: '',
    adjust: '',
  }[next];
}

function setStep(next: Step): void {
  step = next;
  document.body.dataset.step = next;
  document.body.dataset.face = pasted ? 'yes' : 'no';
  document.body.dataset.kind = isSide(active) ? 'side' : 'face';
  $('hint').textContent = hintFor(next);
  grid.setActive(active);
  sideGrid.setActive(active);
  const total = VISEME_IDS.length - 1, taken = total - missing().length, sidesLeft = missingSides().length;
  $('sideProgress').textContent = sidesLeft === 0 ? 'Both taken. Tap a side to adjust it.' : sidesLeft === 1 ? 'One taken. The other side is a mirrored copy. Tap a side to adjust it.' : 'Not taken. Sides use a plain skin tone.';
  $('takeSides').hidden = sidesLeft === 0;
  $('progress').textContent = taken === total ? `All ${total} taken.` : `${taken} of ${total} taken. Missing sounds use the closest shape.`;
  $('takeAll').hidden = taken === total;
  redraw();
}

function showError(error: unknown, scroll = true): void {
  const box = $('error');
  box.hidden = !error;
  if (!error) return;
  box.textContent = error instanceof PhotoError ? error.message : 'Something went wrong. Please try again.';
  if (scroll) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!(error instanceof PhotoError)) console.error(error);
}

function stopCamera(): void {
  cameraRequest++;
  closeCamera(stream, video);
  stream = null;
}

/** A left-right mirrored copy. */
function mirrorPhoto({ bitmap, width, height }: Photo): Photo {
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!;
  ctx.transform(-1, 0, 0, 1, width, 0);
  ctx.drawImage(bitmap, 0, 0);
  return { bitmap: canvas.transferToImageBitmap(), width, height };
}

/** Gives an untaken side its own copy of the other side, so it can be adjusted. */
function copyOtherSide(id: SideId): void {
  const other = shots.get(opposite(id));
  if (!other || shots.has(id)) return;
  const { placement } = other;
  shots.set(id, {
    photo: mirrorPhoto(other.photo), sampled: null, blueprint: sideProfiles[id],
    placement: { ...placement, x: -placement.x, rotation: -placement.rotation },
  });
  mirroredSides.add(id);
  applyFace();
}

/** Selects the neutral face, a mouth shape or a side for viewing, adjusting or photographing. */
function selectShape(id: ShotId, retaking = false): void {
  if (isSide(id)) setFraming('head', id === 'sideL' ? -62 : 62);
  else if (isSide(active)) setFraming('head');
  if (isSide(id) && !retaking) copyOtherSide(id);
  talker.stop();
  stopCamera();
  photoRequest++;
  showError(null);
  active = id;
  preview = isSide(id) ? 'sil' : id;
  if (shot()) syncSliders();
  setStep(id === 'sil' ? 'pasted' : shots.has(id) ? 'adjust' : 'shape');
  showFrame(preview);
}

function leaveCamera(): void {
  stopCamera();
  if (pasted) selectShape(active);
  else setStep('start');
}

async function startCamera(): Promise<void> {
  talker.stop();
  showError(null);
  stopCamera();
  photoRequest++;
  const request = cameraRequest, buttons = ['useCamera', 'takeAll', 'takeSides'].map(id => $<HTMLButtonElement>(id));
  buttons.forEach(b => { b.disabled = true; });
  try {
    const opened = await openCamera(video);
    if (request !== cameraRequest) return closeCamera(opened, video);
    stream = opened;
    setStep('camera');
    stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (error) {
    if (request === cameraRequest) showError(error);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

/** Stores a new photo for the selected shape. Returns a warning if it could not be lined up. */
function storePhoto(photo: Photo): string | null {
  shots.get(active)?.photo.bitmap.close();
  const neutral = shots.get('sil'), entry: Shot = {
    photo, placement: coverPlacement(photo.width, photo.height), sampled: null, blueprint: isSide(active) ? sideProfiles[active] : profile,
  };
  shots.set(active, entry);
  if (isSide(active)) mirroredSides.delete(active);
  if (active === 'sil' || !neutral) return null;
  if (isSide(active)) {
    // Painted hair would cover most of a profile, so show the person's own once they add one.
    if (missingSides().length === SIDE_IDS.length - 1) keepHair.checked = false;
    const { scale, stretch: width } = neutral.placement;
    if (photo.width === neutral.photo.width && photo.height === neutral.photo.height) Object.assign(entry.placement, { scale, stretch: width });
    applyFace();
    return null;
  }
  // The same camera gives the same framing, so start from the neutral face's placement.
  if (photo.width === neutral.photo.width && photo.height === neutral.photo.height) entry.placement = { ...neutral.placement };
  const shift = findShift(sample(neutral), sample(entry), profile);
  if (shift) {
    const box = faceBox(profile);
    entry.placement.x += shift[0] * box.width / profile.textureSize;
    entry.placement.y += shift[1] * box.height / profile.textureSize;
    entry.sampled = null;
  }
  refreshFrame(active);
  return shift ? null : 'This photo could not be lined up automatically. Drag and zoom it until the eyes and nose match the guides.';
}

function usePhoto(photo: Photo): void {
  stopCamera();
  showError(null);
  const warning = storePhoto(photo);
  syncSliders();
  if (active === 'sil') return setStep('align');
  selectShape(active);
  if (warning) showError(new PhotoError(warning));
}

async function loadFile(file: File): Promise<void> {
  const request = ++photoRequest;
  showError(null);
  try {
    const next = await readPhotoFile(file);
    if (request === photoRequest) usePhoto(next);
    else next.bitmap.close();
  } catch (error) {
    if (request === photoRequest) showError(error);
  }
}

function beep(frequency: number, seconds: number): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const tone = audio.createOscillator(), volume = audio.createGain(), end = audio.currentTime + seconds;
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0.12, audio.currentTime);
    volume.gain.linearRampToValueAtTime(0, end);
    tone.connect(volume).connect(audio.destination);
    tone.start();
    tone.stop(end);
  } catch {
    // The number on screen still counts down.
  }
}

/** Time to turn sideways. Resolves false if something else happened meanwhile. */
async function countdown(request: number): Promise<boolean> {
  const label = $('count');
  label.hidden = false;
  try {
    for (let left = COUNTDOWN_SECONDS; left > 0; left--) {
      label.textContent = String(left);
      beep(left === 1 ? 880 : 520, 0.12);
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (request !== photoRequest || step !== 'camera') return false;
    }
    beep(1180, 0.25);
    return true;
  } finally {
    label.hidden = true;
  }
}

async function capture(): Promise<void> {
  const request = ++photoRequest, button = $<HTMLButtonElement>('capture');
  try {
    if (isSide(active)) {
      button.disabled = true;
      if (!await countdown(request)) return;
    }
    const photo = await takePhoto(video);
    if (request !== photoRequest || step !== 'camera') return photo.bitmap.close();
    if (active === 'sil') return usePhoto(photo);
    // Keep the camera open and move on to the next missing shape.
    showError(null);
    const taken = active, warning = storePhoto(photo), [next] = isSide(taken) ? missingSides() : missing();
    preview = isSide(taken) ? 'sil' : taken;
    if (warning) {
      selectShape(taken);
      return showError(new PhotoError(warning));
    }
    if (!next) {
      selectShape(isSide(taken) ? 'sideL' : 'sil');
      return stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    active = next;
    if (isSide(next)) setFraming('head', next === 'sideL' ? -62 : 62);
    setStep('camera');
    showFrame(preview);
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

/** Mirrors a side photo: some phones save selfies flipped. */
function flipPhoto(): void {
  const entry = shot(), id = active;
  if (!entry || !isSide(id)) return;
  const old = entry.photo, { placement } = entry;
  entry.photo = mirrorPhoto(old);
  old.bitmap.close();
  place({ ...placement, x: -placement.x, rotation: -placement.rotation });
}

function dropShot(id: ShotId): void {
  shots.get(id)?.photo.bitmap.close();
  shots.delete(id);
  if (isSide(id)) {
    sides = null;
    mirroredSides.delete(id);
    reviewed.delete(id);
    return sideGrid.setThumbnail(id, null);
  }
  frames.delete(id);
  if (shown === id) shown = null;
  grid.setThumbnail(id, null);
}

async function deleteAll(): Promise<void> {
  talker.stop();
  stopCamera();
  photoRequest++;
  clearTimeout(thumbTimer);
  pasted = false;
  [...VISEME_IDS, ...SIDE_IDS].forEach(dropShot);
  frames.clear();
  painted.clear();
  keepHair.checked = true;
  setFraming('head');
  active = preview = 'sil';
  showError(null);
  setStep('start');
  await selectOutfit(outfitSelect.value); // restores the original face and skin
}

// --- Stage --------------------------------------------------------------------------------------
function redraw(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    drawStage();
    if (step === 'camera') redraw();
  });
}

function drawPhoto(source: CanvasImageSource, placement: Placement, width: number, height: number, mirrored = false): void {
  stageCtx.save();
  if (mirrored) stageCtx.transform(-1, 0, 0, 1, STAGE.width, 0);
  stageCtx.transform(...placementMatrix(placement, width, height));
  stageCtx.drawImage(source, 0, 0);
  stageCtx.restore();
}

function drawStage(): void {
  const ratio = Math.min(devicePixelRatio, 2), width = Math.round(stage.clientWidth * ratio);
  const height = Math.round(width * STAGE.height / STAGE.width);
  if (!width) return;
  if (stage.width !== width || stage.height !== height) Object.assign(stage, { width, height });
  const unit = width / STAGE.width, neutral = shots.get('sil'), current = shot();
  stageCtx.setTransform(unit, 0, 0, unit, 0, 0);
  stageCtx.fillStyle = '#1a2036';
  stageCtx.fillRect(0, 0, STAGE.width, STAGE.height);
  const live = step === 'camera' && video.videoWidth > 0;
  if (live) {
    // Mirrored like a looking glass; the captured photo is not.
    const { videoWidth: w, videoHeight: h } = video;
    const same = active !== 'sil' && !isSide(active) && neutral && neutral.photo.width === w && neutral.photo.height === h;
    drawPhoto(video, same ? neutral.placement : coverPlacement(w, h), w, h, true);
  } else if (current && step !== 'camera') {
    drawPhoto(current.photo.bitmap, current.placement, current.photo.width, current.photo.height);
  }
  if (isSide(active)) return drawSideBlueprint(stageCtx, sideProfiles[step === 'camera' ? opposite(active) : active]);
  if (neutral && active !== 'sil' && step !== 'pasted') {
    // A ghost of the neutral face's eyes and nose, to line the head up with.
    const box = faceBox(profile), bottom = box.y + profile.landmarksUv.noseTip[1] * box.height;
    stageCtx.save();
    stageCtx.beginPath();
    stageCtx.rect(0, 0, STAGE.width, step === 'shape' ? STAGE.height : bottom);
    stageCtx.clip();
    stageCtx.globalAlpha = step === 'adjust' ? 0.3 : 0.4;
    drawPhoto(neutral.photo.bitmap, neutral.placement, neutral.photo.width, neutral.photo.height, step === 'camera');
    stageCtx.restore();
  }
  drawBlueprint(stageCtx, profile, { mouth: active === 'sil' });
}

// --- Pasting ------------------------------------------------------------------------------------
const sampler = document.createElement('canvas');

/** The photo as it appears inside the face box, at texture resolution. */
function sample(entry: Shot): Pixels {
  if (entry.sampled) return entry.sampled;
  const { photo, placement, blueprint } = entry, size = blueprint.textureSize * SUPERSAMPLE;
  Object.assign(sampler, { width: size, height: size }); // also clears it
  const ctx = sampler.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(...compose(textureMatrix(faceBox(blueprint), size), placementMatrix(placement, photo.width, photo.height)));
  ctx.drawImage(photo.bitmap, 0, 0);
  entry.sampled = downscale(ctx.getImageData(0, 0, size, size), blueprint.textureSize);
  Object.assign(sampler, { width: 1, height: 1 }); // do not keep a copy of the photo around
  return entry.sampled;
}

function tone(): [number, number, number] {
  const neutral = shots.get('sil');
  return (neutral && skinTone(sample(neutral), profile)) ?? assets!.outfit.baseSkin;
}

/** Painted textures get grain to sit with the photos, unless the look is smooth. */
const textured = (image: Pixels) => (lookSelect.value === 'smooth' ? image : grain(image));

/** Builds both sides of the head. One photo does for both, mirrored. */
function buildSides(): Sides | null {
  if (!assets) return null;
  const { outfit } = assets, front = tone(), photos = {} as Record<SideId, Pixels | null>;
  for (const id of SIDE_IDS) {
    const entry = shots.get(id), other = shots.get(opposite(id));
    const photo = entry ? sample(entry) : other ? flip(sample(other)) : null;
    photos[id] = photo && matchTone(photo, sideProfiles[id], front);
  }
  const any = photos.sideL, hairColor = any && !keepHair.checked ? hairTone(any, sideProfiles.sideL) : null;
  const skin = matchSkin.checked ? { from: outfit.baseSkin, to: front } : null;
  const hair = hairColor && { from: outfit.baseHair, to: hairColor };
  const raw = {} as Record<SideId, Pixels>, textures = {} as Record<SideId, Pixels>;
  for (const id of SIDE_IDS) {
    const { base, regions } = assets.sides[id], painted = recolor(base, regions, skin, hair), photo = photos[id];
    raw[id] = photo ? blendSide(painted, regions, photo, sideMasks[id], keepHair.checked) : painted;
    textures[id] = photo ? stylize(raw[id], lookSelect.value as Look, sideProfiles[id].surfaceAspect, front) : textured(raw[id]);
  }
  return { textures, under: any ? wrapSides(raw.sideL, raw.sideR, depth) : null, hair };
}

function frameFor(id: VisemeId): Pixels | null {
  const neutral = shots.get('sil'), entry = shots.get(id);
  if (!neutral || !entry || !assets) return null;
  let frame = frames.get(id);
  if (!frame) {
    const face = id === 'sil' ? sample(neutral) : blendMouth(sample(neutral), sample(entry), mouth);
    frame = buildFace(face, mask, tone(), assets.hair, keepHair.checked, lookSelect.value as Look, profile.surfaceAspect, sides?.under);
    frames.set(id, frame);
  }
  return frame;
}

/** Puts a mouth shape, or the closest photographed one, on the avatar. */
function showFrame(id: VisemeId): void {
  if (!pasted) return;
  const resolved = resolveViseme(id, available()), frame = frameFor(resolved);
  if (!frame || shown === resolved) return;
  avatar.setTexture(profile.materialName, frame);
  shown = resolved;
}

/** Rebuilds one shape after its photo moved, or all of them after something they share changed. */
function refreshFrame(id: VisemeId): void {
  if (id === 'sil') frames.clear();
  else frames.delete(id);
  if (id === 'sil' || shown === id) shown = null;
  if (!pasted) return;
  if (id !== 'sil') grid.setThumbnail(id, frameFor(id));
  else scheduleThumbnails();
  showFrame(preview);
}

function scheduleThumbnails(): void {
  clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => {
    for (const id of available()) grid.setThumbnail(id, frameFor(id));
    for (const id of SIDE_IDS) sideGrid.setThumbnail(id, shots.has(id) && sides ? sides.textures[id] : null);
  }, 250);
}

function checkCoverage(scroll = true): boolean {
  const entry = shot();
  if (!entry) return false;
  const area = active === 'sil' ? mask : isSide(active) ? panelMask(sideProfiles[active], sideMasks[active]) : mouth;
  const covered = coverage(sample(entry), area) >= 0.9;
  showError(covered ? null : new PhotoError(active === 'sil'
    ? 'The photo does not cover the whole face. Move or zoom it to fill the yellow oval.'
    : `The photo does not cover the ${isSide(active) ? 'side of the head' : 'mouth area'}. Uncovered parts use a plain skin tone.`), scroll);
  return covered;
}

/** Applies the neutral face, the sides, and matching skin and hair to the avatar. */
function applyFace(): void {
  if (!assets) return;
  const { outfit, body, skinMask } = assets;
  sides = buildSides();
  if (!sides) return;
  const { left, right } = sideProfiles.sideL.materialNames;
  painted = new Map([
    ['Body', textured(recolor(body, skinMask, matchSkin.checked ? { from: outfit.baseSkin, to: tone() } : null, sides.hair))],
    [left, sides.textures.sideL],
    [right, sides.textures.sideR],
  ]);
  painted.forEach((image, name) => avatar.setTexture(name, image));
  refreshFrame('sil');
}

// --- Avatar -------------------------------------------------------------------------------------
let outfits: Outfit[] = [];

async function loadPixels(url: string): Promise<Pixels> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function selectOutfit(id: string): Promise<void> {
  const outfit = outfits.find(o => o.id === id) ?? outfits[0], { files } = outfit;
  try {
    const load = (file: string) => loadPixels(file);
    const [loaded, body, skinMask, hair, baseL, baseR, regionsL, regionsR] = await Promise.all([
      avatar.load(outfit), load(files.body), load(files.skinMask), load(files.hair),
      load(files.sideLeft), load(files.sideRight), load(files.sideMaskLeft), load(files.sideMaskRight)]);
    if (!loaded || outfitSelect.value !== outfit.id) return;
    assets = { outfit, body, skinMask, hair, sides: { sideL: { base: baseL, regions: regionsL }, sideR: { base: baseR, regions: regionsR } } };
    shown = null;
    $('credit').textContent = avatar.credit;
    if (pasted) applyFace();
  } catch (error) {
    showError(error);
  }
}

function setFraming(framing: Framing, yaw = 0): void {
  avatar.frame(framing, yaw);
  $('viewBody').setAttribute('aria-pressed', String(framing === 'body'));
  $('viewHead').setAttribute('aria-pressed', String(framing === 'head'));
}

// --- Talking ------------------------------------------------------------------------------------
const talker = new Talker({
  onViseme(id) {
    showFrame(id);
    grid.setSpeaking(talker.talking ? resolveViseme(id, available()) : null);
  },
  onStart() {
    $('speak').textContent = 'Stop';
  },
  onEnd(error) {
    $('speak').textContent = 'Speak';
    grid.setSpeaking(null);
    showFrame(preview);
    if (error) showError(new PhotoError(error));
  },
});

const ONLINE = 'online:';
let online: OnlineVoice[] = [];
let voiceTouched = false;
let audio: AudioContext | null = null;

function showVoiceNote(): void {
  const isOnline = voiceSelect.value.startsWith(ONLINE);
  $('voiceNote').hidden = !isOnline;
  $('soundNote').textContent = isOnline ? '' : `Videos have no sound with this voice: browsers cannot record a device’s own voices.${online.length ? ' Choose an online voice for sound.' : ''}`;
}
voiceSelect.onchange = () => {
  voiceTouched = true;
  showVoiceNote();
};

function listVoices(): void {
  const voices = localVoices(), chosen = voiceSelect.value;
  const group = (label: string, options: HTMLOptionElement[]) => {
    const element = document.createElement('optgroup');
    element.label = label;
    element.append(...options);
    return options.length ? [element] : [];
  };
  const device = voices.map(v => new Option(`${v.name.replace(/ - .*/, '')} (${v.lang})`, v.voiceURI));
  const web = online.map(v => new Option(`${v.name} (${[v.locale, v.gender, v.hd ? 'HD' : ''].filter(Boolean).join(', ')})`, ONLINE + v.id));
  voiceSelect.replaceChildren(...group('On this device', device), ...group('Online (SpeechMa)', web), new Option('No sound', ''));
  // Keep the choice; otherwise prefer a private on-device voice.
  const values = [...device, ...web].map(o => o.value), preferred = voices.find(v => v.default)?.voiceURI;
  voiceSelect.value = voiceTouched && (values.includes(chosen) || chosen === '') ? chosen : preferred ?? values[0] ?? '';
  showVoiceNote();
}

/** The sentence to say, with the neutral face shown, or null (and why) if the avatar cannot say it. */
function prepareToTalk(): string | null {
  const text = textBox.value.trim();
  const problem = available().size < 2 ? 'Add at least one mouth shape first, so the mouth has something to move to.'
    : hasUnsupportedLetters(text) ? 'Talking works with English text for now.'
      : !buildTimeline(text).length ? 'Type a sentence for your avatar to say.' : null;
  showError(problem && new PhotoError(problem));
  if (problem) return null;
  if (step === 'camera') stopCamera();
  active = preview = 'sil';
  if (shot()) syncSliders();
  setStep('pasted');
  return text;
}

$('talk').onsubmit = event => {
  event.preventDefault();
  if (talker.talking) return talker.stop();
  const text = prepareToTalk();
  if (text === null) return;
  const chosen = voiceSelect.value, speed = Number(rate.value), voice = localVoices().find(v => v.voiceURI === chosen) ?? null;
  if (chosen.startsWith(ONLINE)) {
    audio ??= new AudioContext();
    void audio.resume(); // phones only allow sound that starts from a tap
    talker.speakAudio(text, audio, signal => fetchSpeech(text, chosen.slice(ONLINE.length), speed, signal));
  } else {
    talker.speak(text, voice, speed);
  }
  if ($('speak').textContent === 'Speak') $('speak').textContent = 'Cancel';
  setFraming('head');
};
textBox.onkeydown = event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  $<HTMLFormElement>('talk').requestSubmit();
};

// --- Downloads ----------------------------------------------------------------------------------
const clip = $<HTMLDialogElement>('clip'), clipVideo = $<HTMLVideoElement>('clipVideo'), clipSave = $<HTMLAnchorElement>('clipSave');
let clipAbort: AbortController | null = null;

/** Shows the progress bar, or the finished video. */
function showClip(title: string, note: string, finished: File | null): void {
  $('clipTitle').textContent = title;
  $('clipNote').textContent = note;
  $('clipProgress').hidden = !!finished;
  clipVideo.hidden = clipSave.hidden = !finished;
  $('clipShare').hidden = !finished || !navigator.canShare?.({ files: [finished] });
  $('clipClose').textContent = finished ? 'Close' : 'Cancel';
  if (!finished) return $<HTMLProgressElement>('clipProgress').removeAttribute('value');
  clipSave.href = clipVideo.src = URL.createObjectURL(finished);
  clipSave.download = finished.name;
  $('clipShare').onclick = () => void navigator.share({ files: [finished] }).catch(() => {}); // closing the share sheet rejects too
}

async function makeVideo(): Promise<void> {
  talker.stop();
  const text = prepareToTalk(), chosen = voiceSelect.value, speed = Number(rate.value);
  if (text === null) return;
  const button = $<HTMLButtonElement>('makeVideo');
  button.disabled = true; // a cancelled video may still be winding down
  const { signal } = clipAbort = new AbortController(), spoken = chosen.startsWith(ONLINE), words = buildTimeline(text);
  showClip(spoken ? 'Getting the voice' : 'Making your video', 'This happens on your device. Keep this page open.', null);
  clip.showModal();
  try {
    let voice: AudioBuffer | null = null, seconds: number, mouthAt: (time: number) => VisemeId;
    if (spoken) {
      voice = await decodeVoice(await fetchSpeech(text, chosen.slice(ONLINE.length), speed, signal));
      const sync = new AudioSync(words, voice.getChannelData(0), voice.sampleRate);
      seconds = voice.duration;
      mouthAt = time => sync.visemeAt(time);
    } else {
      const sync = new LipSync(words, speed);
      sync.start(0);
      seconds = sync.duration() / 1000;
      mouthAt = time => sync.visemeAt(time * 1000);
    }
    $('clipTitle').textContent = 'Making your video';
    const blob = await makeClip({
      shape: $<HTMLSelectElement>('shape').value as Shape, seconds, voice, credit: avatar.credit, signal,
      begin: (width, height) => avatar.beginVideo(width, height),
      draw(time) {
        showFrame(mouthAt(time));
        return avatar.drawVideo(time);
      },
      onProgress: share => { $<HTMLProgressElement>('clipProgress').value = share; },
    });
    signal.throwIfAborted();
    showClip('Your video', `${spoken ? '' : 'This video has no sound. '}If you post it, please credit the 3D model: ${avatar.credit}`, new File([blob], 'avatar.mp4', { type: blob.type }));
  } catch (error) {
    if (signal.aborted) return;
    closeClip();
    showError(error);
  } finally {
    avatar.endVideo();
    showFrame(preview);
    button.disabled = false;
  }
}

/** Stops the work and forgets the video. */
function closeClip(): void {
  clip.close();
  clipAbort?.abort();
  if (!clipVideo.src) return;
  URL.revokeObjectURL(clipVideo.src);
  clipVideo.removeAttribute('src');
  clipVideo.load();
  clipSave.removeAttribute('href');
}
clip.oncancel = closeClip; // Escape, or Back on phones. (Its close event comes late and could close the next video.)

async function toPng(image: Pixels): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

async function saveModel(): Promise<void> {
  const button = $<HTMLButtonElement>('saveModel'), face = frameFor('sil');
  if (!assets || !face) return;
  const { outfit } = assets;
  button.disabled = true;
  showError(null);
  try {
    const response = await fetch(outfit.files.glb);
    if (!response.ok) throw new Error('Could not load the model');
    const textures = [...painted, [profile.materialName, face] as const];
    const pngs = new Map(await Promise.all(textures.map(async ([name, image]) => [name, await toPng(image)] as const)));
    const model = replaceTextures(new Uint8Array(await response.arrayBuffer()), pngs), link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([model], { type: 'model/gltf-binary' }));
    link.download = `avatar-${outfit.id.replaceAll('_', '-')}.glb`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000); // phones may ask before they start reading it
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

// --- Adjusting ----------------------------------------------------------------------------------
const [minZoom, maxZoom] = LIMITS.zoom, zoomRange = Math.log(maxZoom / minZoom);

function syncSliders(): void {
  const entry = shot();
  if (!entry) return;
  zoom.value = String(Math.log(entry.placement.scale / coverScale(entry.photo) / minZoom) / zoomRange);
  tilt.value = String(entry.placement.rotation);
  stretch.value = String(entry.placement.stretch);
}

let updateQueued = false;
function place(next: Placement): void {
  const entry = shot();
  if (!entry) return;
  talker.stop();
  entry.placement = clampPlacement(next, coverScale(entry.photo));
  if (isSide(active) && mirroredSides.delete(active)) setStep(step); // it is their own side now
  entry.sampled = null;
  syncSliders();
  redraw();
  if (!pasted || updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => {
    updateQueued = false;
    if (!pasted) return;
    checkCoverage(false);
    if (active === 'sil' || isSide(active)) applyFace();
    else refreshFrame(active);
  });
}

const adjusting = () => step === 'align' || step === 'pasted' || step === 'adjust';
const center: Point = [STAGE.width / 2, STAGE.height / 2];
/** Runs an adjustment on the selected photo. */
const adjust = (change: (p: Placement, photo: Photo) => Placement) => {
  const entry = shot();
  if (entry && adjusting()) place(change(entry.placement, entry.photo));
};

zoom.oninput = () => adjust((p, photo) => zoomAbout(p, center, minZoom * Math.exp(Number(zoom.value) * zoomRange) * coverScale(photo) / p.scale));
tilt.oninput = () => adjust(p => zoomAbout(p, center, 1, Number(tilt.value) - p.rotation));
stretch.oninput = () => adjust(p => ({ ...p, x: p.x * Number(stretch.value) / p.stretch, stretch: Number(stretch.value) }));

const pointers = new Map<number, Point>();
function toStage(event: { clientX: number; clientY: number }): Point {
  const rect = stage.getBoundingClientRect();
  return [(event.clientX - rect.left) / rect.width * STAGE.width, (event.clientY - rect.top) / rect.height * STAGE.height];
}

stage.addEventListener('pointerdown', event => {
  if (!adjusting() || pointers.size >= 2) return;
  stage.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, toStage(event));
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', event => {
  const before = pointers.get(event.pointerId);
  if (!before) return;
  const now = toStage(event), other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
  pointers.set(event.pointerId, now);
  adjust((p, photo) => {
    if (!other) return { ...p, x: p.x + now[0] - before[0], y: p.y + now[1] - before[1] };
    // Pinch: the finger that did not move is the fixed point.
    const from = [before[0] - other[0], before[1] - other[1]], to = [now[0] - other[0], now[1] - other[1]];
    const factor = Math.hypot(to[0], to[1]) / Math.max(1, Math.hypot(from[0], from[1]));
    let turn = (Math.atan2(to[1], to[0]) - Math.atan2(from[1], from[0])) * 180 / Math.PI;
    turn = ((turn + 540) % 360) - 180;
    const limited = clampPlacement({ ...p, scale: p.scale * factor, rotation: p.rotation + turn }, coverScale(photo));
    return zoomAbout(p, other, limited.scale / p.scale, limited.rotation - p.rotation);
  });
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  stage.addEventListener(type, event => {
    pointers.delete(event.pointerId);
    if (!pointers.size) stage.classList.remove('dragging');
  });
}
stage.addEventListener('wheel', event => {
  if (!adjusting() || !shot()) return;
  event.preventDefault();
  adjust((p, photo) => {
    const limited = clampPlacement({ ...p, scale: p.scale * Math.exp(-event.deltaY * 0.0015) }, coverScale(photo));
    return zoomAbout(p, toStage(event), limited.scale / p.scale);
  });
}, { passive: false });
stage.addEventListener('keydown', event => {
  if (!adjusting()) return;
  const amount = event.shiftKey ? 20 : 4;
  const move: Record<string, Point> = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] };
  const zoomBy = { '+': 1.03, '=': 1.03, '-': 1 / 1.03 }[event.key], by = move[event.key];
  if (by) adjust(p => ({ ...p, x: p.x + by[0], y: p.y + by[1] }));
  else if (zoomBy) adjust(p => zoomAbout(p, center, zoomBy));
  else return;
  event.preventDefault();
});

// --- Buttons ------------------------------------------------------------------------------------
const file = $<HTMLInputElement>('file');
$('useCamera').onclick = startCamera;
$('upload').onclick = () => file.click();
file.onchange = () => {
  const [chosen] = file.files ?? [];
  if (chosen) void loadFile(chosen);
  file.value = '';
};
$('capture').onclick = capture;
$('cancelCamera').onclick = leaveCamera;
$('takeAll').onclick = () => {
  const [next] = missing();
  if (!next) return;
  selectShape(next);
  void startCamera();
};
$('paste').onclick = () => {
  if (!assets || !checkCoverage()) return;
  pasted = true;
  applyFace();
  setFraming('head');
  selectShape('sil');
  $('avatar').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // it is below the photo on phones
};
$('takeSides').onclick = () => {
  const [next] = missingSides();
  if (!next) return;
  selectShape(next, true);
  void startCamera();
};
$('done').onclick = () => {
  const other = isSide(active) && SIDE_IDS.find(id => id !== active && shots.has(id) && !reviewed.has(id));
  if (isSide(active)) reviewed.add(active);
  selectShape(other || 'sil');
  stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
$('retake').onclick = () => {
  const id = active;
  dropShot(id);
  if (isSide(id)) applyFace();
  selectShape(id, true);
};
$('flip').onclick = flipPhoto;
$('makeVideo').onclick = () => void makeVideo();
$('saveModel').onclick = () => void saveModel();
$('clipClose').onclick = closeClip;
$<HTMLSelectElement>('backdrop').onchange = event => avatar.setBackdrop((event.target as HTMLSelectElement).value as Backdrop);
$('remove').onclick = () => void deleteAll();
$('viewBody').onclick = () => setFraming('body');
$('viewHead').onclick = () => setFraming('head');
outfitSelect.onchange = () => void selectOutfit(outfitSelect.value);
for (const control of [lookSelect, keepHair, matchSkin]) {
  control.onchange = () => {
    if (pasted) applyFace();
  };
}

addEventListener('resize', redraw);
addEventListener('pagehide', () => {
  stopCamera();
  talker.stop();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && step === 'camera') leaveCamera();
});

// --- Start --------------------------------------------------------------------------------------
async function init(): Promise<void> {
  const json = async (url: string) => (await fetch(url)).json();
  let sideProfile: SideProfile;
  [profile, outfits, sideProfile, depth] = await Promise.all([
    json('ps1_face_profile.json'), json('ps1_outfits.json'), json('ps1_side_profile.json'), loadPixels('ps1_face_depth.png')]);
  sideProfiles = { sideL: sideProfile, sideR: mirrorProfile(sideProfile) };
  sideMasks = { sideL: sideMask(sideProfiles.sideL, sideProfile.textureSize), sideR: sideMask(sideProfiles.sideR, sideProfile.textureSize) };
  mask = photoMask(profile, profile.textureSize);
  mouth = mouthMask(profile, profile.textureSize);
  outfitSelect.append(...outfits.map(o => new Option(o.label, o.id)));
  const choose = (id: ShotId) => {
    selectShape(id);
    stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  grid = new ShapeGrid($('grid'), mouthTiles(), choose);
  sideGrid = new ShapeGrid($('sideGrid'), sideTiles(), choose);
  avatar = new AvatarView($('avatar'));
  listVoices();
  void onlineVoices().then(list => {
    online = list;
    listVoices();
  });
  globalThis.speechSynthesis?.addEventListener('voiceschanged', listVoices);
  setStep('start');
  await selectOutfit(outfitSelect.value);
}
init().catch(showError);
