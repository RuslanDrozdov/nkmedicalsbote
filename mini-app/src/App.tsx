import { useEffect, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { FOLLOW_UP_QUESTIONS } from "@constants";
import { apiGet, apiPost } from "./api";
import type { Lang } from "./copy";
import { t } from "./copy";
import type { SurveyPhase } from "./components/brain/SurveyPanel";
import BrainSplitScreen from "./screens/BrainSplitScreen";

type MeResponse = {
  ok: boolean;
  profile: {
    language: string;
    gender: string;
    birth_year: string;
  } | null;
  alreadyToday: boolean;
};

type Phase = "home" | "onb" | "survey" | "done" | "blocked" | "reminders";

function toSurveyPhase(phase: Phase): SurveyPhase {
  if (phase === "onb") return "onb";
  if (phase === "survey") return "survey";
  if (phase === "done") return "done";
  if (phase === "blocked") return "blocked";
  return "home";
}

export default function App() {
  const [initOk, setInitOk] = useState<boolean | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("ru");
  const [gender, setGender] = useState<"m" | "f" | null>(null);
  const [birthYear, setBirthYear] = useState("");
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [answerDraft, setAnswerDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("home");

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    const raw =
      typeof WebApp.initData === "string" && WebApp.initData.length > 0
        ? WebApp.initData
        : typeof window.Telegram?.WebApp?.initData === "string"
          ? window.Telegram.WebApp.initData
          : "";
    const hasInit = raw.length > 0;
    setInitOk(hasInit);
    if (!hasInit) return;

    apiGet<MeResponse>("/api/me")
      .then((m) => {
        setMe(m);
        if (m.profile?.language === "en") setLang("en");
        if (m.profile) {
          setGender((m.profile.gender === "f" ? "f" : "m") as "m" | "f");
          setBirthYear(m.profile.birth_year ?? "");
        }
        setPhase("home");
      })
      .catch((e: Error) => setErr(e.message ?? t("ru", "loadError")));
  }, []);

  function goHome() {
    setErr(null);
    setPhase("home");
  }

  function startSurveyPath() {
    if (!me) return;
    if (me.alreadyToday) {
      setPhase("blocked");
      return;
    }
    if (!me.profile) {
      setPhase("onb");
      return;
    }
    setQIndex(0);
    setAnswers([]);
    setAnswerDraft("");
    setPhase("survey");
  }

  async function saveProfileAndStartSurvey() {
    if (!gender) return;
    const y = birthYear.trim();
    if (!y) {
      setErr(t(lang, "empty"));
      return;
    }
    setErr(null);
    await apiPost("/api/profile", {
      language: lang,
      gender,
      birth_year: y,
    });
    const m = await apiGet<MeResponse>("/api/me");
    setMe(m);
    if (m.alreadyToday) {
      setPhase("blocked");
      return;
    }
    setPhase("survey");
    setQIndex(0);
    setAnswers([]);
    setAnswerDraft("");
  }

  async function submitAnswer() {
    const trimmed = answerDraft.trim();
    if (!trimmed) {
      setErr(t(lang, "empty"));
      return;
    }
    setErr(null);
    const next = [...answers, trimmed];
    if (next.length >= FOLLOW_UP_QUESTIONS.length) {
      await apiPost("/api/survey/complete", { answers: next });
      const m = await apiGet<MeResponse>("/api/me");
      setMe(m);
      setPhase("done");
      return;
    }
    setAnswers(next);
    setQIndex(next.length);
    setAnswerDraft("");
  }

  if (initOk === false) {
    return (
      <div className="layout">
        <p className="error">{t(lang, "needTelegram")}</p>
      </div>
    );
  }

  if (initOk === null || (initOk && !me && !err)) {
    return (
      <div className="layout">
        <p className="loading" aria-busy="true">
          {t(lang, "loading")}
        </p>
      </div>
    );
  }

  if (err && !me) {
    return (
      <div className="layout">
        <p className="error">{err}</p>
      </div>
    );
  }

  if (me) {
    return (
      <BrainSplitScreen
        title={t(lang, "homeTitle")}
        lang={lang}
        surveyPhase={toSurveyPhase(phase)}
        qIndex={qIndex}
        answerDraft={answerDraft}
        gender={gender}
        birthYear={birthYear}
        err={err}
        showReminders={phase === "reminders"}
        onStartSurvey={startSurveyPath}
        onLang={setLang}
        onGender={setGender}
        onBirthYear={setBirthYear}
        onDraft={setAnswerDraft}
        onSubmitOnboarding={() => void saveProfileAndStartSurvey()}
        onSubmitAnswer={() => void submitAnswer()}
        onResetHome={goHome}
        onOpenReminders={() => setPhase("reminders")}
        onBackFromReminders={() => setPhase("home")}
      />
    );
  }

  return (
    <div className="layout">
      <p className="error">{err ?? t(lang, "loadError")}</p>
    </div>
  );
}
