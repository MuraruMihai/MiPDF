import { useCallback, useEffect, useRef, useState } from 'react';
import { UIProvider, useUI } from './components/ui';
import Home from './components/Home';
import Editor, { type OpenRequest } from './components/Editor';
import { baseName, isDesktop, saveFile, type PickedFile } from './lib/platform';

export default function App() {
  return (
    <UIProvider>
      <Shell />
    </UIProvider>
  );
}

export type Action = 'edit' | 'sign' | 'toWord' | 'toPdf' | 'merge';

function Shell() {
  const [open, setOpen] = useState<OpenRequest | null>(null);
  const { toast, setBusy } = useUI();

  const handle = useCallback(async (files: PickedFile[], action: Action) => {
    if (!files.length) return;
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || isPdf(f.bytes));
    const docs = files.filter((f) => /\.docx$/i.test(f.name));
    try {
      if (action === 'toWord') {
        for (const f of pdfs) {
          setBusy({ title: `Convertesc „${f.name}” în Word`, pct: 0 });
          const { pdfToWord } = await import('./lib/pdfToWord');
          const out = await pdfToWord(f.bytes, (d, t) => setBusy({ title: `Convertesc „${f.name}” în Word`, detail: `Pagina ${d} din ${t}`, pct: d / t }));
          setBusy(null);
          if (await saveFile(baseName(f.name) + '.docx', out)) toast(`Gata: ${baseName(f.name)}.docx`);
        }
        if (!pdfs.length) toast('Alege un fișier PDF.', true);
        return;
      }
      if (action === 'toPdf' || (docs.length && !pdfs.length)) {
        const f = docs[0];
        if (!f) { toast('Alege un document Word (.docx).', true); return; }
        setBusy({ title: `Convertesc „${f.name}” în PDF` });
        const { wordToPdf } = await import('./lib/wordToPdf');
        const out = await wordToPdf(f.bytes);
        setBusy(null);
        setOpen({ files: [{ name: baseName(f.name) + '.pdf', bytes: out }], action: 'edit', converted: true, key: Date.now() });
        toast('Convertit. Verifică rezultatul și apasă Salvează.');
        return;
      }
      if (!pdfs.length) { toast('Fișierul nu pare să fie un PDF.', true); return; }
      setOpen({ files: pdfs, action, key: Date.now() });
    } catch (e) {
      console.error(e);
      setBusy(null);
      toast('Nu am putut procesa fișierul: ' + (e as Error).message, true);
    }
  }, [setBusy, toast]);

  // Desktop: files opened with double-click / "Open with MiPDF" / the Dock icon.
  const handleRef = useRef(handle);
  handleRef.current = handle;
  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const open = async (paths: string[]) => {
        const files = await Promise.all(paths.map(async (p) => ({ name: p.split(/[\\/]/).pop() || 'document.pdf', bytes: await readFile(p) })));
        if (files.length) handleRef.current(files, files.length > 1 ? 'merge' : 'edit');
      };
      unlisten = await listen<string[]>('open-files', (e) => open(e.payload));
      open(await invoke<string[]>('take_opened_files'));
    })().catch(console.error);
    return () => unlisten?.();
  }, []);

  return open
    ? <Editor key={open.key} request={open} onClose={() => setOpen(null)} />
    : <Home onFiles={handle} />;
}

function isPdf(b: Uint8Array) {
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}
