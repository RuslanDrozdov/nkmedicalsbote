import { useEffect, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { FOLLOW_UP_QUESTIONS } from "@constants";
import { apiGet, apiPost } from "./api";
import type { Lang } from "./copy";
import { t } from "./copy";
import HomeScreen from "./screens/HomeScreen";
import OnboardingScreen from "./screens/OnboardingScreen";
import RemindersScreen from "./screens/RemindersScreen";
import SettingsScreen from "./screens/SettingsScreen";
import StatsScreen from "./screens/StatsScreen";
import SurveyScreen from "./screens/SurveyScreen";
import ScreenShell from "./components/ScreenShell";

type MeResponse = {
  ok: boolean;
  profile: {
    language: string;
    gender: string;
    birth_year: string;
  } | null;
  alreadyToday: boolean;
};

type Phase =
  | "home"
  | "onb"
  | "survey"
  | "done"
  | "blocked"
  | "settings"
  | "reminders"
  | "stats";

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

  if (phase === "home" && me) {
    return (
      <HomeScreen
        title={t(lang, "homeTitle")}
        onSurvey={startSurveyPath}
        onSettings={() => setPhase("settings")}
        surveyLabel={t(lang, "homeSurveyZone")}
        settingsLine1={t(lang, "homeSettingsZoneLine1")}
        settingsLine2={t(lang, "homeSettingsZoneLine2")}
        settingsAriaLabel={`${t(lang, "homeSettingsZoneLine1")}, ${t(lang, "homeSettingsZoneLine2")}`}
      />
    );
  }

  if (phase === "blocked" && me) {
    return (
      <ScreenShell lang={lang} onBackHome={goHome}>
        <h1>{t(lang, "alreadyTitle")}</h1>
        <p>{t(lang, "alreadyBody")}</p>
      </ScreenShell>
    );
  }

  if (phase === "done") {
    return (
      <ScreenShell lang={lang} onBackHome={goHome}>
        <h1>{t(lang, "doneTitle")}</h1>
        <p>{t(lang, "doneBody")}</p>
      </ScreenShell>
    );
  }

  if (phase === "onb" && !me?.profile) {
    return (
      <OnboardingScreen
        lang={lang}
        gender={gender}
        birthYear={birthYear}
        err={err}
        onLang={setLang}
        onGender={setGender}
        onBirthYear={setBirthYear}
        onSubmit={() => void saveProfileAndStartSurvey()}
        onBackHome={goHome}
      />
    );
  }

  if (phase === "survey") {
    return (
      <SurveyScreen
        lang={lang}
        qIndex={qIndex}
        answerDraft={answerDraft}
        err={err}
        onDraft={setAnswerDraft}
        onSubmit={() => void submitAnswer()}
        onBackHome={goHome}
      />
    );
  }

  if (phase === "settings") {
    return (
      <SettingsScreen
        lang={lang}
        onReminders={() => setPhase("reminders")}
        onStats={() => setPhase("stats")}
        onBackHome={goHome}
      />
    );
  }

  if (phase === "reminders") {
    return <RemindersScreen lang={lang} onBack={() => setPhase("settings")} />;
  }

  if (phase === "stats") {
    return <StatsScreen lang={lang} onBackSettings={() => setPhase("settings")} />;
  }

  return (
    <div className="layout">
      <p className="error">{err ?? t(lang, "loadError")}</p>
    </div>
  );
}
