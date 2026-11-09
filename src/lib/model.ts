import type { PDFDoc } from './pdfjs';

/** A source PDF loaded into the session (the opened file, or one inserted/merged). */
export interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDoc;
}

/** A page in the working document, pointing back to its source page. */
export interface PageRef {
  id: string;
  doc: string; // SourceDoc id
  index: number; // page index in the source
  width: number; // unrotated size in PDF points
  height: number;
  baseRotation: number; // /Rotate already in the file
  rotation: number; // rotation added by the user (0, 90, 180, 270)
}

export type Tool = 'select' | 'text' | 'edittext' | 'highlight' | 'ink' | 'rect' | 'whiteout' | 'image' | 'sign';

interface Base {
  id: string;
  page: string; // PageRef id
  // Unrotated page space, PDF points, origin top-left.
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TextObj extends Base { type: 'text'; text: string; size: number; color: string; bold: boolean; italic: boolean; coverId?: string }
export interface RectObj extends Base { type: 'rect'; color: string; stroke: number }
export interface HighlightObj extends Base { type: 'highlight'; color: string }
export interface WhiteoutObj extends Base { type: 'whiteout' }
export interface InkObj extends Base { type: 'ink'; points: number[][][]; vw: number; vh: number; color: string; stroke: number } // points in a vw×vh box, scaled to w×h
export interface ImageObj extends Base { type: 'image'; src: string; signature?: boolean } // PNG/JPEG data URL

export type Obj = TextObj | RectObj | HighlightObj | WhiteoutObj | InkObj | ImageObj;

export interface DocState {
  pages: PageRef[];
  objects: Obj[];
}

let n = 0;
export const uid = (p = 'o') => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

export function displayRotation(p: PageRef) {
  return (((p.baseRotation + p.rotation) % 360) + 360) % 360;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
