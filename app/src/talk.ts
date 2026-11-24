// Speaks text with an on-device or online voice and reports which mouth shape to show.
import { AudioSync } from './align.ts';
import { PhotoError } from './camera.ts';
import { LipSync, buildTimeline } from './lipsync.ts';
import type { VisemeId } from './visemes.ts';

/** Only voices that run on this device: network voices would send the text to a server. */
export function localVoices(): SpeechSynthesisVoice[] {
  const local = (globalThis.speechSynthesis?.getVoices() ?? []).filter(v => v.localService);
  return local.filter(v => /^en\b/i.test(v.lang.replace('_', '-')));
}

export interface TalkEvents {
  onViseme(id: VisemeId): void;
  /** The voice is now audible. */
  onStart(): void;
  onEnd(error?: string): void;
}

const START_TIMEOUT = 5000;
/** Gap between a voice's start event and its first word. A word event ends it early. */
const VOICE_LEAD = 200;

export class Talker {
  private session = 0;
  private timer = 0;
  private abort: AbortController | null = null;
  private source: AudioBufferSourceNode | null = null;
  private events: TalkEvents;
  talking = false;

  constructor(events: TalkEvents) {
    this.events = events;
  }

  /** With no voice, plays the mouth movement silently. Returns false if there is nothing to say. */
  speak(text: string, voice: SpeechSynthesisVoice | null, rate: number): boolean {
    this.stop();
    const words = buildTimeline(text);
    if (!words.length) return false;
    const session = ++this.session, sync = new LipSync(words, rate), live = () => session === this.session;
    this.talking = true;

    const animate = (until = Infinity) => {
      const frame = (now: number) => {
        if (!live()) return;
        if (now >= until) return this.finish();
        this.events.onViseme(sync.visemeAt(now));
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };

    if (!voice) {
      const now = performance.now();
      sync.start(now);
      this.events.onStart();
      animate(now + sync.duration() + 150);
      return true;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    this.timer = window.setTimeout(() => {
      if (live()) this.finish('The voice did not start. Try another voice.');
    }, START_TIMEOUT);
    utterance.onstart = () => {
      if (!live()) return;
      clearTimeout(this.timer);
      sync.start(performance.now(), VOICE_LEAD);
      this.events.onStart();
      animate();
    };
    utterance.onboundary = event => {
      if (live() && event.name === 'word') sync.boundary(event.charIndex, performance.now());
    };
    utterance.onend = () => {
      if (live()) this.finish();
    };
    utterance.onerror = event => {
      if (live()) this.finish(event.error === 'canceled' || event.error === 'interrupted' ? undefined : 'The voice could not play. Try another voice.');
    };
    speechSynthesis.speak(utterance);
    return true;
  }

  /** Plays fetched audio. `context` must already be unlocked by a tap. Returns false if there is nothing to say. */
  speakAudio(text: string, context: AudioContext, load: (signal: AbortSignal) => Promise<ArrayBuffer>): boolean {
    this.stop();
    const words = buildTimeline(text);
    if (!words.length) return false;
    const session = ++this.session, live = () => session === this.session, abort = this.abort = new AbortController();
    this.talking = true;
    void (async () => {
      try {
        const bytes = await load(abort.signal);
        if (!live()) return;
        const audio = await context.decodeAudioData(bytes).catch(() => {
          throw new PhotoError('The online voice sent audio that could not be played. Try another voice.');
        });
        await context.resume();
        if (!live()) return;
        const sync = new AudioSync(words, audio.getChannelData(0), audio.sampleRate), source = context.createBufferSource();
        source.buffer = audio;
        source.connect(context.destination);
        source.onended = () => {
          if (live()) this.finish();
        };
        const begin = context.currentTime + 0.05, delay = context.outputLatency || context.baseLatency || 0;
        source.start(begin);
        this.source = source;
        this.events.onStart();
        const frame = () => {
          if (!live()) return;
          this.events.onViseme(sync.visemeAt(context.currentTime - begin - delay));
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      } catch (error) {
        if (live()) this.finish(error instanceof PhotoError ? error.message : 'The online voice could not play. Try again, or use a device voice.');
      }
    })();
    return true;
  }

  stop(): void {
    if (this.talking) this.finish();
  }

  private finish(error?: string): void {
    this.session++; // silences every callback of the old session
    clearTimeout(this.timer);
    this.talking = false;
    this.abort?.abort();
    this.abort = null;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    globalThis.speechSynthesis?.cancel();
    this.events.onViseme('sil');
    this.events.onEnd(error);
  }
}
