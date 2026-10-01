import { useId, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Search, RotateCcw, MapPin } from 'lucide-react';
import './region-directory.css';

export function DirectoryPage({ title, description, backHref, backLabel, summary, children }: {
  title: string; description?: string; backHref?: string; backLabel?: string; summary?: ReactNode; children: ReactNode;
}) {
  return <section className="region-directory">
    <header className="region-directory-heading">
      <div className="container region-directory-container">
        {backHref && <Link href={backHref} className="region-directory-back"><ArrowLeft size={18} aria-hidden="true" />{backLabel}</Link>}
        <div className="region-directory-title-row">
          <div><h1>{title}</h1>{description && <p className="region-directory-description">{description}</p>}</div>
          {summary && <div className="region-directory-summary">{summary}</div>}
        </div>
      </div>
    </header>
    <div className="container region-directory-container region-directory-content">{children}</div>
  </section>;
}
export function DirectoryToolbar({ search, onSearch, searchLabel, sort, onSort, sortOptions, sortLabel = 'Sort by' }: {
  search: string; onSearch: (value: string) => void; searchLabel: string;
  sort: string; onSort: (value: string) => void; sortOptions: Array<{ value: string; label: string }>; sortLabel?: string;
}) {
  const inputId = useId();
  const sortId = useId();
  return <div className="region-directory-toolbar">
    <div className="region-directory-search">
      <label className="sr-only" htmlFor={inputId}>{searchLabel}</label>
      <Search size={20} aria-hidden="true" />
      <input id={inputId} type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder={searchLabel} maxLength={200} autoComplete="off" />
    </div>
    <div className="region-directory-sort">
      <label htmlFor={sortId}>{sortLabel}</label>
      <select id={sortId} value={sort} onChange={event => onSort(event.target.value)}>
        {sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  </div>;
}
export function DirectoryStatus({ kind, label, detail, onRetry, retryLabel }: {
  kind: 'loading' | 'error' | 'empty'; label: string; detail?: string; onRetry?: () => void; retryLabel?: string;
}) {
  if (kind === 'loading') return <div role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="region-directory-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, index) =>
      <div className="region-directory-skeleton" key={index}><span /><div><span /><span /></div></div>)}</div>
  </div>;
  return <div className="region-directory-status" role={kind === 'error' ? 'alert' : 'status'}>
    <MapPin size={28} aria-hidden="true" /><p>{label}</p>{detail && <p className="region-directory-description">{detail}</p>}
    {onRetry && <button type="button" className="region-directory-button" onClick={onRetry}><RotateCcw size={16} aria-hidden="true" />{retryLabel}</button>}
  </div>;
}
export function DirectoryCard({ href, title, description, icon }: {
  href: string; title: string; description?: string; icon?: ReactNode;
}) {
  return <Link href={href} className="region-directory-card">
    <span className="region-directory-card-icon" aria-hidden="true">{icon || <MapPin size={24} />}</span>
    <div className="region-directory-card-copy"><h2>{title}</h2>{description && <p>{description}</p>}</div>
    <ArrowRight className="region-directory-card-arrow" size={20} aria-hidden="true" />
  </Link>;
}
