import React from "react";

export function HighlightMatch({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  if (!query) return <>{text}</>;
  const haystack = text ?? "";
  const needle = query;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (!lowerNeedle || !lowerHay.includes(lowerNeedle)) return <>{haystack}</>;

  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < haystack.length) {
    const idx = lowerHay.indexOf(lowerNeedle, i);
    if (idx === -1) {
      parts.push(haystack.slice(i));
      break;
    }
    if (idx > i) parts.push(haystack.slice(i, idx));
    parts.push(
      <mark
        key={key++}
        className="bg-transparent text-[#FF4199] font-bold"
      >
        {haystack.slice(idx, idx + needle.length)}
      </mark>
    );
    i = idx + needle.length;
  }
  return <>{parts}</>;
}
