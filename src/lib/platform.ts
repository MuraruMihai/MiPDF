// PlatformBridge: the only place that knows if we run in a browser or in the desktop app.
type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };
export const isDesktop = typeof window !== 'undefined' && !!(window as TauriWindow).__TAURI_INTERNALS__;
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';

export interface PickedFile { name: string; bytes: Uint8Array }

export function pickFiles(accept: string, multiple = false): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      resolve(await Promise.all(files.map(readFile)));
      input.remove();
    };
    input.oncancel = () => { resolve([]); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

export async function readFile(f: File): Promise<PickedFile> {
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Saves bytes. Desktop: native Save dialog. Web: download. Returns false if cancelled. */
export async function saveFile(name: string, bytes: Uint8Array): Promise<boolean> {
  const ext = name.split('.').pop()!.toLowerCase();
  if (isDesktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: name,
      filters: [{ name: ext === 'pdf' ? 'PDF' : 'Word', extensions: [ext] }],
    });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const blob = new Blob([bytes as BlobPart], { type: MIME[ext] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '');
}
