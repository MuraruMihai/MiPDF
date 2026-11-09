import type { PDFDoc } from './pdfjs';

/** Renders one page (unrotated) into a fresh canvas at the given px-per-pt scale. */
export async function renderPage(pdf: PDFDoc, index: number, scale: number, signal?: { cancelled: boolean }) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false })!, viewport: vp });
  const poll = setInterval(() => { if (signal?.cancelled) task.cancel(); }, 30);
  try {
    await task.promise;
  } finally {
    clearInterval(poll);
  }
  return canvas;
}

export interface TextBox { str: string; x: number; y: number; w: number; h: number; size: number; baseline: number; bold: boolean; italic: boolean }

/** Text runs of a page with boxes in unrotated page points (origin top-left). */
export async function pageTextBoxes(pdf: PDFDoc, index: number): Promise<TextBox[]> {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  await page.getOperatorList();
  const tc = await page.getTextContent();
  const out: TextBox[] = [];
  for (const it of tc.items as { str?: string; transform: number[]; width: number; fontName: string }[]) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, , , e, f] = it.transform;
    if (Math.abs(b) > 0.01 * Math.abs(a)) continue;
    const size = Math.hypot(a, b);
    const [x, baseline] = vp.convertToViewportPoint(e, f);
    let name = '';
    try { name = (page.commonObjs.get(it.fontName) as { name?: string })?.name || ''; } catch { /* */ }
    out.push({
      str: it.str, x, baseline, size,
      y: baseline - size * 0.95, w: it.width, h: size * 1.25,
      bold: /bold|black|heavy|semibold|demi/i.test(name),
      italic: /italic|oblique/i.test(name),
    });
  }
  return out;
}
