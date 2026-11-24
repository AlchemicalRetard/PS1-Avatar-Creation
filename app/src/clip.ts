// Makes an MP4 on this device, frame by frame, so it is smooth however slow the device is.
import { PhotoError } from './camera.ts';

const FPS = 30;
/** Seconds before and after the speech. */
const LEAD = 0.3, TAIL = 0.5;
const SAMPLE_RATE = 48_000; // not every encoder takes the voice's own rate
const VIDEO_BITRATE = 4_000_000, AUDIO_BITRATE = 128_000;

export type Shape = 'portrait' | 'square' | 'landscape';
const SHAPES: Record<Shape, [number, number]> = { portrait: [9, 16], square: [9, 9], landscape: [16, 9] };
/** Short side of the video, best first. Multiples of the retro picture's 270 pixels. */
const SIDES = [1080, 540];

export const clipSize = (shape: Shape, side: number): [number, number] => [SHAPES[shape][0] * side / 9, SHAPES[shape][1] * side / 9];

/** The voice as raw sound, also for lip timing. */
export async function decodeVoice(bytes: ArrayBuffer): Promise<AudioBuffer> {
  try {
    return await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
  } catch {
    throw new PhotoError('The online voice sent audio that could not be played. Try another voice.');
  }
}

/** The voice on one channel, with quiet before and after, as long as the video. */
async function soundtrack(voice: AudioBuffer, seconds: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE), source = context.createBufferSource();
  source.buffer = voice;
  source.connect(context.destination);
  source.start(LEAD);
  return context.startRendering();
}

/** Lets the page update and take taps. Unlike a timer, it is not slowed down in a background tab. */
const breathe = () => new Promise<void>(resolve => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close();
    resolve();
  };
  port2.postMessage(null);
});

export interface ClipJob {
  shape: Shape;
  /** Length of the speech. */
  seconds: number;
  voice: AudioBuffer | null;
  credit: string;
  /** Called once, with the size that will be used. */
  begin(width: number, height: number): void;
  /** Draws the moment `time` seconds into the speech (negative before it) and returns the picture. */
  draw(time: number): CanvasImageSource;
  /** 0 to 1 */
  onProgress(share: number): void;
  signal: AbortSignal;
}

export async function makeClip(job: ClipJob): Promise<Blob> {
  const { signal } = job;
  // Only loaded when somebody makes a video.
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, canEncodeAudio, canEncodeVideo } = await import('mediabunny');
  let size: [number, number] | null = null;
  for (const side of SIDES) {
    const [width, height] = clipSize(job.shape, side);
    if (!await canEncodeVideo('avc', { width, height, bitrate: VIDEO_BITRATE })) continue;
    size = [width, height];
    break;
  }
  if (!size) throw new PhotoError('This browser cannot make MP4 videos. Try an up-to-date Chrome, Edge or Safari.');
  if (job.voice && !await canEncodeAudio('aac', { numberOfChannels: 1, sampleRate: SAMPLE_RATE, bitrate: AUDIO_BITRATE })) {
    const { addAacEncoder } = await import('./aac.ts');
    addAacEncoder();
  }
  signal.throwIfAborted();

  const [width, height] = size, canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { alpha: false })!;
  const total = Math.ceil((LEAD + job.seconds + TAIL) * FPS), target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const picture = new CanvasSource(canvas, { codec: 'avc', bitrate: VIDEO_BITRATE, keyFrameInterval: 2 });
  output.addVideoTrack(picture, { frameRate: FPS });
  const sound = job.voice && new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE });
  if (sound) output.addAudioTrack(sound);
  output.setMetadataTags({ title: 'Talking avatar', comment: job.credit });
  try {
    job.begin(width, height);
    const track = job.voice && await soundtrack(job.voice, total / FPS);
    await output.start();
    // Awaited at the end: the two tracks are written side by side.
    const soundDone = sound && track ? sound.add(track).then(() => sound.close()) : Promise.resolve();
    soundDone.catch(() => {}); // so a failure waits for the await below
    ctx.imageSmoothingEnabled = false;
    let rested = performance.now();
    for (let frame = 0; frame < total; frame++) {
      signal.throwIfAborted();
      ctx.drawImage(job.draw(frame / FPS - LEAD), 0, 0, width, height);
      await picture.add(frame / FPS, 1 / FPS);
      if (performance.now() - rested < 30) continue;
      job.onProgress(frame / total);
      await breathe();
      rested = performance.now();
    }
    picture.close();
    await soundDone;
    signal.throwIfAborted();
    await output.finalize();
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw error;
  }
  return new Blob([target.buffer!], { type: 'video/mp4' });
}
