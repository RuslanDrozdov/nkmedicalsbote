import BrainHero from "../components/brain/BrainHero";
import RightPanel from "../components/brain/RightPanel";
import SurveyPanel, { type SurveyPhase } from "../components/brain/SurveyPanel";
import type { Lang } from "../copy";

type Props = {
  title: string;
  lang: Lang;
  surveyPhase: SurveyPhase;
  qIndex: number;
  answerDraft: string;
  gender: "m" | "f" | null;
  birthYear: string;
  err: string | null;
  showReminders: boolean;
  onStartSurvey: () => void;
  onLang: (l: Lang) => void;
  onGender: (g: "m" | "f") => void;
  onBirthYear: (y: string) => void;
  onDraft: (v: string) => void;
  onSubmitOnboarding: () => void;
  onSubmitAnswer: () => void;
  onResetHome: () => void;
  onOpenReminders: () => void;
  onBackFromReminders: () => void;
};

export default function BrainSplitScreen({
  title,
  lang,
  surveyPhase,
  qIndex,
  answerDraft,
  gender,
  birthYear,
  err,
  showReminders,
  onStartSurvey,
  onLang,
  onGender,
  onBirthYear,
  onDraft,
  onSubmitOnboarding,
  onSubmitAnswer,
  onResetHome,
  onOpenReminders,
  onBackFromReminders,
}: Props) {
  return (
    <div className="brain-split">
      <header className="brain-split-header">
        <h1>{title}</h1>
      </header>
      <BrainHero />
      <div className="brain-split-panels">
        <SurveyPanel
          lang={lang}
          phase={surveyPhase}
          qIndex={qIndex}
          answerDraft={answerDraft}
          gender={gender}
          birthYear={birthYear}
          err={err}
          onStartSurvey={onStartSurvey}
          onLang={onLang}
          onGender={onGender}
          onBirthYear={onBirthYear}
          onDraft={onDraft}
          onSubmitOnboarding={onSubmitOnboarding}
          onSubmitAnswer={onSubmitAnswer}
          onResetHome={onResetHome}
        />
        <RightPanel
          lang={lang}
          showReminders={showReminders}
          onOpenReminders={onOpenReminders}
          onBackFromReminders={onBackFromReminders}
        />
      </div>
    </div>
  );
}
