// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { wordToPdf } from '../../src/lib/wordToPdf';

describe('wordToPdf', () => {
  it('converts the sample offer (.docx) into a valid PDF', async () => {
    const bytes = new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/oferta.docx')));
    const pdf = await PDFDocument.load(await wordToPdf(bytes));
    expect(pdf.getPageCount()).toBe(1);
    const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
    expect(Math.round(w)).toBe(595); // A4
    expect(Math.round(h)).toBe(842);
  });

  it('flows long documents onto several pages', async () => {
    const paras = Array.from({ length: 120 }, (_, i) => new Paragraph(`Paragraful ${i + 1}: țară, școală, învățământ, câmpie și râu.`));
    const doc = new Document({ sections: [{ children: [new Paragraph({ text: 'Raport', heading: HeadingLevel.HEADING_1 }), ...paras] }] });
    const bytes = new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
    const pdf = await PDFDocument.load(await wordToPdf(bytes));
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });
});
