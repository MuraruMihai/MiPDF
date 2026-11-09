import logoUrl from '../../brand/logo.svg';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface Toast { id: number; text: string; err?: boolean }
interface Busy { title: string; detail?: string; pct?: number }
interface UI {
  toast: (text: string, err?: boolean) => void;
  setBusy: (b: Busy | null) => void;
}
const Ctx = createContext<UI>(null!);
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<Busy | null>(null);
  const n = useRef(0);
  const toast = useCallback((text: string, err?: boolean) => {
    const id = ++n.current;
    setToasts((t) => [...t.slice(-2), { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 5200 : 3200);
  }, []);
  return (
    <Ctx.Provider value={{ toast, setBusy }}>
      {children}
      {busy && (
        <div className="scrim" role="alertdialog" aria-live="polite">
          <div className="progress">
            <b>{busy.title}</b>
            <span>{busy.detail || 'Totul se procesează pe dispozitivul tău.'}</span>
            <div className={'bar' + (busy.pct == null ? ' indeterminate' : '')}><i style={{ width: `${(busy.pct ?? 0) * 100}%` }} /></div>
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>
            {t.err ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />} {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function Logo({ size = 56 }: { size?: number }) {
  return <img className="logo" src={logoUrl} width={size} height={size} alt="" draggable={false} />;
}
