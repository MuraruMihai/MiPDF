import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

let ready = false;
export function getPdfjs() {
  if (!ready) {
    try {
      pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
    } catch {
      // Workers blocked (rare): pdf.js falls back to the main thread.
    }
    ready = true;
  }
  return pdfjs;
}

export type PDFDoc = pdfjs.PDFDocumentProxy;

export async function loadPdf(bytes: Uint8Array): Promise<PDFDoc> {
  const lib = getPdfjs();
  // pdf.js may transfer the buffer to the worker, so give it a copy.
  return lib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
}
