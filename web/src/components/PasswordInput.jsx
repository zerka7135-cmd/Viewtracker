import { useState } from 'react';

const EYE_PATH = 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z';
const EYE_OFF_PATHS = [
  'M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-6.06',
  'M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.77 21.77 0 0 1-2.16 3.19',
  'M14.12 14.12a3 3 0 1 1-4.24-4.24'
];

// Champ mot de passe avec bouton "afficher/masquer" (icône œil) — utilisé
// sur l'écran de login et de réinitialisation.
export default function PasswordInput({ value, onChange, placeholder, style, autoFocus }) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        style={{ ...style, width: '100%', paddingRight: 38, boxSizing: 'border-box' }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 6,
          display: 'flex', alignItems: 'center', color: 'var(--text-muted)'
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {visible ? (
            <>
              {EYE_OFF_PATHS.map((d) => <path key={d} d={d} />)}
              <line x1="1" y1="1" x2="23" y2="23" />
            </>
          ) : (
            <>
              <path d={EYE_PATH} />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
