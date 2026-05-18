import type { Lang } from "../../copy";
import { t } from "../../copy";
import RemindersPanel from "./RemindersPanel";
import StatsPanel from "./StatsPanel";

type Props = {
  lang: Lang;
  showReminders: boolean;
  onOpenReminders: () => void;
  onBackFromReminders: () => void;
};

export default function RightPanel({ lang, showReminders, onOpenReminders, onBackFromReminders }: Props) {
  if (showReminders) {
    return (
      <section className="brain-panel brain-panel--right brain-panel-scroll">
        <RemindersPanel lang={lang} onBack={onBackFromReminders} />
      </section>
    );
  }

  return (
    <section className="brain-panel brain-panel--right brain-panel-scroll">
      <h2 className="brain-panel-title">{t(lang, "homeSettingsZoneLine1")}</h2>
      <div className="row stack">
        <button type="button" className="brain-btn brain-btn--red" onClick={onOpenReminders}>
          {t(lang, "remindersBtn")}
        </button>
      </div>
      <hr className="brain-divider" />
      <h2 className="brain-panel-title">{t(lang, "homeSettingsZoneLine2")}</h2>
      <StatsPanel lang={lang} />
    </section>
  );
}
