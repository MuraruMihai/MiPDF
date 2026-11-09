// Liberation Sans (SIL OFL 1.1): metric-compatible with Arial, full Romanian diacritics.
import regular from '../assets/fonts/LiberationSans-Regular.ttf?inline';
import bold from '../assets/fonts/LiberationSans-Bold.ttf?inline';
import italic from '../assets/fonts/LiberationSans-Italic.ttf?inline';
import boldItalic from '../assets/fonts/LiberationSans-BoldItalic.ttf?inline';

const urls = { regular, bold, italic, boldItalic };
export type FontStyle = keyof typeof urls;
const cache = new Map<FontStyle, Uint8Array>();

export async function fontBytes(style: FontStyle): Promise<Uint8Array> {
  let b = cache.get(style);
  if (!b) {
    b = dataUrlToBytes(urls[style]);
    cache.set(style, b);
  }
  return b;
}

export function dataUrlToBytes(url: string): Uint8Array {
  const base64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Registers the same font for on-screen text boxes, so what you see is what gets saved. */
export function registerUiFonts() {
  if (typeof FontFace === 'undefined') return;
  const defs: [FontStyle, string, string][] = [
    ['regular', '400', 'normal'], ['bold', '700', 'normal'], ['italic', '400', 'italic'], ['boldItalic', '700', 'italic'],
  ];
  for (const [k, weight, style] of defs) {
    const bytes = dataUrlToBytes(urls[k]);
    const f = new FontFace('MiPDF Sans', bytes.buffer as ArrayBuffer, { weight, style });
    f.load().then((ff) => document.fonts.add(ff)).catch(() => {});
  }
}
