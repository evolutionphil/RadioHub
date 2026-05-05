import { useState, useEffect, useRef, ReactNode } from 'react';

interface InViewProps {
  children: (inView: boolean) => ReactNode;
  rootMargin?: string;
  threshold?: number;
  triggerOnce?: boolean;
  minHeight?: string;
  className?: string;
}

export function InView({ 
  children, 
  rootMargin = '200px', 
  threshold = 0.1, 
  triggerOnce = true,
  minHeight,
  className
}: InViewProps) {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        const isIntersecting = entry.isIntersecting;
        if (isIntersecting) {
          setInView(true);
          if (triggerOnce) {
            observer.disconnect();
          }
        } else if (!triggerOnce) {
          setInView(false);
        }
      },
      { rootMargin, threshold }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [rootMargin, threshold, triggerOnce]);

  const style = minHeight ? { minHeight } : undefined;
  return <div ref={ref} style={style} className={className}>{children(inView)}</div>;
}