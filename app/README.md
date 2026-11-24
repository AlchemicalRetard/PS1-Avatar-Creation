# Face-to-avatar app

Take or upload a face photo, line it up with the blueprint, paste it onto the avatar, add mouth shapes, and make it talk.

```sh
npm install
npm run dev        # http://localhost:5179
npm test           # model checks, photo logic and speech logic
npm run build:app  # type-check and build to dist/
```

## Flow

1. **Camera** (or upload): the live view is mirrored; the captured photo is not. The camera is switched off after the neutral photo, when closed, and when the page is hidden.
2. **Align:** drag, pinch or scroll to place the photo, with sliders for zoom, tilt and width. Arrow keys and `+`/`-` work when the photo has focus. The neutral photo is aligned by hand; automatic landmarks are not built yet.
3. **Paste:** the photo inside the yellow oval becomes the `Face_Photo` texture. Its edges fade into a skin tone measured from the cheeks and forehead, and the same tone recolors the avatar's neck and hands.
4. **Sides of the head:** two profile photos, with a 5-second countdown and beeps because the screen cannot be seen while turned. One photo is enough; the other side starts as a mirrored copy that can be adjusted on its own. "Flip photo" fixes mirrored selfies. Adding the first side turns off "Avatar's hair", since painted hair would cover most of it.
5. **Mouth shapes:** one photo per shape. "Take the missing ones" keeps the camera open and steps through them; any tile can also be taken, uploaded, adjusted or retaken on its own.
6. **Talk:** type a sentence and press Speak.

Steps in code: `start → camera → align → pasted`, plus `shape` (a mouth shape or side is selected, no photo) and `adjust` (selected, has a photo).

## Sides of the head

Each side of the head has its own 128×128 texture, projected straight from the side over the same height range as the face. `ps1_side_profile.json` holds the profile guide, and `ps1_face_depth.png` says which column of the side texture lies under each face texel, so the front photo fades into the side photos around the curve of the cheek. Side photos are matched to the front photo's skin color, and with "Avatar's hair" off the painted hair takes the color above the ear.

## Looks

"Retro" (64 texels tall) and "Chunky" (44) turn photos into low-resolution textures with square pixels. Photos are sharpened before being reduced so eyes, brows and lips survive, contrast is added around the person's skin tone so the face still matches the neck, and brightness is reduced to a few dithered steps. Painted skin and cloth get matching grain. "Smooth photo" skips all of this.

## Background

"Retro room" is an original scene built in code (`room.ts`), rendered at 240 lines with bloom, a vignette, light grain, 15-bit dithering and wobbly vertices (`avatar.ts`). "Plain" shows the avatar at full resolution. Bulb and lamp flicker stop when the system asks for reduced motion.

## Mouth shapes

A reduced set of 7 shapes, so users take the neutral face plus 6 photos. Sounds that look alike on a low-resolution face share a shape.

| Shape | Sounds |
|---|---|
| `sil` (the neutral face) | rest, P B M |
| `FF` | F V |
| `aa` | AH AE |
| `E` | EH, schwa, T D K G N NG L TH |
| `I` | EE IH Y S Z |
| `O` | OH AW |
| `U` | OO W R ER CH J SH ZH |

- Diphthongs use two shapes in turn, for example "eye" is `aa` then `I`.
- A shape without a photo falls back to the closest one taken (`visemes.ts`).
- Only the mouth area changes between shapes; eyes, hair and skin always come from the neutral photo. Each photo is color matched at the edge of that area.
- Each new photo is shifted to line its eyes and nose up with the neutral photo. This corrects movement, not a change in distance or head tilt; adjust those by hand.

## Speech

There are two kinds of voice, plus "No sound", which plays the movement silently.

- **On this device:** the browser's `speechSynthesis`, limited to English voices installed on the device. Nothing is sent anywhere.
- **Online (SpeechMa):** listed only when the server has a key. The typed text goes to SpeechMa through this app's server.

### Setting up online voices

1. Get an API key from SpeechMa (a paid plan): <https://speechma.com/api/>
2. Copy `.env.example` to `.env` in the project root and paste the key there. Git ignores `.env`; never put the key in `app/`.
3. Restart `npm run dev` or `npm run serve`.

