import KnowledgeGardenScene from "../components/home/KnowledgeGardenScene";

type Props = {
  title: string;
  onSurvey: () => void;
  onSettings: () => void;
  onStats: () => void;
  surveyLabel: string;
  settingsLabel: string;
  statsLabel: string;
  settingsAriaLabel: string;
  statsAriaLabel: string;
};

export default function HomeScreen({
  title,
  onSurvey,
  onSettings,
  onStats,
  surveyLabel,
  settingsLabel,
  statsLabel,
  settingsAriaLabel,
  statsAriaLabel,
}: Props) {
  return (
    <div className="home">
      <header className="home-header">{title}</header>
      <KnowledgeGardenScene
        onSurvey={onSurvey}
        onSettings={onSettings}
        onStats={onStats}
        surveyAriaLabel={surveyLabel}
        settingsAriaLabel={settingsAriaLabel}
        statsAriaLabel={statsAriaLabel}
        settingsLabel={settingsLabel}
        statsLabel={statsLabel}
      />
      <div className="home-labels">
        <span className="home-label home-label--survey">{surveyLabel}</span>
      </div>
    </div>
  );
}
