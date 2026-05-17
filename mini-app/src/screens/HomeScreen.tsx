import brainBg from "../assets/brain-background.png";

type Props = {
  onSurvey: () => void;
  onSettings: () => void;
  surveyLabel: string;
  settingsLabel: string;
};

export default function HomeScreen({ onSurvey, onSettings, surveyLabel, settingsLabel }: Props) {
  return (
    <div className="home" style={{ backgroundImage: `url(${brainBg})` }}>
      <div className="home-zones">
        <button type="button" className="home-zone home-zone--left" onClick={onSurvey} aria-label={surveyLabel} />
        <button type="button" className="home-zone home-zone--right" onClick={onSettings} aria-label={settingsLabel} />
      </div>
    </div>
  );
}
