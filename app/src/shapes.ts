// Grids of photos to take: a drawing until a photo is taken, then a thumbnail of the result.
import type { Pixels } from './types.ts';
import { SIDE_IDS, type SideId } from './sides.ts';
import { VISEMES, type MouthShape, type VisemeId } from './visemes.ts';

const SVG = 'http://www.w3.org/2000/svg';

/** A simple head in profile, with the nose on the right unless flipped. */
function profileDrawing(flipped: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-50 -32 100 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<g transform="scale(${flipped ? -1 : 1} 1)"><path class="head" d="M-8 30 L-10 18 Q-24 10 -22 -8 Q-20 -28 2 -28 Q20 -28 21 -10 L27 2 L21 5 L22 12 Q21 20 12 19 L9 30 Z"/><path class="hairline" d="M-10 18 Q-24 10 -22 -8 Q-20 -28 2 -28 Q16 -28 20 -16 Q6 -14 4 -4 L-4 -4 L-5 14 Z"/><ellipse class="ear" cx="-1" cy="2" rx="4" ry="6"/><circle class="eye" cx="15" cy="-5" r="2"/></g>`;
  return svg;
}

function mouthDrawing({ width, height, open, teeth, tongue }: MouthShape): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-50 -32 100 64');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, attributes: Record<string, string | number>, parent: Element = svg) => {
    const element = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    parent.append(element);
    return element;
  };
  const rx = width * 50, ry = height * 36;
  add('ellipse', { rx, ry, class: 'lips' });
  if (!open) {
    add('line', { x1: -rx, x2: rx, y1: 0, y2: 0, class: 'seam' });
    return svg;
  }
  const ix = rx * 0.84, iy = ry * (0.45 + open * 0.4), id = `mouth-${Math.random().toString(36).slice(2)}`;
  add('ellipse', { rx: ix, ry: iy }, add('clipPath', { id }));
  const inside = add('g', { 'clip-path': `url(#${id})` });
  add('ellipse', { rx: ix, ry: iy, class: 'inside' }, inside);
  if (tongue) add('ellipse', { cy: iy * 0.75, rx: ix * 0.6, ry: iy * 0.65, class: 'tongue' }, inside);
  if (teeth) add('rect', { x: -ix, y: -iy, width: ix * 2, height: teeth === 'both' ? iy * 0.95 : iy * 0.6, class: 'teeth' }, inside);
  if (teeth === 'both') add('rect', { x: -ix, y: iy * 0.05, width: ix * 2, height: iy, class: 'teeth' }, inside);
  return svg;
}

/** The part of the texture shown in thumbnails (UV). */
interface Crop { u: number; v: number; width: number; height: number }
export interface TileSpec<Id extends string> { id: Id; label: string; title: string; drawing: SVGSVGElement; crop: Crop }
interface Tile { button: HTMLButtonElement; canvas: HTMLCanvasElement; drawing: SVGSVGElement; crop: Crop }

export const mouthTiles = (): TileSpec<VisemeId>[] => VISEMES.map(({ id, sounds, say, mouth }) => ({
  id, label: sounds, title: id === 'sil' ? 'Neutral face' : `Say ${say}`, drawing: mouthDrawing(mouth), crop: { u: 0.16, v: 0.68, width: 0.68, height: 0.3 },
}));

export const sideTiles = (): TileSpec<SideId>[] => SIDE_IDS.map(id => ({
  id,
  label: id === 'sideL' ? 'Right cheek' : 'Left cheek',
  title: id === 'sideL' ? 'Turn your head to your left' : 'Turn your head to your right',
  drawing: profileDrawing(id === 'sideR'),
  crop: { u: id === 'sideL' ? 0.17 : 0.23, v: 0.04, width: 0.6, height: 0.9 },
}));

export class ShapeGrid<Id extends string> {
  private tiles = new Map<Id, Tile>();

  constructor(host: HTMLElement, specs: TileSpec<Id>[], onSelect: (id: Id) => void) {
    for (const { id, label: text, title, drawing, crop } of specs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tile';
      button.dataset.viseme = id;
      const canvas = document.createElement('canvas'), label = document.createElement('span');
      canvas.hidden = true;
      label.textContent = text;
      button.title = title;
      button.append(drawing, canvas, label);
      button.onclick = () => onSelect(id);
      host.append(button);
      this.tiles.set(id, { button, canvas, drawing, crop });
    }
  }

  /** Shows the finished face's mouth, or the drawing again when `face` is null. */
  setThumbnail(id: Id, face: Pixels | null): void {
    const { button, canvas, drawing, crop } = this.tiles.get(id)!;
    button.classList.toggle('taken', !!face);
    canvas.hidden = !face;
    drawing.toggleAttribute('hidden', !!face);
    if (!face) {
      canvas.width = canvas.height = 1; // drop the pixels
      return;
    }
    const x = Math.round(crop.u * face.width), y = Math.round(crop.v * face.height);
    canvas.width = Math.round(crop.width * face.width);
    canvas.height = Math.round(crop.height * face.height);
    const image = new ImageData(new Uint8ClampedArray(face.data), face.width, face.height);
    canvas.getContext('2d')!.putImageData(image, -x, -y);
  }

  setActive(id: string): void {
    for (const [key, { button }] of this.tiles) button.setAttribute('aria-pressed', String(key === id));
  }

  setSpeaking(id: string | null): void {
    for (const [key, { button }] of this.tiles) button.classList.toggle('speaking', key === id);
  }
}
