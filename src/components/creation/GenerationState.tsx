'use client';

/** Motif's 3×3 loading mark; CSS motion stops when hidden or reduced motion is requested. */
export function LoadingState({ label, animated = true }: { label: string; animated?: boolean }) {
  return <div className="motif-loading" role="status"><span aria-hidden="true" className="motif-loading-mark" data-animated={animated}>{Array.from({length:9},(_,i)=><i key={i} style={{animationDelay:`${(Math.floor(i/3)+i%3)*100}ms`}}/>)}</span><span>{label}</span></div>;
}
