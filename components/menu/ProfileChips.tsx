'use client';
// The court's file on you, before the trial: one chip per fact the profile step heard. Click a chip
// to correct it (Enter or leaving the field saves, Escape cancels); empty basics show as "+ Age".
import { useState } from 'react';
import type { UserProfile } from '@/types';

type Key = 'name' | 'age' | 'situation' | 'location' | 'risk_tolerance' | 'people' | 'money' | 'goals' | 'fears';
const RISK = ['cautious', 'balanced', 'bold'] as const;
const FIELDS: { key: Key; label: string; basic?: boolean }[] = [
  { key: 'name', label: 'Name', basic: true },
  { key: 'age', label: 'Age', basic: true },
  { key: 'situation', label: 'Situation', basic: true },
  { key: 'location', label: 'Lives in', basic: true },
  { key: 'risk_tolerance', label: 'With risk', basic: true },
  { key: 'people', label: 'People' },
  { key: 'money', label: 'Money' },
  { key: 'goals', label: 'Wants' },
  { key: 'fears', label: 'Fears' },
];

const shown = (p: UserProfile, k: Key) => (p[k] == null || p[k] === '' ? '' : String(p[k]));

export default function ProfileChips({ profile, onChange }: { profile: UserProfile; onChange: (p: UserProfile) => void }) {
  const [editing, setEditing] = useState<Key | null>(null);
  const [value, setValue] = useState('');

  function open(k: Key) {
    setEditing(k);
    setValue(shown(profile, k));
  }
  function commit() {
    if (!editing) return;
    const v = value.trim();
    const next = { ...profile } as Record<string, unknown>;
    if (!v) delete next[editing];
    else if (editing === 'age') {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n) && n > 0 && n < 130) next.age = n;
    } else next[editing] = v;
    onChange(next as UserProfile);
    setEditing(null);
  }
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(null);
  };

  return (
    <div className="ct-chips" role="list" aria-label="What the court knows about you">
      {FIELDS.filter((f) => f.basic || shown(profile, f.key)).map((f) => {
        const v = shown(profile, f.key);
        if (editing === f.key)
          return (
            <span key={f.key} role="listitem" className="ct-chip editing">
              <span>{f.label}</span>
              {f.key === 'risk_tolerance' ? (
                <select aria-label={f.label} autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={keys}>
                  <option value="">—</option>
                  {RISK.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={f.label}
                  autoFocus
                  inputMode={f.key === 'age' ? 'numeric' : undefined}
                  size={Math.max(6, value.length + 1)}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onBlur={commit}
                  onKeyDown={keys}
                />
              )}
            </span>
          );
        return (
          <span key={f.key} role="listitem" className="contents">
            <button type="button" className={`ct-chip${v ? '' : ' empty'}`} onClick={() => open(f.key)} aria-label={`${f.label}: ${v || 'not set'}. Edit`}>
              <span>{f.label}</span>
              <span>{v || '+ add'}</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
