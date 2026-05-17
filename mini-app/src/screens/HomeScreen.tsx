import brainBg from "../assets/brain-background.png";

type Props = {
  title: string;
  onSurvey: () => void;
  onSettings: () => void;
  surveyLabel: string;
  settingsLine1: string;
  settingsLine2: string;
  settingsAriaLabel: string;
};

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
      <div className="home-zones">
        <button type="button" className="home-zone home-zone--left" onClick={onSurvey} aria-label={surveyLabel}>
          <span className="home-zone-label home-zone-label--survey">{surveyLabel}</span>
        </button>
        <button
          type="button"
          className="home-zone home-zone--right"
          onClick={onSettings}
          aria-label={settingsAriaLabel}
        >
          <span className="home-zone-label home-zone-label--settings">
            <span>{settingsLine1}</span>
            <span>{settingsLine2}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
