import type { KeyboardEvent } from "react";
import brainBg from "../assets/brain-background.png";
import {
  BRAIN_VIEWBOX,
  settingsPath,
  settingsLabelAnchor,
  surveyPath,
  surveyLabelAnchor,
} from "../assets/brainZones.generated";

type Props = {
  title: string;
  onSurvey: () => void;
  onSettings: () => void;
  surveyLabel: string;
  settingsLine1: string;
  settingsLine2: string;
  settingsAriaLabel: string;
};

function activateOnKey(e: KeyboardEvent, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

export default function HomeScreen({
  title,
  onSurvey,
  onSettings,
  surveyLabel,
  settingsLine1,
  settingsLine2,
  settingsAriaLabel,
}: Props) {
  return (
    <div className="home" style={{ backgroundImage: `url(${brainBg})` }}>
      <header className="home-header">{title}</header>
      <svg
        className="home-map"
        viewBox={`0 0 ${BRAIN_VIEWBOX.width} ${BRAIN_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          className="home-lobe home-lobe--survey"
          d={surveyPath}
          role="button"
          tabIndex={0}
          aria-label={surveyLabel}
          onClick={onSurvey}
          onKeyDown={(e) => activateOnKey(e, onSurvey)}
        />
        <path
          className="home-lobe home-lobe--settings"
          d={settingsPath}
          role="button"
          tabIndex={0}
          aria-label={settingsAriaLabel}
          onClick={onSettings}
          onKeyDown={(e) => activateOnKey(e, onSettings)}
        />
      </svg>
      <div className="home-labels">
        <span
          className="home-label home-label--survey"
          style={{
            left: `${surveyLabelAnchor.x * 100}%`,
            top: `${surveyLabelAnchor.y * 100}%`,
          }}
        >
          {surveyLabel}
        </span>
        <span
          className="home-label home-label--settings"
          style={{
            left: `${settingsLabelAnchor.x * 100}%`,
            top: `${settingsLabelAnchor.y * 100}%`,
          }}
        >
          <span>{settingsLine1}</span>
          <span>{settingsLine2}</span>
        </span>
      </div>
    </div>
  );
}
