import { ReactNode } from "react";

interface AppDownloadLinkProps {
  link?: string;
  className?: string;
  children: ReactNode;
}

export function AppDownloadLink({ 
  link = "#", 
  className = "", 
  children 
}: AppDownloadLinkProps) {
  return (
    <a 
      href={link} 
      target="_blank" 
      rel="noopener noreferrer"
      className={`border-2 py-2 border-[#797979] rounded-md bg-[#313131] space-x-2 sm:space-x-3 px-3 sm:px-5 flex items-center gap-2 ${className}`}
    >
      {children}
    </a>
  );
}