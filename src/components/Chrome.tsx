import type { ReactNode } from 'react';
import { href } from '../lib/router';

export function BackButton({ to, label }: { to: string; label: string }) {
  return (
    <a className="back" href={to} aria-label={label}>
      <svg aria-hidden="true" width="14" height="24" viewBox="0 0 14 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
        <path d="M11 3L3 12l8 9" />
      </svg>
    </a>
  );
}

export function Tick({ on }: { on: boolean }) {
  return on ? (
    <span className="tick tick-on" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="square">
        <path d="M2 6.5l2.6 2.6L10 3.4" />
      </svg>
    </span>
  ) : (
    <span className="tick" aria-hidden="true" />
  );
}

interface BarItem {
  label: string;
  to: string;
  active?: boolean;
}

/** Bottom bar: two destinations either side of the scan button. */
export function BottomBar({ left, right, scanSet }: { left: BarItem; right: BarItem; scanSet?: string }) {
  return (
    <nav className="bar" aria-label="Main">
      <a className={`bar-link bar-left${left.active ? ' is-active' : ''}`} href={left.to}>
        {left.label}
      </a>
      <a className="bar-scan" href={href(['scan'], { set: scanSet })}>
        SCAN
      </a>
      <a className={`bar-link bar-right${right.active ? ' is-active' : ''}`} href={right.to}>
        {right.label}
      </a>
    </nav>
  );
}

export function Screen({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <div className={`screen${dark ? ' screen-dark' : ''}`}>{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" className={o.id === value ? 'is-on' : ''} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
