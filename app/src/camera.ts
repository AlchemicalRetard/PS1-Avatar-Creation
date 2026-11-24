// Camera and file input. Photos only ever live in memory on this page.

export interface Photo {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export const MIN_PHOTO_SIDE = 320;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Larger photos are shrunk: one per mouth shape is kept in memory. */
const MAX_PHOTO_SIDE = 1600;

/** An error whose message is written for the person using the app. */
export class PhotoError extends Error {}

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new PhotoError('The camera needs a secure page (https or localhost). You can upload a photo instead.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError') throw new PhotoError('Camera access was blocked. Allow it in your browser’s site settings, or upload a photo.');
    if (name === 'NotFoundError') throw new PhotoError('No camera was found. You can upload a photo instead.');
    if (name === 'NotReadableError') throw new PhotoError('Another app may be using the camera. Close it and try again, or upload a photo.');
    throw new PhotoError('The camera could not start. Try again, or upload a photo.');
  }
  try {
    video.srcObject = stream;
    await video.play();
  } catch {
    closeCamera(stream, video);
    throw new PhotoError('The camera preview could not start. Try again, or upload a photo.');
  }
  return stream;
}

export function closeCamera(stream: MediaStream | null, video: HTMLVideoElement): void {
  stream?.getTracks().forEach(track => track.stop());
  if (video.srcObject === stream) video.srcObject = null; // a newer camera may already be showing
}

/** Grabs the current frame the way other people see the person, not mirrored like the preview. */
export async function takePhoto(video: HTMLVideoElement): Promise<Photo> {
  if (!video.videoWidth) throw new PhotoError('The camera is still starting. Try again in a second.');
  const bitmap = await createImageBitmap(video);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

export async function readPhotoFile(file: File): Promise<Photo> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new PhotoError('Choose a JPEG, PNG or WebP photo.');
  if (file.size > MAX_FILE_BYTES) throw new PhotoError('That photo is larger than 20 MB. Choose a smaller one.');
  let bitmap: ImageBitmap;
  try {
    // Older Safari rejects the option but already applies the photo's orientation.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  } catch {
    throw new PhotoError('That file could not be read as a photo. Try another one.');
  }
  if (Math.min(bitmap.width, bitmap.height) < MIN_PHOTO_SIDE) {
    bitmap.close();
    throw new PhotoError(`That photo is too small. Use one at least ${MIN_PHOTO_SIDE} pixels on its short side.`);
  }
  const shrink = MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height);
  if (shrink < 1) {
    const large = bitmap;
    bitmap = await createImageBitmap(large, { resizeWidth: Math.round(large.width * shrink), resizeHeight: Math.round(large.height * shrink), resizeQuality: 'high' });
    large.close();
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
