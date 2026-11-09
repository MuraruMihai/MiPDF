import {
  AlignmentType, Document, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak, Paragraph, TextRun,
} from 'docx';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { loadPdf } from './pdfjs';

interface Piece { str: string; x: number; y: number; w: number; size: number; bold: boolean; italic: boolean }
interface Line { pieces: Piece[]; y: number; x0: number; x1: number; size: number }

const BULLET = /^\s*([•●▪■◦‣∙·–\-*])\s+/;
const NUMBERED = /^\s*(\d{1,3}|[a-z])[.)]\s+/;

/**
 * PDF → Word, entirely local: text with positions from pdf.js → lines → paragraphs,
 * with headings, bold/italic, bullets and alignment reconstructed. Pages without text
 * (scans) are kept as an image of the page.
 */
export async function pdfToWord(bytes: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const pdf = await loadPdf(bytes);
  const pages: { lines: Line[]; width: number; height: number; image?: Uint8Array }[] = [];
  const sizeHist = new Map<number, number>();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    await page.getOperatorList(); // makes real font names available in commonObjs
    const tc = await page.getTextContent();
    const pieces: Piece[] = [];
    for (const it of tc.items as TextItem[]) {
      if (!('str' in it) || !it.str) continue;
      const [a, b, , , e, f] = it.transform;
      if (Math.abs(b) > 0.01 * Math.abs(a)) continue; // rotated text
      const size = Math.round(Math.hypot(a, b) * 2) / 2;
      if (size < 1) continue;
      let fontName = '';
      try { fontName = (page.commonObjs.get(it.fontName) as { name?: string })?.name || ''; } catch { /* not loaded */ }
      const style = (tc.styles as Record<string, { fontFamily?: string }>)[it.fontName]?.fontFamily || '';
      const n = fontName + ' ' + style;
      const [x, y] = vp.convertToViewportPoint(e, f);
      pieces.push({
        str: it.str, x, y, w: it.width, size,
        bold: /bold|black|heavy|semibold|demi/i.test(n),
        italic: /italic|oblique/i.test(n),
      });
      if (it.str.trim()) sizeHist.set(size, (sizeHist.get(size) || 0) + it.str.length);
    }
    const lines = groupLines(pieces);
    let image: Uint8Array | undefined;
    if (pieces.reduce((s, p) => s + p.str.trim().length, 0) < 15) image = await renderPage(page);
    pages.push({ lines, width: vp.width, height: vp.height, image });
    page.cleanup();
    onProgress?.(p, pdf.numPages);
  }

  const body = [...sizeHist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const children: Paragraph[] = [];

  pages.forEach((pg, pi) => {
    if (pi > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    if (pg.image) {
      const maxW = (pg.width - 72) * (96 / 72);
      const ratio = pg.height / pg.width;
      children.push(new Paragraph({
        children: [new ImageRun({ type: 'png', data: pg.image, transformation: { width: maxW, height: maxW * ratio } })],
      }));
      return;
    }
    for (const para of groupParagraphs(pg.lines, body)) children.push(toParagraph(para, body, pg.width));
  });

  const first = pages[0] || { width: 595, height: 842 };
  const doc = new Document({
    creator: 'MiPDF',
    styles: { default: { document: { run: { font: 'Calibri', size: Math.round(body * 2) } } } },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: Math.round(first.width * 20), height: Math.round(first.height * 20) },
          margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 },
        },
      },
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  await pdf.destroy();
  return new Uint8Array(await blob.arrayBuffer());
}