`tools/lib/speech_proxy.js` keeps the key on the server and limits spending: 500 characters per request, 20,000 characters and 400 requests a day, 80 requests an hour, 30 an hour per visitor. The counts are kept in memory, so they restart with the server; change them in `DEFAULT_LIMITS`. Repeats within 10 minutes are served from memory. Text and key are never logged. Anyone who can open the app can use the voices within these limits.

SpeechMa returns audio without word times, so `align.ts` finds the pauses in the recording, matches them to the punctuation and shares the time between them out over the words. The mouth also rests whenever the audio is silent. HD voices ignore the speed setting.

To change the set, edit `visemes.ts`; the grid, capture order and talking follow it.

`g2p.ts` turns English spelling into phonemes with rules and a list of irregular words. It only picks mouth shapes; the voice does its own pronunciation. Voices report when words start but not phonemes, so `lipsync.ts` re-anchors on each word and estimates the timing inside it, learning the voice's pace as it goes.

## Downloads

**Make a video (MP4)** renders the sentence frame by frame on the device (`clip.ts`, with the [Mediabunny](https://mediabunny.dev) library) as H.264 and AAC, 1080 pixels on the short side, or 540 if the device cannot encode that. It uses the current view, outfit, look and background. Online voices are included; a device voice cannot be, because browsers give pages no access to its sound, so those videos are silent. Browsers without AAC encoding load one when needed (`aac.ts`). Needs WebCodecs: current Chrome, Edge and Safari, and desktop Firefox.

**Download 3D model (GLB)** is the outfit's own rigged GLB with the finished textures put in (`glb.ts`): neutral face, sides, body. Mouth shapes are not included.

Both carry the credit for the base model, which its CC BY 4.0 license requires: in the GLB's `asset.copyright`, and in the MP4's comment. Anyone posting a video should credit it too. Mediabunny is MPL-2.0; its AAC encoder contains FFmpeg code under the LGPL (notices in `node_modules/@mediabunny/aac-encoder/licenses`).

## Publishing

`.github/workflows/pages.yml` tests, builds and publishes to GitHub Pages on every push to `main`. Turn it on once per repository: Settings > Pages > Source: GitHub Actions. All paths are relative, so `dist/` also works in any folder of any static host. Online voices need the server (`npm run serve`), so a static host offers device voices only.

## Privacy

Photos stay in memory on the page. They are not uploaded, stored or logged (a downloaded video or model, which shows the face, is the only thing saved), and the Content Security Policy blocks the page from contacting other servers. With an online voice, the typed text (only) is sent to SpeechMa; the page says so when one is selected. "Delete all photos and start over" discards them and restores the original textures; reloading or closing the tab does too, so mouth shapes have to be taken again.

## Where things are

| File | Job |
|---|---|
| `src/alignment.ts` | Photo placement and blueprint geometry (pure) |
| `src/texture.ts` | Masking, skin tone, retro look, skin recoloring (pure) |
| `src/mouth.ts` | Mouth blending and auto-alignment between photos (pure) |
| `src/sides.ts` | Side photos: masks, color matching, wrapping (pure) |
| `src/room.ts` | The background room |
| `src/visemes.ts`, `src/g2p.ts`, `src/lipsync.ts` | Shapes, text to phonemes, timing (pure) |
| `src/talk.ts` | Voices and playback |
| `src/online.ts`, `src/align.ts` | Online voices; timing words from audio (pure) |
| `../tools/lib/speech_proxy.js` | Server side of online voices |
| `src/shapes.ts` | Photo grids |
| `src/blueprint.ts` | Draws the guide from `ps1_face_profile.json` |
| `src/camera.ts` | Camera and file input, with user-facing errors |
| `src/avatar.ts` | three.js preview, retro effects and texture replacement |
| `src/main.ts` | Steps and controls |

Assets come from `../assets` (built by `npm run build`). Browsers only allow the camera on `localhost` or HTTPS, so testing on a phone needs an HTTPS address.
