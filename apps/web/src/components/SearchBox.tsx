import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMovies } from '../lib/queries';
import { Poster } from './Poster';

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** MOV-4: title search, debounced 300 ms. */
export function SearchBox({ className }: { className?: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 300);
  const { data, isFetching } = useMovies({ q }, q.length >= 2);
  const results = q.length >= 2 ? (data ?? []).slice(0, 6) : [];
  const navigate = useNavigate();
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (id: string) => {
    setOpen(false);
    setText('');
    navigate(`/movies/${id}`);
  };

  return (
    <div ref={boxRef} className={className}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            else if (e.key === 'Enter' && results[active]) go(results[active].id);
            else if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Search for movies"
          aria-label="Search for movies"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          className="w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
        />
        {open && q.length >= 2 && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
            {results.length ? (
              <ul id={listId} role="listbox">
                {results.map((m, i) => (
                  <li key={m.id} role="option" aria-selected={i === active}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(m.id)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? 'bg-surface' : ''}`}
                    >
                      <Poster path={m.posterPath} title={m.title} size="w185" className="w-9 shrink-0 rounded" />
                      <span>
                        <span className="block text-sm font-medium">{m.title}</span>
                        <span className="block text-xs text-ink-muted">
                          {m.status === 'upcoming' ? 'Coming soon' : m.languages.join(', ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-sm text-ink-muted">{isFetching ? 'Searching…' : 'No movies found'}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
