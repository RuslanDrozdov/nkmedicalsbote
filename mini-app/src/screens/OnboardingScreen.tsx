import type { Lang } from "../copy";
import { t } from "../copy";
import ScreenShell from "../components/ScreenShell";

type Props = {
  lang: Lang;
  gender: "m" | "f" | null;
  birthYear: string;
  err: string | null;
  onLang: (l: Lang) => void;
  onGender: (g: "m" | "f") => void;
  onBirthYear: (y: string) => void;
  onSubmit: () => void;
  onBackHome: () => void;
};

export default function OnboardingScreen({
  lang,
  gender,
  birthYear,
  err,
  onLang,
  onGender,
  onBirthYear,
  onSubmit,
  onBackHome,
}: Props) {
  return (
    <ScreenShell lang={lang} onBackHome={onBackHome}>
      <h1>{t(lang, "langTitle")}</h1>
      <div className="row">
        <button type="button" className={lang === "ru" ? "accent-cyan" : "secondary"} onClick={() => onLang("ru")}>
          Русский
        </button>
        <button type="button" className={lang === "en" ? "accent-cyan" : "secondary"} onClick={() => onLang("en")}>
          English
        </button>
      </div>
      <h1>{t(lang, "genderTitle")}</h1>
      <div className="row">
        <button type="button" className={gender === "m" ? "accent-cyan" : "secondary"} onClick={() => onGender("m")}>
          {t(lang, "male")}
        </button>
        <button type="button" className={gender === "f" ? "accent-cyan" : "secondary"} onClick={() => onGender("f")}>
          {t(lang, "female")}
        </button>
      </div>
      <h1>{t(lang, "yearTitle")}</h1>
      <input
        type="text"
        value={birthYear}
        onChange={(e) => onBirthYear(e.target.value)}
        placeholder={t(lang, "yearPlaceholder")}
        inputMode="numeric"
      />
      {err ? <p className="error">{err}</p> : null}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="accent-cyan" disabled={!gender} onClick={onSubmit}>
          {t(lang, "next")}
        </button>
      </div>
    </ScreenShell>
  );
}
