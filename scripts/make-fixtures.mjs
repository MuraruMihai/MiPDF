// Generates small test files in fixtures/ (a PDF and a .docx with Romanian text).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('fixtures', { recursive: true });
const pdf = await PDFDocument.create();
pdf.registerFontkit(fontkit);
const reg = await pdf.embedFont(readFileSync('src/assets/fonts/LiberationSans-Regular.ttf'));
const bold = await pdf.embedFont(readFileSync('src/assets/fonts/LiberationSans-Bold.ttf'));
for (let n = 1; n <= 3; n++) {
  const p = pdf.addPage([595.28, 841.89]);
  p.drawText(`Contract de prestări servicii ${n}`, { x: 64, y: 770, size: 22, font: bold });
  p.drawText('1. Obiectul contractului', { x: 64, y: 730, size: 14, font: bold });
  const body = [
    'Prezentul contract are ca obiect furnizarea de servicii de consultanță',
    'tehnică de către Prestator, în condițiile stabilite mai jos. Părțile își',
    'asumă obligațiile în mod liber și în cunoștință de cauză.',
  ];
  body.forEach((l, i) => p.drawText(l, { x: 64, y: 705 - i * 15, size: 11, font: reg }));
  p.drawText('• Durata: 12 luni', { x: 64, y: 640, size: 11, font: reg });
  p.drawText('• Valoare: 15.000 lei', { x: 64, y: 625, size: 11, font: reg });
  p.drawText('Semnătura beneficiarului: ____________', { x: 64, y: 140, size: 11, font: reg, color: rgb(0.2, 0.2, 0.2) });
}
writeFileSync('fixtures/contract.pdf', await pdf.save());

const doc = new Document({ sections: [{ children: [
  new Paragraph({ text: 'Ofertă de colaborare', heading: HeadingLevel.HEADING_1 }),
  new Paragraph({ children: [new TextRun('Stimate client, vă trimitem '), new TextRun({ text: 'oferta noastră', bold: true }), new TextRun(' pentru anul 2027. Prețurile includ TVA și sunt valabile 30 de zile.')] }),
  new Paragraph({ text: 'Servicii incluse', heading: HeadingLevel.HEADING_2 }),
  new Paragraph({ text: 'Mentenanță lunară', bullet: { level: 0 } }),
  new Paragraph({ text: 'Suport prioritar în zilele lucrătoare', bullet: { level: 0 } }),
  new Table({ rows: [
    new TableRow({ children: [new TableCell({ children: [new Paragraph('Serviciu')] }), new TableCell({ children: [new Paragraph('Preț')] })] }),
    new TableRow({ children: [new TableCell({ children: [new Paragraph('Mentenanță')] }), new TableCell({ children: [new Paragraph('1.200 lei')] })] }),
  ] }),
  new Paragraph({ children: [new TextRun({ text: 'Cu stimă, echipa MiPDF', italics: true })] }),
] }] });
writeFileSync('fixtures/oferta.docx', Buffer.from(await (await Packer.toBlob(doc)).arrayBuffer()));
console.log('fixtures ok');
