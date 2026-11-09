import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

const fixture = (n: string) => resolve(process.cwd(), 'fixtures', n);
const SHOTS = process.env.SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openPdf(page: Page, file = 'contract.pdf') {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Alege fișier' }).click();
  await (await chooser).setFiles(fixture(file));
  await expect(page.locator('.page-outer canvas').first()).toBeVisible({ timeout: 20_000 });
}

async function download(page: Page, click: () => Promise<void>) {
  const dl = page.waitForEvent('download');
  await click();
  const d = await dl;
  return { name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) };
}

test('home shows every action', async ({ page }) => {
  await page.goto('/');
  for (const t of ['Editează PDF', 'Semnează PDF', 'PDF în Word', 'Word în PDF', 'Combină PDF-uri']) {
    await expect(page.locator('.card', { hasText: t })).toBeVisible();
  }
  await shot(page, '1-home');
});

test('opens a PDF with thumbnails and saves it unchanged', async ({ page }) => {
  await openPdf(page);
  await expect(page.locator('.thumb')).toHaveCount(3);
  await expect(page.locator('.toolbar .title')).toContainText('3 pagini');
  await shot(page, '2-editor');
  const out = await download(page, () => page.getByRole('button', { name: 'Salvează', exact: true }).click());
  expect(out.name).toBe('contract.pdf');
  expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(3);
});

test('edits existing text, adds text, highlight and a drawn signature', async ({ page }) => {
  await openPdf(page);

  // Edit an existing line of text
  await page.keyboard.press('e');
  const line = page.locator('.page-outer').first().locator('.titem').nth(3);
  await expect(line).toBeVisible();
  await line.click({ position: { x: 8, y: 6 } });
  const editor = page.locator('.obj.text textarea');
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('• Durata: 24 de luni');
  await page.locator('.viewport').click({ position: { x: 20, y: 400 } });
  await expect(page.locator('.obj.text', { hasText: '24 de luni' })).toBeVisible();
  await expect(page.locator('.obj.whiteout')).toHaveCount(1);

  // New text box
  const first = page.locator('.page-outer').first();
  const box = (await first.boundingBox())!;
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 120, box.y + 420);
  await page.keyboard.type('Aprobat: ăîâșț');
  await page.locator('.viewport').click({ position: { x: 20, y: 400 } });
  await expect(page.locator('.obj.text', { hasText: 'Aprobat' })).toBeVisible();

  // Highlight
  await page.keyboard.press('h');
  await page.mouse.move(box.x + 80, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 140, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.obj.highlight')).toHaveCount(1);

  // Drawn signature
  await page.getByRole('button', { name: 'Semnează' }).click();
  const pad = (await page.locator('.sig-pad canvas').boundingBox())!;
  await page.mouse.move(pad.x + 60, pad.y + 110);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) await page.mouse.move(pad.x + 60 + i * 10, pad.y + 110 - Math.sin(i / 3) * 30);
  await page.mouse.up();
  await shot(page, '3-signature');
  await page.getByRole('button', { name: 'Plasează pe document' }).click();
  await expect(page.locator('.overlay.t-place').first()).toBeAttached();
  await page.mouse.move(box.x + 420, box.y + 560);
  await page.mouse.click(box.x + 420, box.y + 560);
  await expect(page.locator('.obj.image')).toHaveCount(1);
  await shot(page, '4-edited');

  // Undo removes the signature, redo brings it back
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.obj.image')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.obj.image')).toHaveCount(1);

  const out = await download(page, () => page.getByRole('button', { name: 'Salvează', exact: true }).click());
  expect(out.name).toBe('contract-editat.pdf');
  const pdf = await PDFDocument.load(out.bytes);
  expect(pdf.getPageCount()).toBe(3);
  expect(out.bytes.length).toBeGreaterThan(readFileSync(fixture('contract.pdf')).length);

  // Re-open the saved file: the edits are now part of the PDF itself
  await page.getByRole('button', { name: 'Înapoi' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Alege fișier' }).click();
  await (await chooser).setFiles({ name: 'reopened.pdf', mimeType: 'application/pdf', buffer: out.bytes });
  await expect(page.locator('.page-outer canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.obj')).toHaveCount(0);
  await page.waitForTimeout(500);
  await shot(page, '6-reopened');
});

test('rotates and deletes pages from the sidebar', async ({ page }) => {
  await openPdf(page);
  const t2 = page.locator('.thumb').nth(1);
  await t2.hover();
  await t2.getByRole('button', { name: 'Rotește pagina' }).click();
  const t3 = page.locator('.thumb').nth(2);
  await t3.hover();
  await t3.getByRole('button', { name: 'Șterge pagina' }).click();
  await expect(page.locator('.thumb')).toHaveCount(2);

  // Leaving with unsaved changes asks first
  await page.getByRole('button', { name: 'Înapoi' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Modificări nesalvate' })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Anulează' }).click();
  await expect(page.locator('.thumb')).toHaveCount(2);
  const out = await download(page, () => page.getByRole('button', { name: 'Salvează', exact: true }).click());
  const pdf = await PDFDocument.load(out.bytes);
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(1).getRotation().angle).toBe(90);
});

test('merges two PDFs', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.card', { hasText: 'Combină PDF-uri' }).click();
  await (await chooser).setFiles([fixture('contract.pdf'), fixture('contract.pdf')]);
  await expect(page.locator('.thumb')).toHaveCount(6, { timeout: 20_000 });
  const out = await download(page, () => page.getByRole('button', { name: 'Salvează', exact: true }).click());
  expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(6);
});

test('converts PDF to Word', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  const dl = page.waitForEvent('download');
  await page.locator('.card', { hasText: 'PDF în Word' }).click();
  await (await chooser).setFiles(fixture('contract.pdf'));
  const d = await dl;
  expect(d.suggestedFilename()).toBe('contract.docx');
  const zip = await JSZip.loadAsync(readFileSync((await d.path())!));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Contract de prestări servicii 1');
  expect(xml).toContain('Obiectul contractului');
  expect(xml).toContain('Heading1'); // title became a real Word heading
  expect(xml).toMatch(/Prezentul contract are ca obiect furnizarea de servicii de consultanță\s?tehnică/);
});

test('converts Word to PDF and opens the result', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.card', { hasText: 'Word în PDF' }).click();
  await (await chooser).setFiles(fixture('oferta.docx'));
  await expect(page.locator('.page-outer canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.toolbar .title')).toContainText('oferta.pdf');
  await page.waitForTimeout(500);
  await shot(page, '5-word-to-pdf');
  const out = await download(page, () => page.getByRole('button', { name: 'Salvează', exact: true }).click());
  expect(out.name).toBe('oferta.pdf');
  expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1);
});
