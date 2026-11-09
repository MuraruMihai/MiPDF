import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, MousePointer2, TextCursorInput, Type, Highlighter, PenTool, Square, Eraser, ImagePlus, PenLine,
  Undo2, Redo2, ZoomIn, ZoomOut, ChevronDown, FileDown, FileText, FilePlus2, Trash2, Bold, Italic, Copy, PanelLeft, X,
} from 'lucide-react';
import { loadPdf } from '../lib/pdfjs';
import { uid, type DocState, type Obj, type PageRef, type SourceDoc, type Tool } from '../lib/model';
import { pickFiles, saveFile, baseName, isDesktop, isMac, modKey, type PickedFile } from '../lib/platform';
import { measureText } from '../lib/measure';
import PageView, { type Defaults, type Pending } from './PageView';
import Thumbs from './Thumbs';
import SignatureModal, { toPngDataUrl } from './SignatureModal';
import { useUI } from './ui';
import type { Action } from '../App';

export interface OpenRequest { files: PickedFile[]; action: Action; converted?: boolean; key: number }

const TOOLS: { id: Tool; label: string; icon: typeof Type; key: string }[] = [
  { id: 'select', label: 'Selectează', icon: MousePointer2, key: 'v' },
  { id: 'edittext', label: 'Editează text', icon: TextCursorInput, key: 'e' },
  { id: 'text', label: 'Text', icon: Type, key: 't' },
  { id: 'highlight', label: 'Evidențiază', icon: Highlighter, key: 'h' },
  { id: 'ink', label: 'Desen', icon: PenTool, key: 'p' },
  { id: 'rect', label: 'Formă', icon: Square, key: 'r' },
  { id: 'whiteout', label: 'Acoperă', icon: Eraser, key: 'w' },
];
const COLORS = ['#111114', '#e5484d', '#2f6fd1', '#1f9d63', '#6b5cf0'];
const HIGHLIGHTS = ['#ffd60a', '#7ee081', '#ff8fc7', '#7cc4ff'];
const PT2PX = 96 / 72;

interface Hist { past: DocState[]; present: DocState; future: DocState[] }

