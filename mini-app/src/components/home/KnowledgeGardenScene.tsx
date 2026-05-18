import type { KeyboardEvent } from "react";

export const SCENE_VIEWBOX = { width: 400, height: 720 } as const;

const BOKEH = [
  { left: "12%", top: "18%", w: 72, o: 0.35 },
  { left: "78%", top: "22%", w: 56, o: 0.28 },
  { left: "28%", top: "42%", w: 48, o: 0.22 },
  { left: "68%", top: "48%", w: 64, o: 0.3 },
  { left: "8%", top: "62%", w: 40, o: 0.2 },
  { left: "82%", top: "58%", w: 52, o: 0.25 },
  { left: "42%", top: "28%", w: 36, o: 0.18 },
  { left: "55%", top: "72%", w: 44, o: 0.24 },
  { left: "22%", top: "78%", w: 58, o: 0.26 },
  { left: "70%", top: "35%", w: 38, o: 0.2 },
] as const;

type Props = {
  onSurvey: () => void;
  onSettings: () => void;
  surveyAriaLabel: string;
  settingsAriaLabel: string;
};

function activateOnKey(e: KeyboardEvent, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

function BokehLayer() {
  return (
    <div className="home-bokeh" aria-hidden>
      {BOKEH.map((b, i) => (
        <span
          key={i}
          className="home-bokeh-orb"
          style={{
            left: b.left,
            top: b.top,
            width: b.w,
            height: b.w,
            opacity: b.o,
          }}
        />
      ))}
    </div>
  );
}

/** Pairs of leaves: [cx, cy, scale, flip] */
const LEAVES: ReadonlyArray<readonly [number, number, number, number]> = [
  [200, 500, 1, 1],
  [200, 500, 1, -1],
  [200, 455, 0.92, 1],
  [200, 455, 0.92, -1],
  [200, 410, 0.84, 1],
  [200, 410, 0.84, -1],
  [200, 365, 0.76, 1],
  [200, 365, 0.76, -1],
  [200, 320, 0.68, 1],
  [200, 320, 0.68, -1],
  [200, 278, 0.6, 1],
  [200, 278, 0.6, -1],
];

function Leaf({ cx, cy, scale, flip }: { cx: number; cy: number; scale: number; flip: number }) {
  const s = scale;
  const d = `M ${cx} ${cy} q ${12 * s * flip} ${-8 * s} ${38 * s * flip} ${-22 * s} q ${8 * s * flip} ${14 * s} ${-6 * s * flip} ${32 * s} q ${-14 * s * flip} ${-6 * s} ${-32 * s * flip} ${4 * s} z`;
  return <path d={d} className="home-leaf" fill="url(#leafGrad)" />;
}

export default function KnowledgeGardenScene({
  onSurvey,
  onSettings,
  surveyAriaLabel,
  settingsAriaLabel,
}: Props) {
  const { width, height } = SCENE_VIEWBOX;

  return (
    <div className="home-scene">
      <div className="home-scene-bg" aria-hidden />
      <BokehLayer />
      <svg
        className="home-scene-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label=""
      >
        <defs>
          <radialGradient id="bookGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#0088dd" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#001830" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="leafGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1a5c28" />
            <stop offset="55%" stopColor="#2d8a3a" />
            <stop offset="100%" stopColor="#e8c840" />
          </linearGradient>
          <linearGradient id="stemGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#1e6b2e" />
            <stop offset="100%" stopColor="#3a9e48" />
          </linearGradient>
          <radialGradient id="brainGlow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#00ffff" stopOpacity="0.55" />
            <stop offset="70%" stopColor="#00a8e8" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#004466" stopOpacity="0" />
          </radialGradient>
          <filter id="brainNeon" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        {/* Central vertical light beam */}
        <ellipse cx="200" cy="380" rx="55" ry="200" fill="url(#bookGlow)" opacity="0.35" filter="url(#softGlow)" />

        {/* Book */}
        <g className="home-book-art" pointerEvents="none">
          {/* Spine shadow */}
          <path
            d="M 200 545 L 200 665"
            stroke="#001020"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.5"
          />
          {/* Left cover */}
          <path
            d="M 200 548 L 72 575 L 68 658 L 200 662 Z"
            fill="#0a1830"
            stroke="#1a3050"
            strokeWidth="1.5"
          />
          {/* Right cover */}
          <path
            d="M 200 548 L 328 575 L 332 658 L 200 662 Z"
            fill="#0c1c38"
            stroke="#1a3050"
            strokeWidth="1.5"
          />
          {/* Left pages */}
          <path d="M 200 552 L 88 578 L 84 652 L 200 658 Z" fill="#e8eef5" />
          {/* Right pages */}
          <path d="M 200 552 L 312 578 L 316 652 L 200 658 Z" fill="#f0f4fa" />
          {/* Page lines left */}
          {Array.from({ length: 9 }, (_, i) => {
            const y = 572 + i * 9;
            return (
              <line
                key={`l${i}`}
                x1={108}
                y1={y}
                x2={188}
                y2={y + 2}
                stroke="#9aa8b8"
                strokeWidth="0.8"
                opacity="0.55"
              />
            );
          })}
          {/* Page lines right */}
          {Array.from({ length: 9 }, (_, i) => {
            const y = 572 + i * 9;
            return (
              <line
                key={`r${i}`}
                x1={212}
                y1={y + 2}
                x2={292}
                y2={y}
                stroke="#9aa8b8"
                strokeWidth="0.8"
                opacity="0.55"
              />
            );
          })}
          {/* Gutter glow */}
          <ellipse cx="200" cy="600" rx="28" ry="70" fill="url(#bookGlow)" className="home-glow-pulse" />
        </g>

        {/* Plant */}
        <g className="home-plant-art" pointerEvents="none">
          <path
            d="M 200 658 Q 198 580 200 500 Q 202 420 200 340 Q 199 290 200 250"
            fill="none"
            stroke="url(#stemGrad)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {/* Thorns */}
          {[520, 480, 440, 400, 360, 320].map((y) => (
            <g key={y}>
              <line x1="200" y1={y} x2="194" y2={y - 6} stroke="#2a6e38" strokeWidth="2" strokeLinecap="round" />
              <line x1="200" y1={y} x2="206" y2={y - 6} stroke="#2a6e38" strokeWidth="2" strokeLinecap="round" />
            </g>
          ))}
          {LEAVES.map(([cx, cy, scale, flip], i) => (
            <Leaf key={i} cx={cx} cy={cy} scale={scale} flip={flip} />
          ))}
        </g>

        {/* Brain flower */}
        <g className="home-brain-art" pointerEvents="none">
          <ellipse cx="200" cy="155" rx="75" ry="65" fill="url(#brainGlow)" className="home-glow-pulse" />
          <g filter="url(#brainNeon)">
            <path
              d="M 128 175
                 C 115 140, 140 95, 175 88
                 C 195 72, 210 72, 225 88
                 C 260 95, 285 140, 272 175
                 C 285 210, 265 245, 230 255
                 C 215 268, 200 272, 185 268
                 C 170 272, 155 268, 140 255
                 C 105 245, 85 210, 128 175 Z"
              fill="rgba(0, 220, 255, 0.22)"
              stroke="#00e8ff"
              strokeWidth="2"
            />
            {/* Gyri lines */}
            <path
              d="M 155 120 Q 175 105 200 108 Q 225 105 245 120"
              fill="none"
              stroke="#00f0ff"
              strokeWidth="1.5"
              opacity="0.85"
            />
            <path
              d="M 140 155 Q 165 140 200 142 Q 235 140 260 155"
              fill="none"
              stroke="#00e8ff"
              strokeWidth="1.3"
              opacity="0.8"
            />
            <path
              d="M 135 190 Q 168 175 200 178 Q 232 175 265 190"
              fill="none"
              stroke="#00d4ff"
              strokeWidth="1.2"
              opacity="0.75"
            />
            <path
              d="M 148 215 Q 175 228 200 230 Q 225 228 252 215"
              fill="none"
              stroke="#00c8f0"
              strokeWidth="1.2"
              opacity="0.7"
            />
            <path d="M 200 108 L 200 230" fill="none" stroke="#00e0ff" strokeWidth="1" opacity="0.5" />
            <path
              d="M 168 130 Q 185 150 175 175 Q 165 200 148 215"
              fill="none"
              stroke="#00d8ff"
              strokeWidth="1"
              opacity="0.65"
            />
            <path
              d="M 232 130 Q 215 150 225 175 Q 235 200 252 215"
              fill="none"
              stroke="#00d8ff"
              strokeWidth="1"
              opacity="0.65"
            />
          </g>
        </g>

        {/* Hit: brain (survey) */}
        <path
          className="home-hit home-hit--survey"
          d="M 115 95
             C 95 130, 100 200, 130 250
             C 150 280, 175 290, 200 292
             C 225 290, 250 280, 270 250
             C 300 200, 305 130, 285 95
             C 265 70, 235 58, 200 55
             C 165 58, 135 70, 115 95 Z"
          role="button"
          tabIndex={0}
          aria-label={surveyAriaLabel}
          onClick={onSurvey}
          onKeyDown={(e) => activateOnKey(e, onSurvey)}
        />

        {/* Hit: book (settings) */}
        <path
          className="home-hit home-hit--settings"
          d="M 55 565
             L 345 565
             L 350 685
             L 50 685 Z"
          role="button"
          tabIndex={0}
          aria-label={settingsAriaLabel}
          onClick={onSettings}
          onKeyDown={(e) => activateOnKey(e, onSettings)}
        />
      </svg>
    </div>
  );
}
