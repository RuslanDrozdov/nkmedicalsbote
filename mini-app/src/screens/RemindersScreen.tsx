import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api";
import ScreenShell from "../components/ScreenShell";
import { TIMEZONE_OPTIONS, type Lang, t } from "../copy";

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type RemindersData = {
  ok: boolean;
  timezone: string;
  time_hhmm: string;
  enabled: boolean;
};

type Props = {
  lang: Lang;
  onBack: () => void;
};

export default function RemindersScreen({ lang, onBack }: Props) {
  const [data, setData] = useState<RemindersData | null>(null);
  const [timeDraft, setTimeDraft] = useState("09:00");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<RemindersData>("/api/reminders")
      .then((r) => {
        setData(r);
        setTimeDraft(r.time_hhmm);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiPatch<RemindersData>("/api/reminders", body);
      setData(r);
      setTimeDraft(r.time_hhmm);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (!data) return;
    await patch({ enabled: !data.enabled });
  }

  async function saveTime() {
    if (!TIME_RE.test(timeDraft.trim())) {
      setErr(t(lang, "invalidTime"));
      return;
    }
    await patch({ time_hhmm: timeDraft.trim() });
  }

  async function setTz(tz: string) {
    await patch({ timezone: tz });
  }

  async function sendTest() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await apiPost<{ ok: boolean; sent?: boolean }>("/api/reminders/test", {});
      setMsg(r.sent ? t(lang, "reminderTestOk") : t(lang, "reminderTestFail"));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data && !err) {
    return (
      <ScreenShell lang={lang} title={t(lang, "remindersBtn")} onBack={onBack} backLabel="statsBackSettings">
        <p className="loading">{t(lang, "loading")}</p>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell lang={lang} title={t(lang, "remindersBtn")} onBack={onBack} backLabel="statsBackSettings">
      <p>{data?.enabled ? t(lang, "reminderEnabled") : t(lang, "reminderDisabled")}</p>
      <div className="row">
        <button type="button" className="accent-magenta" disabled={busy || !data} onClick={() => void toggle()}>
          {data?.enabled ? "Off" : "On"}
        </button>
      </div>
      <label className="field-label">{t(lang, "reminderTime")}</label>
      <input type="text" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} placeholder="09:00" />
      <div className="row">
        <button type="button" className="accent-magenta" disabled={busy} onClick={() => void saveTime()}>
          {t(lang, "reminderSaveTime")}
        </button>
      </div>
      <p className="hint">{t(lang, "reminderTz")}: {data?.timezone ?? "UTC"}</p>
      <div className="tz-list">
        {TIMEZONE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={data?.timezone === opt.id ? "accent-magenta" : "secondary"}
            disabled={busy}
            onClick={() => void setTz(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="secondary" disabled={busy} onClick={() => void sendTest()}>
          {t(lang, "reminderTest")}
        </button>
      </div>
      {msg ? <p className="ok-msg">{msg}</p> : null}
      {err ? <p className="error">{err}</p> : null}
    </ScreenShell>
  );
}
