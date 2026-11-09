import { memo, useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import type { PDFDoc } from '../lib/pdfjs';
import { displayRotation, uid, type Obj, type PageRef, type TextObj, type Tool } from '../lib/model';
import { renderPage, pageTextBoxes, type TextBox } from '../lib/render';
import { measureText } from '../lib/measure';

export interface Defaults { color: string; highlight: string; stroke: number; size: number; bold: boolean; italic: boolean }
export interface Pending { src: string; w: number; h: number; signature?: boolean }

interface Props {
  page: PageRef;
  pdf: PDFDoc;
  scale: number;
  objects: Obj[];
  tool: Tool;
  selected: string | null;
  editing: string | null;
  pending: Pending | null;
  defaults: Defaults;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onBegin: () => void;
  onLive: (id: string, patch: Partial<Obj>) => void;
  onAdd: (objs: Obj[], select?: string, edit?: boolean) => void;
  onPlaced: () => void;
  onCommitText: (id: string, text: string) => void;
}

type Drag =
  | { kind: 'move'; id: string; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'resize'; id: string; sx: number; sy: number; ow: number; oh: number; ratio?: number; osize?: number }
  | { kind: 'box'; sx: number; sy: number; x: number; y: number }
  | { kind: 'ink'; pts: number[][] };

function PageViewImpl(p: Props) {
  const { page, scale } = p;
  const outer = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [boxes, setBoxes] = useState<TextBox[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const rot = displayRotation(page);
  const W = page.width * scale;
  const H = page.height * scale;
  const swap = rot % 180 !== 0;
  const OW = swap ? H : W;
  const OH = swap ? W : H;

  // Render only when near the viewport.
  useEffect(() => {
    const el = outer.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const signal = { cancelled: false };
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const t = setTimeout(async () => {
      try {
        const c = await renderPage(p.pdf, page.index, scale * dpr, signal);
        if (signal.cancelled || !holder.current) return;
        holder.current.replaceChildren(c);
        setRendered(true);
      } catch { /* cancelled */ }
    }, rendered ? 140 : 0); // debounce re-renders while zooming
    return () => { signal.cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scale, p.pdf, page.index]);

  useEffect(() => {
    if (p.tool === 'edittext' && visible && !boxes) pageTextBoxes(p.pdf, page.index).then(setBoxes).catch(() => setBoxes([]));
  }, [p.tool, visible, boxes, p.pdf, page.index]);

  /** Pointer → unrotated page points. */
  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = outer.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const a = (-rot * Math.PI) / 180;
    const ux = dx * Math.cos(a) - dy * Math.sin(a);
    const uy = dx * Math.sin(a) + dy * Math.cos(a);
    return { x: (ux + W / 2) / scale, y: (uy + H / 2) / scale };
  };

  const setD = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  const onDown = (e: RPE) => {
    if (e.button !== 0) return;
    const pt = toPt(e);
    const target = e.target as HTMLElement;
    if (target.closest('textarea')) return;
    e.preventDefault(); // keep focus in the text box we may create below
    const objEl = target.closest('[data-obj]') as HTMLElement | null;
    const id = objEl?.dataset.obj;
    const obj = id ? p.objects.find((o) => o.id === id) : undefined;

    if (p.pending) {
      const { src, w, h, signature } = p.pending;
      p.onAdd([{ id: uid(), page: page.id, type: 'image', src, signature, x: pt.x - w / 2, y: pt.y - h / 2, w, h }]);
      p.onPlaced();
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (p.tool === 'select' || (obj && p.tool === 'text' && obj.type === 'text')) {
      if (obj) {
        if (p.editing && p.editing !== obj.id) p.onEdit(null);
        p.onSelect(obj.id);
        p.onBegin();
        if (target.classList.contains('handle')) {
          setD({ kind: 'resize', id: obj.id, sx: pt.x, sy: pt.y, ow: obj.w, oh: obj.h, ratio: obj.type === 'image' || obj.type === 'text' ? obj.w / obj.h : undefined, osize: obj.type === 'text' ? obj.size : undefined });
        } else setD({ kind: 'move', id: obj.id, sx: pt.x, sy: pt.y, ox: obj.x, oy: obj.y });
      } else {
        p.onEdit(null);
        p.onSelect(null);
      }
      return;
    }
    if (p.editing) { p.onEdit(null); return; }
    switch (p.tool) {
      case 'text': {
        const d = p.defaults;
        const t: TextObj = { id: uid(), page: page.id, type: 'text', text: '', size: d.size, color: d.color, bold: d.bold, italic: d.italic, x: pt.x, y: pt.y - d.size * 0.6, w: d.size * 4, h: d.size * 1.2 };
        p.onAdd([t], t.id, true);
        break;
      }
      case 'edittext': {
        const b = boxes?.find((b) => pt.x >= b.x - 1 && pt.x <= b.x + b.w + 1 && pt.y >= b.y && pt.y <= b.y + b.h);
        if (!b) break;
        const coverId = uid();
        const size = Math.round(b.size * 10) / 10;
        const t: TextObj = {
          id: uid(), page: page.id, type: 'text', text: b.str, size, color: '#000000', bold: b.bold, italic: b.italic,
          x: b.x, y: b.baseline - size * 0.93, w: b.w, h: size * 1.2, coverId,
        };
        const m = measureText(t);
        t.w = m.w; t.h = m.h;
        p.onAdd([{ id: coverId, page: page.id, type: 'whiteout', x: b.x - 1.5, y: b.baseline - b.size * 0.98, w: Math.max(b.w, t.w) + 3, h: b.size * 1.28 }, t], t.id, true);
        setBoxes((bs) => bs?.filter((x) => x !== b) || null);
        break;
      }
      case 'ink':
        setD({ kind: 'ink', pts: [[pt.x, pt.y]] });
        break;
      default:
        setD({ kind: 'box', sx: pt.x, sy: pt.y, x: pt.x, y: pt.y });
    }
  };

  const onMove = (e: RPE) => {
    const pt = toPt(e);
    if (p.pending) { setGhost(pt); return; }
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'move') p.onLive(d.id, { x: d.ox + pt.x - d.sx, y: d.oy + pt.y - d.sy });
    else if (d.kind === 'resize') {
      let w = Math.max(6, d.ow + pt.x - d.sx);
      let h = Math.max(6, d.oh + pt.y - d.sy);
      if (d.ratio) h = w / d.ratio;
      if (d.osize) { p.onLive(d.id, { w, h, size: Math.max(4, d.osize * (w / d.ow)) } as Partial<Obj>); return; }
      p.onLive(d.id, { w, h });
    } else if (d.kind === 'box') setD({ ...d, x: pt.x, y: pt.y });
    else if (d.kind === 'ink') {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(pt.x - last[0], pt.y - last[1]) > 0.8 / scale) {
        d.pts.push([pt.x, pt.y]);
        setDrag({ ...d });
      }
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    setD(null);
    if (!d) return;
    if (d.kind === 'box') {
      const x = Math.min(d.sx, d.x), y = Math.min(d.sy, d.y);
      let w = Math.abs(d.x - d.sx), h = Math.abs(d.y - d.sy);
      if (w < 3 || h < 3) {
        if (p.tool === 'highlight') return;
        w = 120; h = p.tool === 'whiteout' ? 24 : 80;
      }
      const base = { id: uid(), page: page.id, x, y, w, h };
      if (p.tool === 'highlight') p.onAdd([{ ...base, type: 'highlight', color: p.defaults.highlight }]);
      else if (p.tool === 'rect') p.onAdd([{ ...base, type: 'rect', color: p.defaults.color, stroke: p.defaults.stroke }], base.id);
      else if (p.tool === 'whiteout') p.onAdd([{ ...base, type: 'whiteout' }], base.id);
    } else if (d.kind === 'ink' && d.pts.length > 1) {
      const xs = d.pts.map((q) => q[0]), ys = d.pts.map((q) => q[1]);
      const pad = p.defaults.stroke;
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
      const w = Math.max(...xs) - x + pad, h = Math.max(...ys) - y + pad;
      p.onAdd([{ id: uid(), page: page.id, type: 'ink', x, y, w, h, vw: w, vh: h, color: p.defaults.color, stroke: p.defaults.stroke, points: [d.pts.map(([a, b]) => [a - x, b - y])] }]);
    }
  };

  const px = (v: number) => v * scale;
  const draftBox = drag?.kind === 'box' ? { left: px(Math.min(drag.sx, drag.x)), top: px(Math.min(drag.sy, drag.y)), width: px(Math.abs(drag.x - drag.sx)), height: px(Math.abs(drag.y - drag.sy)) } : null;
  const overlayTool = p.pending ? 'place' : p.tool;

  return (
    <div ref={outer} className="page-outer" data-page={page.id} style={{ width: OW, height: OH }}>
      <div className="page-inner" style={{ width: W, height: H, left: (OW - W) / 2, top: (OH - H) / 2, transform: `rotate(${rot}deg)` }}>
        {!rendered && <div className="ph" />}
        <div ref={holder} style={{ position: 'absolute', inset: 0 }} className="canvas-holder" />
        <div
          className={`overlay t-${overlayTool}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setGhost(null)}
          onDoubleClick={(e) => {
            const id = ((e.target as HTMLElement).closest('[data-obj]') as HTMLElement | null)?.dataset.obj;
            const o = p.objects.find((x) => x.id === id);
            if (o?.type === 'text') p.onEdit(o.id);
          }}
        >
          {p.tool === 'edittext' && boxes?.map((b, i) => (
            <div key={i} className="titem" style={{ left: px(b.x - 1), top: px(b.y), width: px(b.w + 2), height: px(b.h) }} />
          ))}
          {p.objects.map((o) => (
            <ObjView key={o.id} o={o} scale={scale} selected={p.selected === o.id} editing={p.editing === o.id}
              showHandle={p.tool === 'select' && p.selected === o.id && o.type !== 'highlight'}
              onCommitText={p.onCommitText} />
          ))}
          {draftBox && <div className="draft" style={draftBox} />}
          {drag?.kind === 'ink' && (
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox={`0 0 ${page.width} ${page.height}`}>
              <polyline points={drag.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke={p.defaults.color} strokeWidth={p.defaults.stroke} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {p.pending && ghost && (
            <div className="ghost" style={{ left: px(ghost.x - p.pending.w / 2), top: px(ghost.y - p.pending.h / 2), width: px(p.pending.w), height: px(p.pending.h) }}>
              <img src={p.pending.src} alt="" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ObjView({ o, scale, selected, editing, showHandle, onCommitText }: {
  o: Obj; scale: number; selected: boolean; editing: boolean; showHandle: boolean; onCommitText: (id: string, t: string) => void;
}) {
  const style: React.CSSProperties = { left: o.x * scale, top: o.y * scale, width: o.w * scale, height: o.h * scale };
  const cls = `obj ${o.type}${selected ? ' sel' : ''}`;
  let inner: React.ReactNode = null;
  switch (o.type) {
    case 'highlight': style.background = o.color; break;
    case 'rect': style.borderColor = o.color; style.borderWidth = o.stroke * scale; break;
    case 'image': inner = <img src={o.src} alt="" draggable={false} />; break;
    case 'ink':
      inner = (
        <svg viewBox={`0 0 ${o.vw} ${o.vh}`} preserveAspectRatio="none">
          {o.points.map((s, i) => <polyline key={i} points={s.map((q) => q.join(',')).join(' ')} fill="none" stroke={o.color} strokeWidth={o.stroke} strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
      );
      break;
    case 'text':
      Object.assign(style, { fontSize: o.size * scale, color: o.color, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', width: 'auto', height: 'auto', minWidth: editing ? Math.max(o.w * scale, 40) : undefined, minHeight: o.size * 1.2 * scale });
      inner = editing ? <TextEditor o={o} onCommit={onCommitText} /> : o.text;
      break;
  }
  return (
    <div className={cls} data-obj={o.id} style={style}>
      {inner}
      {showHandle && !editing && <div className="handle" />}
    </div>
  );
}

function TextEditor({ o, onCommit }: { o: TextObj; onCommit: (id: string, t: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [val, setVal] = useState(o.text);
  const done = useRef(false);
  const latest = useRef(val);
  latest.current = val;
  const commit = () => { if (!done.current) { done.current = true; onCommit(o.id, latest.current); } };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const t = ref.current!;
    t.focus({ preventScroll: true });
    t.select();
    return () => commitRef.current(); // closed from outside (clicking elsewhere) also saves
  }, []);
  return (
    <>
      <span style={{ visibility: 'hidden', whiteSpace: 'pre' }}>{val || ' '}{'​'}</span>
      <textarea
        ref={ref}
        value={val}
        spellCheck={false}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commit(); }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </>
  );
}

export default memo(PageViewImpl);
