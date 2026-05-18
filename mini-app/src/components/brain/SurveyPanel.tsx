import { FOLLOW_UP_QUESTIONS } from "@constants";
import type { Lang } from "../../copy";
import { t } from "../../copy";

export type SurveyPhase = "home" | "onb" | "survey" | "done" | "blocked";

type Props = {
  lang: Lang;
  phase: SurveyPhase;
  qIndex: number;
  answerDraft: string;
  gender: "m" | "f" | null;
  birthYear: string;
  err: string | null;
  onStartSurvey: () => void;
  onLang: (l: Lang) => void;
  onGender: (g: "m" | "f") => void;
  onBirthYear: (y: string) => void;
  onDraft: (v: string) => void;
  onSubmitOnboarding: () => void;
  onSubmitAnswer: () => void;
  onResetHome: () => void;
};

export default function SurveyPanel({
  lang,
  phase,
  qIndex,
  answerDraft,
  gender,
  birthYear,
  err,
  onStartSurvey,
  onLang,
  onGender,
  onBirthYear,
  onDraft,
  onSubmitOnboarding,
  onSubmitAnswer,
  onResetHome,
}: Props) {
  if (phase === "home") {
    return (
      <section className="brain-panel brain-panel--left brain-panel--survey-home">
        <h2 className="brain-panel-title">{t(lang, "homeSurveyZone")}</h2>
        <button type="button" className="brain-btn brain-btn--teal brain-btn--block" onClick={onStartSurvey}>
          {t(lang, "homeStartSurvey")}
        </button>
      </section>
    );
  }

  if (phase === "blocked") {
    return (
      <section className="brain-panel brain-panel--left">
        <h2 className="brain-panel-title">{t(lang, "alreadyTitle")}</h2>
        <p>{t(lang, "alreadyBody")}</p>
        <button type="button" className="brain-btn brain-btn--teal secondary" onClick={onResetHome}>
          {t(lang, "backHome")}
        </button>
      </section>
    );
  }

  if (phase === "done") {
    return (
      <section className="brain-panel brain-panel--left">
        <h2 className="brain-panel-title">{t(lang, "doneTitle")}</h2>
        <p>{t(lang, "doneBody")}</p>
        <button type="button" className="brain-btn brain-btn--teal secondary" onClick={onResetHome}>
          {t(lang, "backHome")}
        </button>
      </section>
    );
  }

  if (phase === "onb") {
    return (
      <section className="brain-panel brain-panel--left">
        <h2 className="brain-panel-title">{t(lang, "langTitle")}</h2>
        <div className="row">
          <button type="button" className={lang === "ru" ? "brain-btn brain-btn--teal" : "brain-btn secondary"} onClick={() => onLang("ru")}>
            Русский
          </button>
          <button type="button" className={lang === "en" ? "brain-btn brain-btn--teal" : "brain-btn secondary"} onClick={() => onLang("en")}>
            English
          </button>
        </div>
        <h2 className="brain-panel-title">{t(lang, "genderTitle")}</h2>
        <div className="row">
          <button type="button" className={gender === "m" ? "brain-btn brain-btn--teal" : "brain-btn secondary"} onClick={() => onGender("m")}>
            {t(lang, "male")}
          </button>
          <button type="button" className={gender === "f" ? "brain-btn brain-btn--teal" : "brain-btn secondary"} onClick={() => onGender("f")}>
            {t(lang, "female")}
          </button>
        </div>
        <h2 className="brain-panel-title">{t(lang, "yearTitle")}</h2>
        <input
          type="text"
          className="brain-input"
          value={birthYear}
          onChange={(e) => onBirthYear(e.target.value)}
          placeholder={t(lang, "yearPlaceholder")}
          inputMode="numeric"
        />
        {err ? <p className="error">{err}</p> : null}
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="brain-btn brain-btn--teal" disabled={!gender} onClick={onSubmitOnboarding}>
            {t(lang, "next")}
          </button>
        </div>
      </section>
    );
  }

  const q = FOLLOW_UP_QUESTIONS[qIndex];
  return (
    <section className="brain-panel brain-panel--left">
      <h2 className="brain-panel-title">
        {t(lang, "surveyTitle")} {qIndex + 1}/{FOLLOW_UP_QUESTIONS.length}
      </h2>
      <p className="brain-question">{q}</p>
      <input type="text" className="brain-input" value={answerDraft} onChange={(e) => onDraft(e.target.value)} />
      {err ? <p className="error">{err}</p> : null}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="brain-btn brain-btn--teal" onClick={onSubmitAnswer}>
          {qIndex + 1 >= FOLLOW_UP_QUESTIONS.length ? t(lang, "submit") : t(lang, "next")}
        </button>
        <button type="button" className="brain-btn secondary" onClick={onResetHome}>
          {t(lang, "backHome")}
        </button>
      </div>
    </section>
  );
}
