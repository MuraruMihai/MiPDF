import { PDFDocument, rgb, degrees, BlendMode, LineCapStyle, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fontBytes, dataUrlToBytes } from './fonts';
import { hexToRgb, type DocState, type SourceDoc, type Obj } from './model';

export const TEXT_ASCENT = 0.93; // baseline offset for line-height 1.2 (matches the CSS editor)
export const LINE_HEIGHT = 1.2;

/** Builds the final PDF: pages in the user's order and rotation, with every object burned in. */
export async function exportPdf(state: DocState, sources: SourceDoc[]): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  out.registerFontkit(fontkit);
  out.setProducer('MiPDF');
  out.setCreationDate(new Date());
  out.setCreator('MiPDF');

  const loaded = new Map<string, PDFDocument>();
  for (const s of sources) {
    if (state.pages.some((p) => p.doc === s.id)) {
      loaded.set(s.id, await PDFDocument.load(s.bytes, { ignoreEncryption: true }));
    }
  }

  const fonts: Partial<Record<string, PDFFont>> = {};
  const font = async (bold: boolean, italic: boolean) => {
    const key = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    if (!fonts[key]) fonts[key] = await out.embedFont(await fontBytes(key), { subset: true });
    return fonts[key]!;
  };
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();

  for (const ref of state.pages) {
    const src = loaded.get(ref.doc)!;
    const [page] = await out.copyPages(src, [ref.index]);
    out.addPage(page);
    page.setRotation(degrees((((ref.baseRotation + ref.rotation) % 360) + 360) % 360));
    const objs = state.objects.filter((o) => o.page === ref.id);
    // Whiteouts first so text placed on top of them stays visible.
    objs.sort((a, b) => Number(b.type === 'whiteout') - Number(a.type === 'whiteout'));
    for (const o of objs) await drawObj(page, o, font, images, out);
  }
  out.setModificationDate(new Date());
  return out.save();
}

async function drawObj(
  page: PDFPage,
  o: Obj,
  font: (b: boolean, i: boolean) => Promise<PDFFont>,
  images: Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>,
  doc: PDFDocument,
) {
  const mb = page.getMediaBox();
  const top = mb.y + mb.height;
  const X = (x: number) => mb.x + x;
  const Y = (y: number) => top - y;

  switch (o.type) {
    case 'whiteout':
      page.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h, color: rgb(1, 1, 1) });
      break;
    case 'highlight': {
      const [r, g, b] = hexToRgb(o.color);
      page.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h, color: rgb(r, g, b), opacity: 0.4, blendMode: BlendMode.Multiply });
      break;
    }
    case 'rect': {
      const [r, g, b] = hexToRgb(o.color);
      page.drawRectangle({ x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h, borderColor: rgb(r, g, b), borderWidth: o.stroke });
      break;
    }
    case 'ink': {
      const [r, g, b] = hexToRgb(o.color);
      for (const stroke of o.points) {
        if (stroke.length < 2) continue;
        const sx = o.w / (o.vw || o.w || 1);
        const sy = o.h / (o.vh || o.h || 1);
        const d = stroke.map(([px, py], i) => `${i ? 'L' : 'M'}${(o.x + px * sx).toFixed(2)} ${(o.y + py * sy).toFixed(2)}`).join(' ');
        page.drawSvgPath(d, { x: X(0), y: Y(0), borderColor: rgb(r, g, b), borderWidth: o.stroke, borderLineCap: LineCapStyle.Round });
      }
      break;
    }
    case 'image': {
      let img = images.get(o.src);
      if (!img) {
        const bytes = dataUrlToBytes(o.src);
        img = o.src.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        images.set(o.src, img);
      }
      page.drawImage(img, { x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h });
      break;
    }
    case 'text': {
      const f = await font(o.bold, o.italic);
      const [r, g, b] = hexToRgb(o.color);
      o.text.split('\n').forEach((line, i) => {
        if (!line) return;
        page.drawText(line, {
          x: X(o.x),
          y: Y(o.y + o.size * (TEXT_ASCENT + i * LINE_HEIGHT)),
          size: o.size,
          font: f,
          color: rgb(r, g, b),
        });
      });
      break;
    }
  }
}
