import { FOLLOW_UP_QUESTIONS } from "@constants";
import type { Lang } from "../copy";
import { t } from "../copy";
import ScreenShell from "../components/ScreenShell";

type Props = {
  lang: Lang;
  qIndex: number;
  answerDraft: string;
  err: string | null;
  onDraft: (v: string) => void;
  onSubmit: () => void;
  onBackHome: () => void;
};

export default function SurveyScreen({ lang, qIndex, answerDraft, err, onDraft, onSubmit, onBackHome }: Props) {
  const q = FOLLOW_UP_QUESTIONS[qIndex];
  return (
    <ScreenShell lang={lang} onBackHome={onBackHome}>
      <h1>
        {t(lang, "surveyTitle")} {qIndex + 1}/{FOLLOW_UP_QUESTIONS.length}
      </h1>
      <p>{q}</p>
      <input type="text" value={answerDraft} onChange={(e) => onDraft(e.target.value)} />
      {err ? <p className="error">{err}</p> : null}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="accent-cyan" onClick={onSubmit}>
          {qIndex + 1 >= FOLLOW_UP_QUESTIONS.length ? t(lang, "submit") : t(lang, "next")}
        </button>
      </div>
    </ScreenShell>
  );
}
