// Online voices, through this app's own server. The text to speak is sent to SpeechMa; nothing else is.
import { PhotoError } from './camera.ts';

export interface OnlineVoice { id: string; name: string; locale: string; gender: string; hd: boolean }

/** Empty when online voices are not set up or cannot be reached. */
export async function onlineVoices(): Promise<OnlineVoice[]> {
  try {
    const response = await fetch('api/speech/voices');
    if (!response.ok) return [];
    const body = await response.json();
    return body.available && Array.isArray(body.voices) ? body.voices : [];
  } catch {
    return [];
  }
}

/** Speed is 1 for normal; SpeechMa counts in percent either side of 0. */
export async function fetchSpeech(text: string, voice: string, speed: number, signal: AbortSignal): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch('api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate: Math.round((speed - 1) * 100) }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PhotoError('The online voice could not be reached. Check your connection, or use a device voice.');
  }
  if (response.ok) return response.arrayBuffer();
  const message = await response.json().then(b => b?.error, () => null);
  throw new PhotoError(typeof message === 'string' ? message : 'The online voice did not answer. Try again, or use a device voice.');
}
