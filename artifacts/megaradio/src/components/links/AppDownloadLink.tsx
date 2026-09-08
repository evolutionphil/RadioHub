import { ReactNode } from "react";

interface AppDownloadLinkProps {
  link?: string;
  className?: string;
  children: ReactNode;
  unavailableLabel?: string;
}

export function AppDownloadLink({ 
  link,
  className = "", 
  children,
  unavailableLabel = 'Download link unavailable',
}: AppDownloadLinkProps) {
  const classes = `border-2 py-2 border-[#797979] rounded-md bg-[#313131] space-x-2 sm:space-x-3 px-3 sm:px-5 flex items-center gap-2 ${className}`;
  if (!link) return (
    <span role="link" aria-disabled="true" title={unavailableLabel} className={classes}>
      {children}<span className="sr-only"> — {unavailableLabel}</span>
    </span>
  );
  return (
    <a 
      href={link} 
      target="_blank" 
      rel="noopener noreferrer"
      className={classes}
    >
      {children}
    </a>
  );
}
