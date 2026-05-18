const TEAL = "#008B9B";
const RED = "#A31616";

function IconMicroscope({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path fill={color} d="M6 2h4v2H8v4H6V2zm10 0h2v6h-2V4h-2V2h2zM4 10h2v2H4v-2zm14 0h2v2h-2v-2zM9 14l-2 6h2l1-3h4l1 3h2l-2-6H9z" />
    </svg>
  );
}

function IconFormula({ color }: { color: string }) {
  return (
    <span className="brain-deco-text" style={{ color }}>
      E=mc²
    </span>
  );
}

function IconPi({ color }: { color: string }) {
  return (
    <span className="brain-deco-text brain-deco-text--pi" style={{ color }}>
      3.1415926
    </span>
  );
}

function IconAtom({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke={color} strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke={color} strokeWidth="1.5" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke={color} strokeWidth="1.5" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="2" fill={color} />
    </svg>
  );
}

function IconGraph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path fill="none" stroke={color} strokeWidth="1.5" d="M3 20h18M3 20V4" />
      <path fill="none" stroke={color} strokeWidth="1.5" d="M5 16c3-8 5-4 7-10 2 4 4 2 7-6" />
    </svg>
  );
}

function IconFlask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path fill={color} d="M9 2v6l-4 10a2 2 0 001.7 3h10.6a2 2 0 001.7-3L15 8V2H9zm2 2h2v5.2l3.4 6.8H9.6L13 9.2V4z" />
    </svg>
  );
}

function IconPuzzle({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <path fill={color} d="M8 4a2 2 0 00-2 2v2H4v4h2v2a2 2 0 002 2h2v2h4v-2h2a2 2 0 002-2v-2h2v-4h-2V6a2 2 0 00-2-2h-2V2h-4v2H8z" />
    </svg>
  );
}

function IconBulb({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden>
      <path fill={color} d="M12 2a7 7 0 00-4 12.7V18h8v-3.3A7 7 0 0012 2zm-1 18h2v2h-2v-2z" />
    </svg>
  );
}

function IconHeart({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <path fill={color} d="M12 21s-8-5.5-8-11a4.5 4.5 0 018-2.2A4.5 4.5 0 0120 10c0 5.5-8 11-8 11z" />
    </svg>
  );
}

function IconAbc({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 40 28" width="36" height="26" aria-hidden>
      <ellipse cx="20" cy="22" rx="16" ry="6" fill={color} opacity="0.25" />
      <text x="20" y="18" textAnchor="middle" fill={color} fontSize="12" fontWeight="700" fontFamily="Georgia, serif">
        ABC
      </text>
    </svg>
  );
}

function IconGuitar({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path fill={color} d="M16.5 2l-1 2 2 1 1-2-2-1zM8 8c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 2c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3z" />
    </svg>
  );
}

function IconNote({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path fill={color} d="M14 3v10.1a4 4 0 10-2 3.7V7h6V3h-4z" />
    </svg>
  );
}

function IconGamepad({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path fill={color} d="M6 8a4 4 0 004 4h4a4 4 0 004-4V6H6v2zm2 10h2v2H8v-2zm6 0h2v2h-2v-2zM4 10h2v4H4v-4zm14 0h2v4h-2v-4z" />
    </svg>
  );
}

function IconCamera({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
      <path fill={color} d="M4 6h4l2-2h4l2 2h4v12H4V6zm8 3a5 5 0 100 10 5 5 0 000-10zm0 2a3 3 0 110 6 3 3 0 010-6z" />
    </svg>
  );
}

const LEFT_DECO = [
  { className: "brain-deco brain-deco--l1", node: <IconMicroscope color={TEAL} /> },
  { className: "brain-deco brain-deco--l2", node: <IconFormula color={TEAL} /> },
  { className: "brain-deco brain-deco--l3", node: <IconGraph color={TEAL} /> },
  { className: "brain-deco brain-deco--l4", node: <IconAtom color={TEAL} /> },
  { className: "brain-deco brain-deco--l5", node: <IconFlask color={TEAL} /> },
  { className: "brain-deco brain-deco--l6", node: <IconPuzzle color={TEAL} /> },
  { className: "brain-deco brain-deco--l7", node: <IconPi color={TEAL} /> },
];

const RIGHT_DECO = [
  { className: "brain-deco brain-deco--r1", node: <IconBulb color={RED} /> },
  { className: "brain-deco brain-deco--r2", node: <IconHeart color={RED} /> },
  { className: "brain-deco brain-deco--r3", node: <IconAbc color={RED} /> },
  { className: "brain-deco brain-deco--r4", node: <IconGuitar color={RED} /> },
  { className: "brain-deco brain-deco--r5", node: <IconNote color={RED} /> },
  { className: "brain-deco brain-deco--r6", node: <IconGamepad color={RED} /> },
  { className: "brain-deco brain-deco--r7", node: <IconCamera color={RED} /> },
];

export default function BrainHero() {
  return (
    <div className="brain-hero" aria-hidden>
      <div className="brain-hero-bg brain-hero-bg--left" />
      <div className="brain-hero-bg brain-hero-bg--right" />
      {LEFT_DECO.map((d, i) => (
        <div key={`l${i}`} className={d.className}>
          {d.node}
        </div>
      ))}
      {RIGHT_DECO.map((d, i) => (
        <div key={`r${i}`} className={d.className}>
          {d.node}
        </div>
      ))}
      <svg className="brain-hero-svg" viewBox="0 0 320 200" role="img" aria-label="">
        <defs>
          <clipPath id="brainLeftClip">
            <rect x="0" y="0" width="160" height="200" />
          </clipPath>
          <clipPath id="brainRightClip">
            <rect x="160" y="0" width="160" height="200" />
          </clipPath>
        </defs>
        <g clipPath="url(#brainLeftClip)">
          <path
            className="brain-hemi brain-hemi--left"
            fill={TEAL}
            d="M160 30 C120 20 70 35 55 70 C40 105 50 150 80 175 C100 190 130 195 160 195 L160 30 Z"
          />
          <path
            className="brain-fold"
            fill="none"
            stroke="#001820"
            strokeWidth="1.2"
            d="M95 55 Q110 70 100 90 M75 95 Q95 105 88 125 M105 140 Q125 150 115 170 M130 50 Q145 65 135 85"
          />
        </g>
        <g clipPath="url(#brainRightClip)">
          <path
            className="brain-hemi brain-hemi--right"
            fill={RED}
            d="M160 30 C200 20 250 35 265 70 C280 105 270 150 240 175 C220 190 190 195 160 195 L160 30 Z"
          />
          <path
            className="brain-fold"
            fill="none"
            stroke="#2a0000"
            strokeWidth="1.2"
            d="M225 55 Q210 70 220 90 M245 95 Q225 105 232 125 M215 140 Q195 150 205 170 M190 50 Q175 65 185 85"
          />
        </g>
        <line x1="160" y1="28" x2="160" y2="198" stroke="#1a1a1a" strokeWidth="2" />
      </svg>
    </div>
  );
}