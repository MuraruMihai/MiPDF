import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fontBytes, dataUrlToBytes } from './fonts';

// Word → PDF, local: mammoth reads the .docx into semantic HTML (headings, lists, tables,
// images, bold/italic); a small layout engine then typesets it onto A4 pages with pdf-lib.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 64; // margins
const CONTENT_W = PAGE_W - 2 * M;

interface Run { text: string; bold: boolean; italic: boolean; underline: boolean; link?: string; br?: boolean }
type Block =
  | { kind: 'para'; runs: Run[]; size: number; bold: boolean; before: number; after: number; indent: number; marker?: string }
  | { kind: 'image'; src: string }
  | { kind: 'table'; rows: Run[][][] }
  | { kind: 'hr' };

const HEADING: Record<string, [number, number]> = { H1: [22, 14], H2: [17, 12], H3: [14, 10], H4: [12.5, 8], H5: [11.5, 6], H6: [11, 6] };
const BODY = 11;

export async function wordToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const mammoth = (await import('mammoth')).default;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer, buffer: bytes } as unknown as { arrayBuffer: ArrayBuffer });
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: Block[] = [];
  collectBlocks(dom.body, blocks, 0);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  pdf.setProducer('MiPDF');
  pdf.setCreationDate(new Date());
  const F = {
    regular: await pdf.embedFont(await fontBytes('regular'), { subset: true }),
    bold: await pdf.embedFont(await fontBytes('bold'), { subset: true }),
    italic: await pdf.embedFont(await fontBytes('italic'), { subset: true }),
    boldItalic: await pdf.embedFont(await fontBytes('boldItalic'), { subset: true }),
  };
  const fontOf = (r: Run, blockBold = false) => {
    const b = r.bold || blockBold;
    return b && r.italic ? F.boldItalic : b ? F.bold : r.italic ? F.italic : F.regular;
  };

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = M; // distance from top
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = M; };
  const ensure = (h: number) => { if (y + h > PAGE_H - M && y > M) newPage(); };

  for (const block of blocks) {
    if (block.kind === 'hr') {
      ensure(12);
      page.drawLine({ start: { x: M, y: PAGE_H - y - 6 }, end: { x: PAGE_W - M, y: PAGE_H - y - 6 }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) });
      y += 12;
      continue;
    }
    if (block.kind === 'image') {
      const img = await embedImage(pdf, block.src);
      if (!img) continue;
      let w = img.width * 0.75;
      let h = img.height * 0.75;
      const maxH = PAGE_H - 2 * M;
      const s = Math.min(1, CONTENT_W / w, maxH / h);
      w *= s; h *= s;
      ensure(h);
      page.drawImage(img, { x: M, y: PAGE_H - y - h, width: w, height: h });
      y += h + 8;
      continue;
    }
    if (block.kind === 'table') {
      y = drawTable(block.rows, () => page, newPage, () => y, fontOf);
      y += 10;
      continue;
    }
    // Paragraph
    y += block.before;
    const x0 = M + block.indent;
    const width = CONTENT_W - block.indent;
    const lines = wrap(block.runs, width, block.size, (r) => fontOf(r, block.bold));
    const lh = block.size * 1.35;
    lines.forEach((line, i) => {
      ensure(lh);
      if (i === 0 && block.marker) {
        page.drawText(block.marker, { x: x0 - 14, y: PAGE_H - y - block.size, size: block.size, font: F.regular });
      }
      let x = x0;
      for (const seg of line) {
        const font = fontOf(seg, block.bold);
        const color = seg.link ? rgb(0.1, 0.35, 0.8) : rgb(0.08, 0.08, 0.1);
        page.drawText(seg.text, { x, y: PAGE_H - y - block.size, size: block.size, font, color });
        const w = font.widthOfTextAtSize(seg.text, block.size);
        if (seg.underline || seg.link) {
          page.drawLine({ start: { x, y: PAGE_H - y - block.size - 1.5 }, end: { x: x + w, y: PAGE_H - y - block.size - 1.5 }, thickness: 0.5, color });
        }
        x += w;
      }
      y += lh;
    });
    if (!lines.length) y += lh;
    y += block.after;
  }
  pdf.setModificationDate(new Date());
  return pdf.save();
}

function collectBlocks(root: Element, out: Block[], depth: number) {
  for (const el of Array.from(root.children)) {
    const tag = el.tagName;
    if (HEADING[tag]) {
      const [size, before] = HEADING[tag];
      out.push({ kind: 'para', runs: inlineRuns(el), size, bold: true, before, after: 4, indent: 0 });
    } else if (tag === 'P') {
      const imgs = el.querySelectorAll('img');
      const runs = inlineRuns(el);
      if (runs.some((r) => r.text.trim()) || !imgs.length) out.push({ kind: 'para', runs, size: BODY, bold: false, before: 0, after: 7, indent: 0 });
      imgs.forEach((img) => out.push({ kind: 'image', src: img.getAttribute('src') || '' }));
    } else if (tag === 'UL' || tag === 'OL') {
      let n = 1;
      for (const li of Array.from(el.children)) {
        if (li.tagName !== 'LI') continue;
        const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        const clone = li.cloneNode(true) as Element;
        clone.querySelectorAll(':scope > ul, :scope > ol').forEach((c) => c.remove());
        out.push({
          kind: 'para', runs: inlineRuns(clone), size: BODY, bold: false, before: 0, after: 3,
          indent: 22 + depth * 18, marker: tag === 'OL' ? `${n++}.` : depth % 2 ? '◦' : '•',
        });
        for (const sub of nested) collectBlocks(wrapEl(sub), out, depth + 1);
      }
      out.push({ kind: 'para', runs: [], size: 4, bold: false, before: 0, after: 0, indent: 0 });
    } else if (tag === 'TABLE') {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map((td) => {
          const r = inlineRuns(td);
          if (td.tagName === 'TH') r.forEach((x) => (x.bold = true));
          return r;
        }));
      if (rows.length) out.push({ kind: 'table', rows });
    } else if (tag === 'HR') out.push({ kind: 'hr' });
    else if (tag === 'IMG') out.push({ kind: 'image', src: el.getAttribute('src') || '' });
    else collectBlocks(el, out, depth);
  }
}

