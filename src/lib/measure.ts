import type { TextObj } from './model';
import { LINE_HEIGHT } from './exportPdf';

let ctx: CanvasRenderingContext2D | null = null;
export function measureText(o: Pick<TextObj, 'text' | 'size' | 'bold' | 'italic'>) {
  ctx ||= document.createElement('canvas').getContext('2d')!;
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 700 : 400} ${o.size}px "MiPDF Sans", Arial, sans-serif`;
  const lines = (o.text || ' ').split('\n');
  const w = Math.max(...lines.map((l) => ctx!.measureText(l || ' ').width));
  return { w: Math.max(w, o.size * 0.5), h: lines.length * o.size * LINE_HEIGHT };
}
