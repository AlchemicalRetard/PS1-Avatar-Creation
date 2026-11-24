// Draws the face blueprint guide in stage units.
import { STAGE, faceBox, uvToStage } from './alignment.ts';
import type { FaceProfile, Point, SideProfile } from './types.ts';

/** `mouth: false` hides the closed-mouth guide, for photos of other mouth shapes. */
export function drawBlueprint(ctx: CanvasRenderingContext2D, profile: FaceProfile, { mouth = true } = {}): void {
  const box = faceBox(profile), at = (p: Point) => uvToStage(p, box), L = profile.landmarksUv;
  const polygon = (points: Point[]) => {
    const path = new Path2D();
    points.map(at).forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    return path;
  };
  const oval = polygon(profile.ovalUv), panel = polygon(profile.outlineUv);

  // Dim everything outside the face.
  const shade = new Path2D();
  shade.rect(0, 0, STAGE.width, STAGE.height);
  shade.addPath(oval);
  ctx.save();
  ctx.fillStyle = 'rgba(16, 20, 34, 0.55)';
  ctx.fill(shade, 'evenodd');

  const [lx, eyeY] = at(L.eyeViewerLeft), [rx] = at(L.eyeViewerRight);
  const [noseX, noseY] = at(L.noseTip), [mouthX, mouthY] = at(L.mouth), [, hairY] = at(L.hairline);
  const guides = new Path2D();
  for (const x of [lx, rx]) {
    guides.moveTo(x + 36, eyeY);
    guides.ellipse(x, eyeY, 36, 18, 0, 0, Math.PI * 2);
    guides.moveTo(x + 5, eyeY);
    guides.arc(x, eyeY, 5, 0, Math.PI * 2);
  }
  guides.moveTo(noseX - 22, noseY - 10);
  guides.quadraticCurveTo(noseX, noseY + 14, noseX + 22, noseY - 10);
  if (mouth) {
    guides.moveTo(mouthX - 48, mouthY);
    guides.quadraticCurveTo(mouthX, mouthY + 20, mouthX + 48, mouthY);
    guides.quadraticCurveTo(mouthX, mouthY - 20, mouthX - 48, mouthY);
  }
  const center = new Path2D();
  center.moveTo(noseX, hairY);
  center.lineTo(noseX, noseY - 24);
  center.moveTo(box.x + box.width * 0.08, eyeY);
  center.lineTo(box.x + box.width * 0.92, eyeY);
  center.moveTo(box.x + box.width * 0.12, hairY);
  center.lineTo(box.x + box.width * 0.88, hairY);

  // Dark underlay keeps the lines readable over any skin tone or background.
  const stroke = (path: Path2D, color: string, width: number, dash: number[] = []) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = 'rgba(16, 20, 34, 0.7)';
    ctx.lineWidth = width + 2;
    ctx.stroke(path);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(path);
  };
  stroke(panel, 'rgba(255, 209, 102, 0.45)', 1.5, [4, 6]);
  stroke(oval, '#ffd166', 3);
  stroke(guides, '#7fe7dc', 2.5);
  stroke(center, 'rgba(127, 231, 220, 0.75)', 1.5, [8, 8]);

  ctx.setLineDash([]);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd166';
  for (const [text, y] of [['Hairline', hairY], ['Eyes', eyeY], ['Mouth', mouthY], ['Chin', at(L.chin)[1]]] as const) {
    ctx.fillText(text, box.x + box.width + 16, y);
  }
  ctx.restore();
}

/** The head in profile. Pass a mirrored profile for the other side, or for the mirrored live view. */
export function drawSideBlueprint(ctx: CanvasRenderingContext2D, profile: SideProfile): void {
  const box = faceBox(profile), at = (p: Point) => uvToStage(p, box), L = profile.landmarksUv;
  const polygon = (points: Point[]) => {
    const path = new Path2D();
    points.map(at).forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    path.closePath();
    return path;
  };
  const head = polygon(profile.silhouetteUv), panel = polygon(profile.outlineUv), shade = new Path2D();
  shade.rect(0, 0, STAGE.width, STAGE.height);
  shade.addPath(head);
  ctx.save();
  ctx.fillStyle = 'rgba(16, 20, 34, 0.45)';
  ctx.fill(shade, 'evenodd');

  const guides = new Path2D(), [earX, earY] = at(L.ear), [eyeX, eyeY] = at(L.eye), [noseX, noseY] = at(L.noseTip), [mouthX, mouthY] = at(L.mouth);
  const forward = Math.sign(L.eye[0] - L.ear[0]);
  guides.ellipse(earX, earY, 26, 46, forward * -0.15, 0, Math.PI * 2);
  guides.moveTo(eyeX + forward * 18, eyeY - 12);
  guides.lineTo(eyeX - forward * 14, eyeY);
  guides.lineTo(eyeX + forward * 18, eyeY + 10);
  guides.moveTo(noseX - forward * 4, noseY - 44);
  guides.lineTo(noseX + forward * 30, noseY);
  guides.lineTo(noseX - forward * 4, noseY + 8);
  guides.moveTo(mouthX + forward * 8, mouthY);
  guides.lineTo(mouthX - forward * 34, mouthY);

  const stroke = (path: Path2D, color: string, width: number, dash: number[] = []) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = 'rgba(16, 20, 34, 0.7)';
    ctx.lineWidth = width + 2;
    ctx.stroke(path);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(path);
  };
  stroke(panel, 'rgba(255, 209, 102, 0.55)', 1.5, [4, 6]);
  stroke(head, '#ffd166', 3);
  stroke(guides, '#7fe7dc', 2.5);
  ctx.setLineDash([]);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd166';
  ctx.fillText('Ear', earX, earY);
  ctx.restore();
}