function wrapEl(el: Element) {
  const d = document.createElement('div');
  d.appendChild(el.cloneNode(true));
  return d;
}

function inlineRuns(el: Node, style = { bold: false, italic: false, underline: false, link: undefined as string | undefined }): Run[] {
  const runs: Run[] = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n.textContent || '').replace(/\t/g, '    ').replace(/[\r\n]+/g, ' ');
      if (text) runs.push({ text, ...style });
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const e = n as Element;
      const t = e.tagName;
      if (t === 'BR') { runs.push({ text: '', ...style, br: true }); return; }
      if (t === 'IMG') return;
      runs.push(...inlineRuns(e, {
        bold: style.bold || t === 'STRONG' || t === 'B',
        italic: style.italic || t === 'EM' || t === 'I',
        underline: style.underline || t === 'U',
        link: t === 'A' ? e.getAttribute('href') || undefined : style.link,
      }));
    }
  });
  return runs;
}

type Seg = Run;

/** Greedy word wrap across styled runs. */
function wrap(runs: Run[], width: number, size: number, font: (r: Run) => PDFFont): Seg[][] {
  const lines: Seg[][] = [];
  let line: Seg[] = [];
  let w = 0;
  const push = () => { lines.push(trimLine(line)); line = []; w = 0; };
  for (const r of runs) {
    if (r.br) { push(); continue; }
    const f = font(r);
    const tokens = r.text.match(/\S+|\s+/g) || [];
    for (const tok of tokens) {
      const tw = safeWidth(f, tok, size);
      if (/^\s+$/.test(tok)) {
        if (!line.length) continue;
        appendSeg(line, r, ' ');
        w += safeWidth(f, ' ', size);
        continue;
      }
      if (w + tw > width && line.length) push();
      if (tw > width) {
        // a single very long word: hard-break it
        let chunk = '';
        for (const ch of tok) {
          if (safeWidth(f, chunk + ch, size) > width) { appendSeg(line, r, chunk); push(); chunk = ''; }
          chunk += ch;
        }
        appendSeg(line, r, chunk);
        w = safeWidth(f, chunk, size);
        continue;
      }
      appendSeg(line, r, tok);
      w += tw;
    }
  }
  if (line.length) push();
  return lines;
}

function appendSeg(line: Seg[], r: Run, text: string) {
  const last = line[line.length - 1];
  if (last && last.bold === r.bold && last.italic === r.italic && last.underline === r.underline && last.link === r.link) last.text += text;
  else line.push({ ...r, text });
}

function trimLine(line: Seg[]) {
  if (line.length) line[line.length - 1].text = line[line.length - 1].text.replace(/\s+$/, '');
  return line.filter((s) => s.text);
}

function safeWidth(f: PDFFont, t: string, size: number) {
  try { return f.widthOfTextAtSize(t, size); } catch { return t.length * size * 0.5; }
}

function drawTable(
  rows: Run[][][], page: () => PDFPage, newPage: () => void, getY: () => number,
  fontOf: (r: Run) => PDFFont,
): number {
  const cols = Math.max(...rows.map((r) => r.length));
  const cw = CONTENT_W / cols;
  const size = 10;
  const pad = 4;
  let y = getY();
  for (const row of rows) {
    const cells = row.map((runs) => wrap(runs, cw - 2 * pad, size, fontOf));
    const h = Math.max(...cells.map((l) => l.length || 1)) * size * 1.3 + 2 * pad;
    if (y + h > PAGE_H - M && y > M) { newPage(); y = getY(); }
    const p = page();
    for (let c = 0; c < cols; c++) {
      const x = M + c * cw;
      p.drawRectangle({ x, y: PAGE_H - y - h, width: cw, height: h, borderColor: rgb(0.6, 0.6, 0.65), borderWidth: 0.6 });
      (cells[c] || []).forEach((line, i) => {
        let lx = x + pad;
        for (const seg of line) {
          const f = fontOf(seg);
          p.drawText(seg.text, { x: lx, y: PAGE_H - y - pad - size - i * size * 1.3, size, font: f, color: rgb(0.08, 0.08, 0.1) });
          lx += safeWidth(f, seg.text, size);
        }
      });
    }
    y += h;
  }
  return y;
}

async function embedImage(pdf: PDFDocument, src: string): Promise<PDFImage | null> {
  try {
    if (src.startsWith('data:image/png')) return await pdf.embedPng(dataUrlToBytes(src));
    if (/^data:image\/jpe?g/.test(src)) return await pdf.embedJpg(dataUrlToBytes(src));
    if (src.startsWith('data:image/')) {
      // gif/bmp/webp: re-encode through a canvas
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      return await pdf.embedPng(dataUrlToBytes(c.toDataURL('image/png')));
    }
  } catch { /* unsupported image (e.g. EMF) */ }
  return null;
}
