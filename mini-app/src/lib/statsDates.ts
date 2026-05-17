export function safeLocalParts(date: Date, timeZone: string): { ymd: string; hm: string } {
  const tz = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const m: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") m[p.type] = p.value;
    }
    return { ymd: `${m.year}-${m.month}-${m.day}`, hm: `${m.hour}:${m.minute}` };
  } catch {
    return safeLocalParts(date, "UTC");
  }
}

export function instantForLocalDate(y: number, mo1to12: number, d: number, tz: string): number {
  const target = `${y}-${String(mo1to12).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let guess = Date.UTC(y, mo1to12 - 1, d, 12, 0, 0);
  for (let i = 0; i < 48; i++) {
    const { ymd } = safeLocalParts(new Date(guess), tz);
    if (ymd === target) return guess;
    guess += ymd < target ? 3600000 : -3600000;
  }
  return guess;
}

export function localWeekdayMon0FromUtcMs(utcMs: number, tz: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(utcMs));
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[short] ?? 0;
}

export function daysInGregorianMonth(y: number, mo1to12: number): number {
  return new Date(y, mo1to12, 0).getDate();
}

export function addLocalDays(ymd: string, delta: number, tz: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const ms = instantForLocalDate(y, m, d, tz) + delta * 86400000;
  return safeLocalParts(new Date(ms), tz).ymd;
}

export function mondayYmdOfWeekContaining(ymd: string, tz: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const ms = instantForLocalDate(y, m, d, tz);
  const w = localWeekdayMon0FromUtcMs(ms, tz);
  return addLocalDays(ymd, -w, tz);
}

export function ymdToYmm(ymd: string): number {
  return parseInt(ymd.slice(0, 4) + ymd.slice(5, 7), 10);
}

export function shiftMonthYmm(yyyymm: number, delta: number): number {
  let y = Math.floor(yyyymm / 100);
  let mo = yyyymm % 100;
  mo += delta;
  while (mo < 1) {
    mo += 12;
    y -= 1;
  }
  while (mo > 12) {
    mo -= 12;
    y += 1;
  }
  return y * 100 + mo;
}

export function todayYmd(tz: string): string {
  return safeLocalParts(new Date(), tz).ymd;
}

export function monthTitle(lang: "ru" | "en", yyyymm: number): string {
  const y = Math.floor(yyyymm / 100);
  const mo = yyyymm % 100;
  return new Intl.DateTimeFormat(lang === "en" ? "en" : "ru", { month: "long", year: "numeric" }).format(
    new Date(y, mo - 1, 1),
  );
}

export const WEEKDAY_LABELS = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
} as const;
