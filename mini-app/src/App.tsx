import { useEffect, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { FOLLOW_UP_QUESTIONS } from "@constants";
import { apiGet, apiPost } from "./api";

type Lang = "ru" | "en";

type MeResponse = {
  ok: boolean;
  profile: {
    language: string;
    gender: string;
    birth_year: string;
  } | null;
  alreadyToday: boolean;
};

const copy: Record<
  Lang,
  Record<
    | "needTelegram"
    | "loadError"
    | "langTitle"
    | "genderTitle"
    | "yearTitle"
    | "yearPlaceholder"
    | "next"
    | "submit"
    | "male"
    | "female"
    | "doneTitle"
    | "doneBody"
    | "alreadyTitle"
    | "alreadyBody"
    | "empty"
    | "surveyTitle"
    | "loading",
    string
  >
> = {
  ru: {
    needTelegram: "Откройте это приложение из Telegram.",
    loading: "Загрузка…",
    loadError: "Не удалось загрузить данные.",
    langTitle: "Выберите язык",
    genderTitle: "Выберите пол",
    yearTitle: "Год рождения",
    yearPlaceholder: "Например, 1990",
    next: "Далее",
    submit: "Отправить",
    male: "Мужской",
    female: "Женский",
    doneTitle: "Готово",
    doneBody: "Спасибо! Вы ответили на все вопросы.",
    alreadyTitle: "Уже сегодня",
    alreadyBody: "Сегодня вы уже проходили опрос. Приходите завтра.",
    empty: "Введите непустой ответ.",
    surveyTitle: "Вопрос",
  },
  en: {
    needTelegram: "Open this app from Telegram.",
    loading: "Loading…",
    loadError: "Failed to load data.",
    langTitle: "Choose language",
    genderTitle: "Select gender",
    yearTitle: "Birth year",
    yearPlaceholder: "e.g. 1990",
    next: "Next",
    submit: "Submit",
    male: "Male",
    female: "Female",
    doneTitle: "Done",
    doneBody: "Thanks! You answered all questions.",
    alreadyTitle: "Already today",
    alreadyBody: "You have already completed the survey today. Please come back tomorrow.",
    empty: "Please enter a non-empty answer.",
    surveyTitle: "Question",
  },
};

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
  const [phase, setPhase] = useState<"onb" | "survey" | "done" | "blocked">("onb");

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
    // initData приходит из hash страницы; после ready() иногда стабильнее на следующем тике
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
        if (m.alreadyToday) {
          setPhase("blocked");
          return;
        }
        if (m.profile) {
          setPhase("survey");
        } else {
          setPhase("onb");
        }
      })
      .catch((e: Error) => setErr(e.message ?? copy.ru.loadError));
  }, []);

  const t = (key: keyof (typeof copy)["ru"]) => copy[lang][key];

  async function saveProfileAndStartSurvey() {
    if (!gender) return;
    const y = birthYear.trim();
    if (!y) {
      setErr(t("empty"));
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
      setErr(t("empty"));
      return;
    }
    setErr(null);
    const next = [...answers, trimmed];
    if (next.length >= FOLLOW_UP_QUESTIONS.length) {
      await apiPost("/api/survey/complete", { answers: next });
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
        <p className="error">{t("needTelegram")}</p>
      </div>
    );
  }

  if (initOk === null || (initOk && !me && !err)) {
    return (
      <div className="layout">
        <p className="loading" aria-busy="true">
          {t("loading")}
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

  if (phase === "blocked" && me) {
    return (
      <div className="layout">
        <h1>{t("alreadyTitle")}</h1>
        <p>{t("alreadyBody")}</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="layout">
        <h1>{t("doneTitle")}</h1>
        <p>{t("doneBody")}</p>
      </div>
    );
  }

  if (phase === "onb" && !me?.profile) {
    return (
      <div className="layout">
        <h1>{t("langTitle")}</h1>
        <div className="row">
          <button type="button" className={lang === "ru" ? "" : "secondary"} onClick={() => setLang("ru")}>
            Русский
          </button>
          <button type="button" className={lang === "en" ? "" : "secondary"} onClick={() => setLang("en")}>
            English
          </button>
        </div>
        <h1>{t("genderTitle")}</h1>
        <div className="row">
          <button type="button" className={gender === "m" ? "" : "secondary"} onClick={() => setGender("m")}>
            {t("male")}
          </button>
          <button type="button" className={gender === "f" ? "" : "secondary"} onClick={() => setGender("f")}>
            {t("female")}
          </button>
        </div>
        <h1>{t("yearTitle")}</h1>
        <input
          type="text"
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value)}
          placeholder={t("yearPlaceholder")}
          inputMode="numeric"
        />
        {err ? <p className="error">{err}</p> : null}
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" disabled={!gender} onClick={() => void saveProfileAndStartSurvey()}>
            {t("next")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "survey") {
    const q = FOLLOW_UP_QUESTIONS[qIndex];
    return (
      <div className="layout">
        <h1>
          {t("surveyTitle")} {qIndex + 1}/{FOLLOW_UP_QUESTIONS.length}
        </h1>
        <p>{q}</p>
        <input type="text" value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} />
        {err ? <p className="error">{err}</p> : null}
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" onClick={() => void submitAnswer()}>
            {qIndex + 1 >= FOLLOW_UP_QUESTIONS.length ? t("submit") : t("next")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <p className="error">{err ?? t("loadError")}</p>
    </div>
  );
}
