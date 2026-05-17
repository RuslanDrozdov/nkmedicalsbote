import { useEffect, useState } from "react";
import { apiGet, downloadStatsExport } from "../api";
import ScreenShell from "../components/ScreenShell";
import type { Lang } from "../copy";
import { t } from "../copy";
import {
  WEEKDAY_LABELS,
  addLocalDays,
  daysInGregorianMonth,
  instantForLocalDate,
  localWeekdayMon0FromUtcMs,
  mondayYmdOfWeekContaining,
  monthTitle,
  safeLocalParts,
  shiftMonthYmm,
  todayYmd,
  ymdToYmm,
} from "../lib/statsDates";

export type DayEntry = { completedAtSec: number; answers: string[] };
export type ByYmd = Record<string, DayEntry[]>;

type StatsData = {
  ok: boolean;
  timezone: string;
  language: Lang;
  byYmd: ByYmd;
  totalCount: number;
};

type View = "modes" | "calendar" | "week" | "day";

type Props = {
  lang: Lang;
  onBackSettings: () => void;
};

export default function StatsScreen({ lang, onBackSettings }: Props) {
  const [data, setData] = useState<StatsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("modes");
  const [monthYmm, setMonthYmm] = useState(() => ymdToYmm(todayYmd("UTC")));
  const [weekMonday, setWeekMonday] = useState(() => todayYmd("UTC"));
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [fromWeek, setFromWeek] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    apiGet<StatsData>("/api/stats")
      .then((r) => {
        setData(r);
        const tz = r.timezone;
        const today = todayYmd(tz);
        setMonthYmm(ymdToYmm(today));
        setWeekMonday(mondayYmdOfWeekContaining(today, tz));
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const uiLang = data?.language ?? lang;
  const tz = data?.timezone ?? "UTC";
  const byYmd = data?.byYmd ?? {};

  function openDay(ymd: string, week: boolean) {
    setSelectedYmd(ymd);
    setFromWeek(week);
    setView("day");
  }

  async function exportCsv() {
    setExportBusy(true);
    setErr(null);
    try {
      await downloadStatsExport();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  }

  if (!data && !err) {
    return (
      <ScreenShell lang={uiLang} title={t(uiLang, "statsTitle")} onBack={onBackSettings} backLabel="statsBackSettings">
        <p className="loading">{t(uiLang, "loading")}</p>
      </ScreenShell>
    );
  }

  if (data && data.totalCount === 0) {
    return (
      <ScreenShell lang={uiLang} title={t(uiLang, "statsTitle")} onBack={onBackSettings} backLabel="statsBackSettings">
        <p>{t(uiLang, "statsEmpty")}</p>
      </ScreenShell>
    );
  }

  if (view === "modes") {
    return (
      <ScreenShell lang={uiLang} title={t(uiLang, "statsTitle")} onBack={onBackSettings} backLabel="statsBackSettings">
        <p>{t(uiLang, "statsModeHint")}</p>
        <div className="row stack">
          <button type="button" className="accent-magenta" onClick={() => setView("calendar")}>
            {t(uiLang, "statsByDays")}
          </button>
          <button type="button" className="accent-magenta" onClick={() => setView("week")}>
            {t(uiLang, "statsByWeeks")}
          </button>
          <button type="button" className="secondary" disabled={exportBusy} onClick={() => void exportCsv()}>
            {t(uiLang, "statsExportBtn")}
          </button>
        </div>
        {err ? <p className="error">{err}</p> : null}
      </ScreenShell>
    );
  }

  if (view === "calendar") {
    const y = Math.floor(monthYmm / 100);
    const mo = monthYmm % 100;
    const dim = daysInGregorianMonth(y, mo);
    const firstDow = localWeekdayMon0FromUtcMs(instantForLocalDate(y, mo, 1, tz), tz);
    const cells: { label: string; ymd: string | null }[] = [];
    for (let i = 0; i < firstDow; i++) cells.push({ label: "·", ymd: null });
    for (let day = 1; day <= dim; day++) {
      const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const n = (byYmd[ymd] ?? []).length;
      cells.push({ label: n > 0 ? `${day}·` : String(day), ymd });
    }

    return (
      <ScreenShell
        lang={uiLang}
        title={monthTitle(uiLang, monthYmm)}
        onBack={() => setView("modes")}
        backLabel="statsBackModes"
      >
        <p className="hint">{t(uiLang, "statsCalendarHint")}</p>
        <div className="cal-nav row">
          <button type="button" className="secondary" onClick={() => setMonthYmm((m) => shiftMonthYmm(m, -1))}>
            ‹
          </button>
          <button type="button" className="secondary" onClick={() => setMonthYmm((m) => shiftMonthYmm(m, 1))}>
            ›
          </button>
        </div>
        <div className="cal-weekdays">
          {WEEKDAY_LABELS[uiLang].map((w) => (
            <span key={w} className="cal-wd">
              {w}
            </span>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((c, i) =>
            c.ymd ? (
              <button
                key={`${c.ymd}-${i}`}
                type="button"
                className={(byYmd[c.ymd] ?? []).length ? "cal-day has-data" : "cal-day"}
                onClick={() => openDay(c.ymd!, false)}
              >
                {c.label}
              </button>
            ) : (
              <span key={`e-${i}`} className="cal-day empty">
                {c.label}
              </span>
            ),
          )}
        </div>
      </ScreenShell>
    );
  }

  if (view === "week") {
    const sun = addLocalDays(weekMonday, 6, tz);
    let total = 0;
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const ymd = addLocalDays(weekMonday, i, tz);
      days.push(ymd);
      total += (byYmd[ymd] ?? []).length;
    }
    return (
      <ScreenShell
        lang={uiLang}
        title={t(uiLang, "statsWeekHeader")}
        onBack={() => setView("modes")}
        backLabel="statsBackModes"
      >
        <p>
          {weekMonday} — {sun}
        </p>
        <p>
          {t(uiLang, "statsWeekCount")} {total}
        </p>
        <p className="hint">{t(uiLang, "statsWeekPickDay")}</p>
        <div className="cal-nav row">
          <button
            type="button"
            className="secondary"
            onClick={() => setWeekMonday((m) => addLocalDays(m, -7, tz))}
          >
            ‹
          </button>
          <button type="button" className="secondary" onClick={() => setWeekMonday((m) => addLocalDays(m, 7, tz))}>
            ›
          </button>
        </div>
        <div className="week-row">
          {days.map((ymd) => {
            const n = (byYmd[ymd] ?? []).length;
            const dom = Number(ymd.slice(-2));
            return (
              <button
                key={ymd}
                type="button"
                className={n ? "cal-day has-data" : "cal-day"}
                onClick={() => openDay(ymd, true)}
              >
                {n ? `${dom}·` : dom}
              </button>
            );
          })}
        </div>
      </ScreenShell>
    );
  }

  if (view === "day" && selectedYmd) {
    const items = [...(byYmd[selectedYmd] ?? [])].sort((a, b) => a.completedAtSec - b.completedAtSec);
    return (
      <ScreenShell
        lang={uiLang}
        title={`${t(uiLang, "statsDayHeader")} ${selectedYmd}`}
        onBack={() => (fromWeek ? setView("week") : setView("calendar"))}
        backLabel={fromWeek ? "statsBackWeek" : "statsBackCalendar"}
      >
        {items.length === 0 ? (
          <p>{t(uiLang, "statsNoDayEntries")}</p>
        ) : (
          items.map((it, idx) => {
            const { hm } = safeLocalParts(new Date(it.completedAtSec * 1000), tz);
            return (
              <div key={`${it.completedAtSec}-${idx}`} className="day-block">
                <h2>
                  {t(uiLang, "statsPassAt")} {idx + 1}/{items.length} — {hm}
                </h2>
                <pre className="answers-pre">{it.answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}</pre>
              </div>
            );
          })
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" onClick={() => setView("modes")}>
            {t(uiLang, "statsBackModes")}
          </button>
        </div>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell lang={uiLang} onBack={onBackSettings} backLabel="statsBackSettings">
      {err ? <p className="error">{err}</p> : null}
    </ScreenShell>
  );
}
