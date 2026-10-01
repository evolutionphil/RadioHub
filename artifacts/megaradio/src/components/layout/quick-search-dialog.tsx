import type { ReactNode, RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, X, Headphones } from 'lucide-react';
import './quick-search-dialog.css';

interface Props {
  children: ReactNode;
  title: string;
  hint: string;
  closeLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  stationName?: string;
  playing?: boolean;
}

/** Loaded only on interaction; no route, history or audio mutations. */
export default function QuickSearchDialog({ children, title, hint, closeLabel, inputRef, returnFocusRef, onClose, stationName, playing }: Props) {
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="quick-search-backdrop" data-testid="quick-search-overlay" />
        <Dialog.Content
          id="quick-search-dialog"
          data-search-element
          className="quick-search-panel font-ubuntu"
          onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus({ preventScroll: true }); }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
          onKeyDown={event => {
            // Do not let the underlying /search page's arrow/Escape handlers
            // steal focus, or let a global player interpret typing as playback.
            event.stopPropagation();
            if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
              event.preventDefault(); inputRef.current?.focus(); inputRef.current?.select();
            }
          }}
        >
          <header className="quick-search-heading">
            <div className="quick-search-mark" aria-hidden="true"><Search size={21} strokeWidth={1.7} /></div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="quick-search-title">{title}</Dialog.Title>
              <Dialog.Description className="quick-search-description">{hint}</Dialog.Description>
            </div>
            <Dialog.Close className="quick-search-close" aria-label={closeLabel}><X size={19} /></Dialog.Close>
          </header>
          {children}
          {stationName && (
            <div className="quick-search-listening" data-testid="quick-search-current-station">
              <Headphones size={14} aria-hidden="true" />
              <span className="truncate">{stationName}</span>
              {playing && <span className="quick-search-equalizer" aria-hidden="true"><i /><i /><i /><i /></span>}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
