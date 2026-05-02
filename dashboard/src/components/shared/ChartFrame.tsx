import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';

interface ChartFrameSize {
  width: number;
  height: number;
}

interface ChartFrameProps {
  children: (size: ChartFrameSize) => ReactNode;
  className: string;
  label: string;
}

export function ChartFrame({ children, className, label }: ChartFrameProps): ReactElement {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartFrameSize | null>(null);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize(rect.width > 0 && rect.height > 0
        ? { width: Math.floor(rect.width), height: Math.floor(rect.height) }
        : null);
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      const timeout = window.setTimeout(updateSize, 0);
      return () => window.clearTimeout(timeout);
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      setSize(rect && rect.width > 0 && rect.height > 0
        ? { width: Math.floor(rect.width), height: Math.floor(rect.height) }
        : null);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className={className}>
      {size ? children(size) : <div className="h-full min-h-[1px]" role="status" aria-label={label} />}
    </div>
  );
}
