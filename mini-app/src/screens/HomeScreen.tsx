import KnowledgeGardenScene from "../components/home/KnowledgeGardenScene";

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
    <div className="home">
      <header className="home-header">{title}</header>
      <KnowledgeGardenScene
        onSurvey={onSurvey}
        onSettings={onSettings}
        surveyAriaLabel={surveyLabel}
        settingsAriaLabel={settingsAriaLabel}
      />
      <div className="home-labels">
        <span className="home-label home-label--survey">{surveyLabel}</span>
        <span className="home-label home-label--settings">
          <span>{settingsLine1}</span>
          <span>{settingsLine2}</span>
        </span>
      </div>
    </div>
  );
}