export default function Editor({ request, onClose }: { request: OpenRequest; onClose: () => void }) {
  const { toast, setBusy } = useUI();
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [hist, setHist] = useState<Hist>({ past: [], present: { pages: [], objects: [] }, future: [] });
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState(true);
  const [scale, setScale] = useState(1.25);
  const [active, setActive] = useState<string | null>(null);
  const [dirty, setDirty] = useState(!!request.converted);
  const [defaults, setDefaults] = useState<Defaults>({ color: COLORS[0], highlight: HIGHLIGHTS[0], stroke: 2, size: 14, bold: false, italic: false });
  const viewport = useRef<HTMLDivElement>(null);
  const name = request.files.length > 1 ? 'Document combinat.pdf' : request.files[0].name;

  const state = hist.present;
  const pdfs = useMemo(() => new Map(sources.map((s) => [s.id, s.pdf])), [sources]);

  // ---------- history ----------
  const commit = useCallback((fn: (s: DocState) => DocState) => {
    setHist((h) => ({ past: [...h.past.slice(-80), h.present], present: fn(h.present), future: [] }));
    setDirty(true);
  }, []);
  const live = useCallback((fn: (s: DocState) => DocState) => setHist((h) => ({ ...h, present: fn(h.present) })), []);
  const begin = useCallback(() => { setHist((h) => ({ past: [...h.past.slice(-80), h.present], present: h.present, future: [] })); setDirty(true); }, []);
  const undo = () => setHist((h) => h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h);
  const redo = () => setHist((h) => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h);

  // ---------- loading ----------
  const addSources = useCallback(async (files: PickedFile[]) => {
    const docs: SourceDoc[] = [];
    const pages: PageRef[] = [];
    for (const f of files) {
      const pdf = await loadPdf(f.bytes);
      const id = uid('d');
      docs.push({ id, name: f.name, bytes: f.bytes, pdf });
      for (let i = 0; i < pdf.numPages; i++) {
        const pg = await pdf.getPage(i + 1);
        const vp = pg.getViewport({ scale: 1, rotation: 0 });
        pages.push({ id: uid('p'), doc: id, index: i, width: vp.width, height: vp.height, baseRotation: pg.rotate, rotation: 0 });
      }
    }
    setSources((s) => [...s, ...docs]);
    return pages;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pages = await addSources(request.files);
        if (!alive) return;
        setHist({ past: [], present: { pages, objects: [] }, future: [] });
        // Fit width
        const vw = (viewport.current?.clientWidth || 900) - 64;
        const maxW = Math.max(...pages.map((p) => (p.baseRotation % 180 ? p.height : p.width)));
        setScale(clamp(Math.min(vw / maxW, 1.5 * PT2PX)));
        setActive(pages[0]?.id || null);
        if (request.action === 'sign') setSignOpen(true);
        if (request.action === 'merge' && request.files.length > 1) toast(`Am combinat ${request.files.length} fișiere. Reordonează paginile din bara laterală.`);
      } catch (e) {
        toast('Nu am putut deschide PDF-ul: ' + (e as Error).message, true);
        onClose();
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- object ops ----------
  const onAdd = useCallback((objs: Obj[], select?: string, edit?: boolean) => {
    commit((s) => ({ ...s, objects: [...s.objects, ...objs] }));
    if (select) setSelected(select);
    if (edit) setEditing(select || null);
  }, [commit]);
  const onLive = useCallback((id: string, patch: Partial<Obj>) => live((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as Obj) : o)) })), [live]);
  const patchSel = (patch: Partial<Obj>) => {
    if (!selected) return;
    commit((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        if (o.id !== selected) return o;
        const n = { ...o, ...patch } as Obj;
        if (n.type === 'text') Object.assign(n, measureText(n) && { w: measureText(n).w, h: measureText(n).h });
        return n;
      }),
    }));
  };
  const remove = (id: string) => {
    commit((s) => {
      const o = s.objects.find((x) => x.id === id);
      const cover = o?.type === 'text' ? o.coverId : undefined;
      return { ...s, objects: s.objects.filter((x) => x.id !== id && x.id !== cover) };
    });
    setSelected(null);
    setEditing(null);
  };
  const duplicate = () => {
    const o = state.objects.find((x) => x.id === selected);
    if (!o) return;
    const c = { ...o, id: uid(), x: o.x + 12, y: o.y + 12 } as Obj;
    if (c.type === 'text') delete c.coverId;
    onAdd([c], c.id);
  };
  const onCommitText = useCallback((id: string, text: string) => {
    setEditing(null);
    setHist((h) => {
      const o = h.present.objects.find((x) => x.id === id);
      if (!o || o.type !== 'text') return h;
      let objects: Obj[];
      if (!text.trim() && !o.coverId) objects = h.present.objects.filter((x) => x.id !== id);
      else objects = h.present.objects.map((x) => (x.id === id ? ({ ...o, text, ...measureText({ ...o, text }) } as Obj) : x));
      return { ...h, present: { ...h.present, objects } };
    });
    setTool((t) => (t === 'text' ? 'select' : t));
  }, []);

  // ---------- pages ----------
  const rotate = (id: string) => commit((s) => ({ ...s, pages: s.pages.map((p) => (p.id === id ? { ...p, rotation: (p.rotation + 90) % 360 } : p)) }));
  const delPage = (id: string) => commit((s) => ({ pages: s.pages.filter((p) => p.id !== id), objects: s.objects.filter((o) => o.page !== id) }));
  const movePage = (from: number, to: number) => commit((s) => {
    const pages = [...s.pages];
    const [m] = pages.splice(from, 1);
    pages.splice(to, 0, m);
    return { ...s, pages };
  });
  const insertPdf = async () => {
    const files = await pickFiles('.pdf,application/pdf', true);
    if (!files.length) return;
    const pages = await addSources(files);
    commit((s) => {
      const at = active ? s.pages.findIndex((p) => p.id === active) + 1 : s.pages.length;
      const all = [...s.pages];
      all.splice(at, 0, ...pages);
      return { ...s, pages: all };
    });
    toast(`Am adăugat ${pages.length} ${pages.length === 1 ? 'pagină' : 'pagini'}.`);
  };
  const jump = (id: string) => {
    const el = viewport.current?.querySelector(`[data-page="${id}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  // active page follows scrolling
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = vp.getBoundingClientRect().top + vp.clientHeight / 3;
        let best: string | null = null;
        vp.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.top <= mid) best = el.dataset.page!;
        });
        if (best) setActive(best);
      });
    };
    vp.addEventListener('scroll', onScroll, { passive: true });
    return () => vp.removeEventListener('scroll', onScroll);
  }, []);

  // ---------- zoom (keeps the point under the cursor/center stable) ----------
  const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
    const vp = viewport.current;
    if (!vp) return;
    setScale((prev) => {
      const s = clamp(next);
      const r = vp.getBoundingClientRect();
      const ox = (cx ?? r.left + r.width / 2) - r.left;
      const oy = (cy ?? r.top + r.height / 2) - r.top;
      const k = s / prev;
      requestAnimationFrame(() => {
        vp.scrollLeft = (vp.scrollLeft + ox) * k - ox;
        vp.scrollTop = (vp.scrollTop + oy) * k - oy;
      });
      return s;
    });
  }, []);
  useEffect(() => {
    const vp = viewport.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // pinch on trackpads arrives as ctrl+wheel
      e.preventDefault();
      setScale((s) => { const n = clamp(s * Math.exp(-e.deltaY * 0.01)); zoomAt(n, s, e.clientX, e.clientY); return n; });
    };
    const zoomAt = (n: number, s: number, cx: number, cy: number) => {
      const r = vp.getBoundingClientRect();
      const ox = cx - r.left, oy = cy - r.top, k = n / s;
      requestAnimationFrame(() => { vp.scrollLeft = (vp.scrollLeft + ox) * k - ox; vp.scrollTop = (vp.scrollTop + oy) * k - oy; });
    };
    vp.addEventListener('wheel', wheel, { passive: false });
    return () => vp.removeEventListener('wheel', wheel);
  }, []);

  // ---------- export ----------
  const buildPdf = async () => {
    const { exportPdf } = await import('../lib/exportPdf');
    return exportPdf(state, sources);
  };
  const savePdf = async () => {
    setEditing(null);
    try {
      setBusy({ title: 'Salvez PDF-ul' });
      const bytes = await buildPdf();
      setBusy(null);
      const out = /\.pdf$/i.test(name) ? (dirty && !request.converted ? baseName(name) + ' (editat).pdf' : name) : baseName(name) + '.pdf';
      if (await saveFile(out, bytes)) { setDirty(false); toast(`Salvat: ${out}`); }
    } catch (e) {
      setBusy(null);
      toast('Salvarea a eșuat: ' + (e as Error).message, true);
    }
  };
  const exportWord = async () => {
    setMenu(false);
    try {
      setBusy({ title: 'Convertesc în Word', pct: 0 });
      const bytes = await buildPdf();
      const { pdfToWord } = await import('../lib/pdfToWord');
      const docx = await pdfToWord(bytes, (d, t) => setBusy({ title: 'Convertesc în Word', detail: `Pagina ${d} din ${t}`, pct: d / t }));
      setBusy(null);
      if (await saveFile(baseName(name) + '.docx', docx)) toast(`Gata: ${baseName(name)}.docx`);
    } catch (e) {
      setBusy(null);
      toast('Conversia a eșuat: ' + (e as Error).message, true);
    }
  };
  const addImage = async () => {
    const [f] = await pickFiles('image/png,image/jpeg,image/webp');
    if (!f) return;
    const src = await toPngDataUrl(f.bytes);
    const im = new Image();
    im.src = src;
    await im.decode();
    const w = Math.min(240, im.naturalWidth * 0.75);
    setPending({ src, w, h: (w * im.naturalHeight) / im.naturalWidth });
  };
  const close = () => {
    if (dirty && !confirm('Ai modificări nesalvate. Închizi documentul?')) return;
    onClose();
  };

  // ---------- keyboard ----------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = (e.target as HTMLElement)?.closest('input,textarea,[contenteditable]');
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); savePdf(); return; }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomTo(scale * 1.2); return; }
    if (mod && e.key === '-') { e.preventDefault(); zoomTo(scale / 1.2); return; }
    if (mod && e.key === '0') { e.preventDefault(); zoomTo(PT2PX); return; }
    if (mod && e.key.toLowerCase() === 'd' && selected) { e.preventDefault(); duplicate(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selected) { e.preventDefault(); remove(selected); return; }
    if (e.key === 'Escape') { setPending(null); setSelected(null); setTool('select'); setMenu(false); return; }
    if (e.key === 'Enter' && selected && state.objects.find((o) => o.id === selected)?.type === 'text') { e.preventDefault(); setEditing(selected); return; }
    if (!mod && !e.altKey) {
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) { pickTool(t.id); return; }
      if (e.key.toLowerCase() === 's') setSignOpen(true);
    }
    if (selected && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const o = state.objects.find((x) => x.id === selected)!;
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      patchSel({ x: o.x + dx, y: o.y + dy });
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const pickTool = (t: Tool) => { setTool(t); setPending(null); setEditing(null); if (t !== 'select') setSelected(null); };

  const sel = state.objects.find((o) => o.id === selected) || null;
  const showText = tool === 'text' || sel?.type === 'text';
  const showStroke = (tool === 'ink' || tool === 'rect') && !sel || sel?.type === 'ink' || sel?.type === 'rect';
  const showHl = tool === 'highlight' || sel?.type === 'highlight';
  const curColor = sel && 'color' in sel ? sel.color : defaults.color;
  const setColor = (c: string) => { setDefaults((d) => ({ ...d, [showHl ? 'highlight' : 'color']: c })); if (sel && 'color' in sel) patchSel({ color: c } as Partial<Obj>); };

  const objsByPage = useMemo(() => {
    const m = new Map<string, Obj[]>();
    for (const o of state.objects) m.set(o.page, [...(m.get(o.page) || []), o]);
    return m;
  }, [state.objects]);
  const empty: Obj[] = useMemo(() => [], []);

  return (
    <div className={'editor' + (side ? '' : ' no-side')}>
      <header className={'toolbar' + (isDesktop && isMac ? ' mac-inset' : '')} data-tauri-drag-region>
        <button className="btn icon" onClick={close} title="Înapoi" aria-label="Înapoi"><ChevronLeft size={18} /></button>
        <button className="btn icon hide-sm" onClick={() => setSide((s) => !s)} title="Bara laterală" aria-label="Bara laterală"><PanelLeft size={17} /></button>
        <div className="title" data-tauri-drag-region>{name}<small>{state.pages.length} {state.pages.length === 1 ? 'pagină' : 'pagini'}{dirty ? ' · modificat' : ''}</small></div>
        <div className="spacer" data-tauri-drag-region />
        <div className="seg" role="toolbar" aria-label="Unelte">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id && !pending ? 'on' : ''} onClick={() => pickTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`} aria-label={t.label} aria-pressed={tool === t.id}>
              <t.icon size={15} />{(t.id === 'edittext') && <span className="lbl">{t.label}</span>}
            </button>
          ))}
        </div>
        <button className="btn icon" onClick={addImage} title="Adaugă imagine" aria-label="Adaugă imagine"><ImagePlus size={17} /></button>
        <button className="btn" onClick={() => setSignOpen(true)} title="Semnează (S)"><PenLine size={16} /><span className="hide-sm">Semnează</span></button>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn icon" onClick={undo} disabled={!hist.past.length} title={`Anulează (${modKey}Z)`} aria-label="Anulează"><Undo2 size={16} /></button>
        <button className="btn icon" onClick={redo} disabled={!hist.future.length} title="Refă" aria-label="Refă"><Redo2 size={16} /></button>
        <div className="divider hide-sm" />
        <button className="btn icon hide-sm" onClick={() => zoomTo(scale / 1.2)} aria-label="Micșorează"><ZoomOut size={16} /></button>
        <span className="zoom hide-sm">{Math.round((scale / PT2PX) * 100)}%</span>
        <button className="btn icon hide-sm" onClick={() => zoomTo(scale * 1.2)} aria-label="Mărește"><ZoomIn size={16} /></button>
        <div className="divider" />
        <div className="menu-wrap">
          <button className="btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>Export <ChevronDown size={14} /></button>
          {menu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onPointerDown={() => setMenu(false)} />
              <div className="menu" role="menu">
                <button onClick={() => { setMenu(false); savePdf(); }}><FileDown size={15} /> Salvează ca PDF</button>
                <button onClick={exportWord}><FileText size={15} /> Exportă în Word (.docx)</button>
                <hr />
                <button onClick={() => { setMenu(false); insertPdf(); }}><FilePlus2 size={15} /> Adaugă pagini din alt PDF…</button>
              </div>
            </>
          )}
        </div>
        <button className="btn primary" onClick={savePdf}>Salvează</button>
      </header>

      {side ? (
        <Thumbs pages={state.pages} pdfs={pdfs} active={active} onJump={jump} onRotate={rotate} onDelete={delPage} onMove={movePage} onInsert={insertPdf} />
      ) : <div />}

      <main className="viewport" ref={viewport} onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pages')) { setSelected(null); setEditing(null); } }}>
        <div className="pages">
          {state.pages.map((pg) => (
            <PageView
              key={pg.id}
              page={pg}
              pdf={pdfs.get(pg.doc)!}
              scale={scale}
              objects={objsByPage.get(pg.id) || empty}
              tool={tool}
              selected={selected}
              editing={editing}
              pending={pending}
              defaults={defaults}
              onSelect={setSelected}
              onEdit={setEditing}
              onBegin={begin}
              onLive={onLive}
              onAdd={onAdd}
              onPlaced={() => { setPending(null); setTool('select'); }}
              onCommitText={onCommitText}
            />
          ))}
        </div>
      </main>

      {(pending || tool === 'edittext' || showText || showStroke || showHl || sel) && (
        <div className="inspector" key={pending ? 'p' : tool + (sel?.type || '')}>
          {pending ? (
            <>
              <span className="hint">Dă clic pe pagină unde vrei să o plasezi</span>
              <button className="btn icon" onClick={() => setPending(null)} aria-label="Anulează"><X size={15} /></button>
            </>
          ) : (
            <>
              {tool === 'edittext' && !sel && <span className="hint">Dă clic pe un rând de text ca să-l modifici</span>}
              {showText && (
                <>
                  <input className="num-input" type="number" min={4} max={200} aria-label="Mărime font"
                    value={Math.round((sel?.type === 'text' ? sel.size : defaults.size) * 10) / 10}
                    onChange={(e) => { const v = Math.max(4, +e.target.value || 4); setDefaults((d) => ({ ...d, size: v })); if (sel?.type === 'text') patchSel({ size: v } as Partial<Obj>); }} />
                  <button className={'btn icon' + ((sel?.type === 'text' ? sel.bold : defaults.bold) ? ' secondary' : '')} aria-label="Îngroșat"
                    onClick={() => { const v = !(sel?.type === 'text' ? sel.bold : defaults.bold); setDefaults((d) => ({ ...d, bold: v })); if (sel?.type === 'text') patchSel({ bold: v } as Partial<Obj>); }}><Bold size={15} /></button>
                  <button className={'btn icon' + ((sel?.type === 'text' ? sel.italic : defaults.italic) ? ' secondary' : '')} aria-label="Cursiv"
                    onClick={() => { const v = !(sel?.type === 'text' ? sel.italic : defaults.italic); setDefaults((d) => ({ ...d, italic: v })); if (sel?.type === 'text') patchSel({ italic: v } as Partial<Obj>); }}><Italic size={15} /></button>
                  <div className="divider" />
                </>
              )}
              {(showText || showStroke) && COLORS.map((c) => <button key={c} className={'swatch' + (curColor === c ? ' on' : '')} style={{ background: c }} aria-label="Culoare" onClick={() => setColor(c)} />)}
              {showHl && HIGHLIGHTS.map((c) => <button key={c} className={'swatch' + ((sel?.type === 'highlight' ? sel.color : defaults.highlight) === c ? ' on' : '')} style={{ background: c }} aria-label="Culoare" onClick={() => setColor(c)} />)}
              {showStroke && (
                <>
                  <div className="divider" />
                  {[1, 2, 4].map((w) => {
                    const cur = sel && 'stroke' in sel ? sel.stroke : defaults.stroke;
                    return (
                      <button key={w} className={'btn icon' + (cur === w ? ' secondary' : '')} aria-label={`Grosime ${w}`}
                        onClick={() => { setDefaults((d) => ({ ...d, stroke: w })); if (sel && 'stroke' in sel) patchSel({ stroke: w } as Partial<Obj>); }}>
                        <span style={{ width: 16, height: w + 0.5, background: 'currentColor', borderRadius: 4 }} />
                      </button>
                    );
                  })}
                </>
              )}
              {sel && (
                <>
                  {(showText || showStroke || showHl) && <div className="divider" />}
                  <button className="btn icon" onClick={duplicate} title={`Duplică (${modKey}D)`} aria-label="Duplică"><Copy size={15} /></button>
                  <button className="btn icon danger" onClick={() => remove(sel.id)} title="Șterge (⌫)" aria-label="Șterge"><Trash2 size={15} /></button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {signOpen && (
        <SignatureModal
          onCancel={() => setSignOpen(false)}
          onDone={(s) => { setSignOpen(false); setPending({ ...s, signature: true }); setSelected(null); }}
        />
      )}
    </div>
  );
}

function clamp(s: number) {
  return Math.min(6, Math.max(0.25, s));
}
