// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { exportPdf } from '../../src/lib/exportPdf';
import type { DocState, SourceDoc, PageRef } from '../../src/lib/model';

async function samplePdf(pages: number, rotate = 0) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([595, 842]);
    p.drawText(`Pagina ${i + 1}`, { x: 50, y: 780, size: 20, font: f });
    if (rotate) p.setRotation(degrees(rotate));
  }
  return d.save();
}

const src = (id: string, bytes: Uint8Array) => ({ id, name: id + '.pdf', bytes, pdf: null } as unknown as SourceDoc);
const ref = (id: string, doc: string, index: number, extra: Partial<PageRef> = {}): PageRef => ({
  id, doc, index, width: 595, height: 842, baseRotation: 0, rotation: 0, ...extra,
});

describe('exportPdf', () => {
  it('keeps the user page order, deletions and rotations', async () => {
    const a = src('a', await samplePdf(3));
    const state: DocState = {
      pages: [ref('p3', 'a', 2), ref('p1', 'a', 0, { rotation: 90 })], // page 2 deleted, 3 moved first
      objects: [],
    };
    const out = await PDFDocument.load(await exportPdf(state, [a]));
    expect(out.getPageCount()).toBe(2);
    expect(out.getPage(0).getRotation().angle).toBe(0);
    expect(out.getPage(1).getRotation().angle).toBe(90);
  });

  it('merges pages from several source files', async () => {
    const a = src('a', await samplePdf(2));
    const b = src('b', await samplePdf(3, 90));
    const state: DocState = {
      pages: [ref('a0', 'a', 0), ref('b0', 'b', 0, { baseRotation: 90 }), ref('a1', 'a', 1), ref('b2', 'b', 2, { baseRotation: 90, rotation: 90 })],
      objects: [],
    };
    const out = await PDFDocument.load(await exportPdf(state, [a, b]));
    expect(out.getPageCount()).toBe(4);
    expect(out.getPage(1).getRotation().angle).toBe(90);
    expect(out.getPage(3).getRotation().angle).toBe(180);
  });

  it('burns in every object type with Romanian diacritics', async () => {
    const a = src('a', await samplePdf(1));
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const state: DocState = {
      pages: [ref('p', 'a', 0)],
      objects: [
        { id: 'w', page: 'p', type: 'whiteout', x: 40, y: 50, w: 200, h: 30 },
        { id: 't', page: 'p', type: 'text', text: 'Semnătură și ștampilă\nrândul doi', size: 14, color: '#112233', bold: true, italic: false, x: 50, y: 60, w: 200, h: 34 },
        { id: 'h', page: 'p', type: 'highlight', color: '#ffd60a', x: 50, y: 200, w: 100, h: 14 },
        { id: 'r', page: 'p', type: 'rect', color: '#e5484d', stroke: 2, x: 50, y: 300, w: 100, h: 50 },
        { id: 'i', page: 'p', type: 'ink', color: '#111114', stroke: 2, x: 50, y: 400, w: 100, h: 40, vw: 50, vh: 20, points: [[[0, 0], [25, 20], [50, 0]]] },
        { id: 'g', page: 'p', type: 'image', src: png, signature: true, x: 300, y: 600, w: 120, h: 40 },
      ],
    };
    const bytes = await exportPdf(state, [a]);
    const out = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(out.getPageCount()).toBe(1);
    expect(out.getProducer()).toBe('MiPDF');
    // the embedded font subset should be present
    const raw = Buffer.from(await out.save({ useObjectStreams: false, updateMetadata: false })).toString('latin1');
    expect(raw).toMatch(/LiberationSans-Bold/);
    expect(raw).toMatch(/\/Subtype\s*\/Image/);
  });
});
