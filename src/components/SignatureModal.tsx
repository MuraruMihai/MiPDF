import { useEffect, useRef, useState } from 'react';
import { Eraser, X, ImageUp } from 'lucide-react';
import { pickFiles } from '../lib/platform';

export interface Sig { src: string; w: number; h: number }
const KEY = 'mipdf.signatures';
const INKS = ['#111114', '#1f3fbf', '#0b6b4f'];
const FONTS = [
  '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
  '"Bradley Hand", "Ink Free", "Comic Sans MS", cursive',
  '"Zapfino", "Lucida Handwriting", "Segoe Print", cursive',
];

function loadSaved(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function storeSaved(list: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6))); } catch { /* storage unavailable */ }
}

export default function SignatureModal({ onDone, onCancel }: { onDone: (s: Sig) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'draw' | 'type' | 'image'>('draw');
  const [ink, setInk] = useState(INKS[0]);
  const [name, setName] = useState('');
  const [font, setFont] = useState(0);
  const [img, setImg] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const [saved, setSaved] = useState(loadSaved);
  const [hasInk, setHasInk] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<number[][][]>([]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);

  // --- drawing pad with smoothed strokes ---
  useEffect(() => {
    if (mode !== 'draw') return;
    const c = canvas.current!;
    const dpr = devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ink]);

  function redraw() {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    const dpr = devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = ink;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 2.6;
    for (const s of strokes.current) {
      g.beginPath();
      g.moveTo(s[0][0], s[0][1]);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i][0] + s[i + 1][0]) / 2, my = (s[i][1] + s[i + 1][1]) / 2;
        g.quadraticCurveTo(s[i][0], s[i][1], mx, my);
      }
      const l = s[s.length - 1];
      g.lineTo(l[0], l[1]);
      g.stroke();
    }
  }

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  async function produce(): Promise<Sig | null> {
    let src: string | null = null;
    if (mode === 'draw' && hasInk) src = trim(canvas.current!);
    if (mode === 'type' && name.trim()) src = typed(name.trim(), FONTS[font], ink);
    if (mode === 'image' && img) src = img;
    if (!src) return null;
    return sized(src);
  }

  const done = async () => {
    const s = await produce();
    if (!s) return;
    if (save && !saved.includes(s.src)) storeSaved([s.src, ...saved]);
    onDone(s);
  };

  const ready = (mode === 'draw' && hasInk) || (mode === 'type' && !!name.trim()) || (mode === 'image' && !!img);

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sheet" role="dialog" aria-label="Semnătură">
        <h3>Semnătura ta</h3>
        {saved.length > 0 && (
          <div className="saved-sigs">
            {saved.map((s) => (
              <button key={s} className="s" title="Folosește semnătura" onClick={async () => onDone(await sized(s))}>
                <img src={s} alt="Semnătură salvată" />
                <span className="x" role="button" aria-label="Șterge" onClick={(e) => { e.stopPropagation(); const l = saved.filter((x) => x !== s); setSaved(l); storeSaved(l); }}><X size={11} /></span>
              </button>
            ))}
          </div>
        )}
        <div className="seg" style={{ marginBottom: 12, width: 'fit-content' }}>
          {(['draw', 'type', 'image'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              <span className="lbl">{m === 'draw' ? 'Desenează' : m === 'type' ? 'Scrie' : 'Imagine'}</span>
            </button>
          ))}
        </div>

        {mode === 'draw' && (
          <div className="sig-pad">
            <canvas
              ref={canvas}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); strokes.current.push([pos(e)]); setHasInk(true); }}
              onPointerMove={(e) => { if (e.buttons !== 1) return; const s = strokes.current[strokes.current.length - 1]; if (s) { s.push(pos(e)); redraw(); } }}
            />
            <div className="line" />
            {!hasInk && <div className="ph-text">Semnează aici cu mouse-ul, trackpad-ul sau degetul</div>}
            {hasInk && <button className="btn clear" onClick={() => { strokes.current = []; setHasInk(false); redraw(); }}><Eraser size={14} /> Șterge</button>}
          </div>
        )}
        {mode === 'type' && (
          <>
            <input className="sig-type" autoFocus placeholder="Numele tău" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="sig-fonts">
              {FONTS.map((f, i) => (
                <button key={i} className={font === i ? 'on' : ''} style={{ fontFamily: f, color: ink }} onClick={() => setFont(i)}>{name || 'Semnătură'}</button>
              ))}
            </div>
          </>
        )}
        {mode === 'image' && (
          <div className="sig-pad" style={{ display: 'grid', placeItems: 'center', cursor: 'default' }}>
            {img ? <img src={img} alt="" style={{ maxWidth: '80%', maxHeight: 150 }} /> : (
              <button className="btn secondary" onClick={async () => {
                const [f] = await pickFiles('image/png,image/jpeg');
                if (f) setImg(await toPngDataUrl(f.bytes));
              }}><ImageUp size={15} /> Încarcă o imagine cu semnătura</button>
            )}
          </div>
        )}
        {mode !== 'image' && (
          <div className="colors">
            {INKS.map((c) => <button key={c} className={'swatch' + (ink === c ? ' on' : '')} style={{ background: c }} aria-label="Culoare" onClick={() => setInk(c)} />)}
          </div>
        )}
        <div className="foot">
          <label className="check"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Păstrează pentru data viitoare</label>
          <button className="btn secondary" onClick={onCancel}>Anulează</button>
          <button className="btn primary" disabled={!ready} onClick={done}>Plasează pe document</button>
        </div>
      </div>
    </div>
  );
}

/** Crops a canvas to its inked area and returns a PNG data URL. */
function trim(c: HTMLCanvasElement): string {
  const g = c.getContext('2d')!;
  const { width, height } = c;
  const d = g.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (d[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0) return c.toDataURL('image/png');
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width, x1 + pad); y1 = Math.min(height, y1 + pad);
  const o = document.createElement('canvas');
  o.width = x1 - x0; o.height = y1 - y0;
  o.getContext('2d')!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

function typed(text: string, font: string, color: string): string {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const size = 96;
  g.font = `${size}px ${font}`;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w; c.height = size * 1.6;
  g.font = `${size}px ${font}`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 20, c.height / 2);
  return trim(c);
}

async function sized(src: string): Promise<Sig> {
  const im = new Image();
  im.src = src;
  await im.decode();
  const w = 150;
  return { src, w, h: (w * im.naturalHeight) / im.naturalWidth };
}

export async function toPngDataUrl(bytes: Uint8Array, maxSide = 2000): Promise<string> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  try {
    const im = new Image();
    im.src = url;
    await im.decode();
    const s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * s);
    c.height = Math.round(im.naturalHeight * s);
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
