import { useState, type DragEvent } from 'react';
import { FilePen, PenLine, FileText, FileType2, Layers, Upload, Lock } from 'lucide-react';
import { Logo } from './ui';
import { pickFiles, readFile, isDesktop, isMac, type PickedFile } from '../lib/platform';
import type { Action } from '../App';

const CARDS: { action: Action; title: string; text: string; icon: typeof FilePen; color: string; accept: string; multiple?: boolean }[] = [
  { action: 'edit', title: 'Editează PDF', text: 'Text, imagini, evidențiere, desen, pagini.', icon: FilePen, color: 'linear-gradient(135deg,#7c6cf2,#5b4bd6)', accept: '.pdf,application/pdf' },
  { action: 'sign', title: 'Semnează PDF', text: 'Desenează, scrie sau încarcă semnătura.', icon: PenLine, color: 'linear-gradient(135deg,#34c3a0,#1f9d83)', accept: '.pdf,application/pdf' },
  { action: 'toWord', title: 'PDF în Word', text: 'Transformă PDF-ul într-un .docx editabil.', icon: FileText, color: 'linear-gradient(135deg,#4a90f0,#2f6fd1)', accept: '.pdf,application/pdf', multiple: true },
  { action: 'toPdf', title: 'Word în PDF', text: 'Transformă un .docx într-un PDF curat.', icon: FileType2, color: 'linear-gradient(135deg,#f2a33a,#e07b1f)', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { action: 'merge', title: 'Combină PDF-uri', text: 'Unește mai multe fișiere într-unul.', icon: Layers, color: 'linear-gradient(135deg,#ec6aa0,#c94680)', accept: '.pdf,application/pdf', multiple: true },
];

export default function Home({ onFiles }: { onFiles: (f: PickedFile[], a: Action) => void }) {
  const [over, setOver] = useState(false);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = await Promise.all(Array.from(e.dataTransfer.files).map(readFile));
    onFiles(files, files.length > 1 ? 'merge' : 'edit');
  };

  return (
    <div className="home" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop}>
      <div className="home-bar" data-tauri-drag-region />
      <div className="home-inner">
        <div className="brand">
          <Logo />
          <div>
            <h1>MiPDF</h1>
            <p>Editează, semnează și convertește PDF-uri, simplu.</p>
          </div>
        </div>

        <div className={'drop' + (over ? ' over' : '')}>
          <div className="glyph"><Upload size={28} /></div>
          <h2>Trage aici un PDF sau un document Word</h2>
          <p>sau alege un fișier de pe {isDesktop ? (isMac ? 'Mac' : 'calculator') : 'dispozitiv'}</p>
          <button className="btn primary big" onClick={async () => onFiles(await pickFiles('.pdf,.docx,application/pdf'), 'edit')}>
            Alege fișier
          </button>
        </div>

        <div className="cards">
          {CARDS.map((c, i) => (
            <button key={c.action} className="card" style={{ animationDelay: `${0.1 + i * 0.04}s` }}
              onClick={async () => onFiles(await pickFiles(c.accept, c.multiple), c.action)}>
              <div className="ic" style={{ background: c.color }}><c.icon size={19} /></div>
              <b>{c.title}</b>
              <span>{c.text}</span>
            </button>
          ))}
        </div>

        <div className="privacy"><Lock size={13} /> Fișierele tale nu pleacă nicăieri: totul se procesează local, pe dispozitivul tău.</div>
      </div>
    </div>
  );
}
