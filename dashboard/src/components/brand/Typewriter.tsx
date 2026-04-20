/**
 * components/brand/Typewriter.tsx
 *
 * Character-by-character typewriter animation using setInterval.
 * Calls onDone when complete.
 */

import { useEffect, useState, useRef } from 'react';

export interface TypewriterProps {
  text: string;
  speed?: number;
  onDone?: () => void;
  className?: string;
}

export function Typewriter({ text, speed = 30, onDone, className = '' }: TypewriterProps) {
  const [displayedText, setDisplayedText] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayedText('');

    const timer = setInterval(() => {
      if (indexRef.current < text.length) {
        const char = text[indexRef.current];
        indexRef.current += 1;
        setDisplayedText((prev) => prev + char);
      } else {
        clearInterval(timer);
        onDone?.();
      }
    }, speed);

    return () => clearInterval(timer);
  }, [text, speed, onDone]);

  return <span className={className}>{displayedText}</span>;
}

export default Typewriter;
