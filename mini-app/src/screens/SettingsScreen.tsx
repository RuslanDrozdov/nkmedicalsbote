import type { Lang } from "../copy";
import { t } from "../copy";
import ScreenShell from "../components/ScreenShell";

type Props = {
  lang: Lang;
  onReminders: () => void;
  onStats: () => void;
  onBackHome: () => void;
};

export default function SettingsScreen({ lang, onReminders, onStats, onBackHome }: Props) {
  return (
    <ScreenShell lang={lang} title={t(lang, "settingsHeader")} onBackHome={onBackHome}>
      <div className="row stack">
        <button type="button" className="accent-magenta" onClick={onReminders}>
          {t(lang, "remindersBtn")}
        </button>
        <button type="button" className="accent-magenta" onClick={onStats}>
          {t(lang, "statisticsBtn")}
        </button>
      </div>
    </ScreenShell>
  );
}
