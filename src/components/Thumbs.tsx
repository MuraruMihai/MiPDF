import { memo, useEffect, useRef, useState } from 'react';
import { RotateCw, Trash2, FilePlus2 } from 'lucide-react';
import type { PDFDoc } from '../lib/pdfjs';
import { displayRotation, type PageRef } from '../lib/model';
import { renderPage } from '../lib/render';

const TW = 112;

interface Props {
  pages: PageRef[];
  pdfs: Map<string, PDFDoc>;
  active: string | null;
  onJump: (id: string) => void;
  onRotate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onInsert: () => void;
}

export default function Thumbs(p: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  return (
    <aside className="sidebar" aria-label="Pagini">
      {p.pages.map((pg, i) => (
        <div
          key={pg.id}
          className={`thumb${p.active === pg.id ? ' active' : ''}${overIdx === i && dragIdx !== i ? ' drag-over' : ''}${dragIdx === i ? ' dragging' : ''}`}
          draggable
          onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
          onDragOver={(e) => { if (dragIdx != null) { e.preventDefault(); e.stopPropagation(); setOverIdx(i); } }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIdx != null && dragIdx !== i) p.onMove(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
          onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
          onClick={() => p.onJump(pg.id)}
        >
          <Thumb page={pg} pdf={p.pdfs.get(pg.doc)!} />
          <div className="num">{i + 1}</div>
          <div className="acts">
            <button title="Rotește" aria-label="Rotește pagina" onClick={(e) => { e.stopPropagation(); p.onRotate(pg.id); }}><RotateCw size={13} /></button>
            {p.pages.length > 1 && (
              <button className="del" title="Șterge pagina" aria-label="Șterge pagina" onClick={(e) => { e.stopPropagation(); p.onDelete(pg.id); }}><Trash2 size={13} /></button>
            )}
          </div>
        </div>
      ))}
      <button className="btn secondary side-add" onClick={p.onInsert}><FilePlus2 size={15} /> Adaugă pagini</button>
    </aside>
  );
}

const Thumb = memo(function Thumb({ page, pdf }: { page: PageRef; pdf: PDFDoc }) {
  const holder = useRef<HTMLDivElement>(null);
  const rot = displayRotation(page);
  const swap = rot % 180 !== 0;
  const s = TW / (swap ? page.height : page.width);
  const W = page.width * s, H = page.height * s;
  useEffect(() => {
    const sig = { cancelled: false };
    const el = holder.current!;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      try {
        const c = await renderPage(pdf, page.index, s * Math.min(devicePixelRatio || 1, 2), sig);
        c.style.width = W + 'px';
        c.style.height = H + 'px';
        if (!sig.cancelled) el.replaceChildren(c);
      } catch { /* */ }
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => { sig.cancelled = true; io.disconnect(); };
  }, [pdf, page.index, s, W, H]);
  return (
    <div className="box" style={{ width: swap ? H : W, height: swap ? W : H }}>
      <div ref={holder} style={{ width: W, height: H, position: 'absolute', left: ((swap ? H : W) - W) / 2, top: ((swap ? W : H) - H) / 2, transform: `rotate(${rot}deg)`, transition: 'transform .35s var(--spring)' }} />
    </div>
  );
});