function groupLines(pieces: Piece[]): Line[] {
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l.y - p.y) < Math.max(l.size, p.size) * 0.45);
    if (line) {
      line.pieces.push(p);
      line.size = Math.max(line.size, p.size);
    } else lines.push({ pieces: [p], y: p.y, x0: 0, x1: 0, size: p.size });
  }
  for (const l of lines) {
    l.pieces.sort((a, b) => a.x - b.x);
    l.x0 = l.pieces[0].x;
    const last = l.pieces[l.pieces.length - 1];
    l.x1 = last.x + last.w;
    // Insert spaces where pdf.js left gaps between pieces.
    for (let i = 1; i < l.pieces.length; i++) {
      const prev = l.pieces[i - 1];
      const cur = l.pieces[i];
      const gap = cur.x - (prev.x + prev.w);
      if (gap > cur.size * 0.18 && !/\s$/.test(prev.str) && !/^\s/.test(cur.str)) cur.str = ' ' + cur.str;
    }
  }
  return lines.filter((l) => l.pieces.some((p) => p.str.trim())).sort((a, b) => a.y - b.y);
}

interface Para { lines: Line[]; size: number; bullet: boolean }

function groupParagraphs(lines: Line[], body: number): Para[] {
  const out: Para[] = [];
  let cur: Para | null = null;
  let prev: Line | null = null;
  for (const l of lines) {
    const text = lineText(l);
    const bullet = BULLET.test(text);
    const numbered = NUMBERED.test(text);
    const gap = prev ? l.y - prev.y : 0;
    const newPara =
      !cur || !prev ||
      bullet || numbered ||
      Math.abs(l.size - cur.size) > 0.6 ||
      gap > Math.max(l.size, prev.size) * 1.75 ||
      gap < 0 ||
      // previous line ended well before the right edge → it closed a paragraph
      (prev.x1 < maxRight(cur) - body * 4 && /[.:!?;]\s*$/.test(lineText(prev))) ||
      l.size > body * 1.12;
    if (newPara) {
      cur = { lines: [l], size: l.size, bullet };
      out.push(cur);
    } else cur!.lines.push(l);
    prev = l;
  }
  return out;
}

const maxRight = (p: Para) => Math.max(...p.lines.map((l) => l.x1));
const lineText = (l: Line) => l.pieces.map((p) => p.str).join('');

function toParagraph(para: Para, body: number, pageWidth: number): Paragraph {
  const isHeading = para.size >= body * 1.12;
  const specs: { text: string; bold: boolean; italic: boolean; size: number }[] = [];
  para.lines.forEach((l, li) => {
    l.pieces.forEach((p, pi) => {
      let s = p.str;
      if (li === 0 && pi === 0 && para.bullet) s = s.replace(BULLET, '');
      if (pi === 0 && li > 0) {
        const prev = specs[specs.length - 1];
        if (prev && prev.text.endsWith('-') && /^\s*\p{Ll}/u.test(s)) {
          prev.text = prev.text.slice(0, -1); // re-join a hyphenated word
          s = s.replace(/^\s+/, '');
        } else s = ' ' + s.replace(/^\s+/, '');
      }
      if (!s) return;
      const last = specs[specs.length - 1];
      if (last && last.bold === p.bold && last.italic === p.italic && last.size === p.size) last.text += s;
      else specs.push({ text: s, bold: p.bold, italic: p.italic, size: p.size });
    });
  });
  const runs = specs.map((r) => new TextRun({
    text: r.text, bold: r.bold || undefined, italics: r.italic || undefined,
    size: isHeading ? undefined : sizeHalfPts(r.size, body),
  }));
  const x0 = Math.min(...para.lines.map((l) => l.x0));
  const x1 = maxRight(para);
  const centered = Math.abs(x0 - (pageWidth - x1)) < 24 && x0 > pageWidth * 0.18;
  const heading = para.size >= body * 1.6 ? HeadingLevel.HEADING_1
    : para.size >= body * 1.3 ? HeadingLevel.HEADING_2
    : isHeading ? HeadingLevel.HEADING_3 : undefined;
  return new Paragraph({
    children: runs,
    heading,
    alignment: centered ? AlignmentType.CENTER : undefined,
    numbering: para.bullet ? { reference: 'bullets', level: 0 } : undefined,
    spacing: { after: 120 },
  });
}

function sizeHalfPts(size: number, body: number) {
  return Math.abs(size - body) < 0.6 ? undefined : Math.round(size * 2);
}

async function renderPage(page: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdf>>['getPage']>>): Promise<Uint8Array> {
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
