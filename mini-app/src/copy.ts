export type Lang = "ru" | "en";

export const copy: Record<
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
    | "loading"
    | "backHome"
    | "settingsHeader"
    | "remindersBtn"
    | "statisticsBtn"
    | "reminderEnabled"
    | "reminderDisabled"
    | "reminderTime"
    | "reminderTz"
    | "reminderSaveTime"
    | "reminderTest"
    | "reminderTestOk"
    | "reminderTestFail"
    | "statsTitle"
    | "statsModeHint"
    | "statsByDays"
    | "statsByWeeks"
    | "statsExportBtn"
    | "statsBackSettings"
    | "statsBackModes"
    | "statsBackCalendar"
    | "statsBackWeek"
    | "statsEmpty"
    | "statsDayHeader"
    | "statsWeekHeader"
    | "statsWeekCount"
    | "statsPassAt"
    | "statsCalendarHint"
    | "statsWeekPickDay"
    | "statsNoDayEntries"
    | "homeTitle"
    | "homeSurveyZone"
    | "homeSettingsZoneLine1"
    | "homeSettingsZoneLine2"
    | "homeStartSurvey"
    | "invalidTime",
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
    backHome: "На главный экран",
    settingsHeader: "Настройки",
    remindersBtn: "Напоминания",
    statisticsBtn: "Статистика",
    reminderEnabled: "Приглашение на опрос: включено",
    reminderDisabled: "Приглашение на опрос: выключено",
    reminderTime: "Время (HH:MM)",
    reminderTz: "Часовой пояс",
    reminderSaveTime: "Сохранить время",
    reminderTest: "Тестовое напоминание",
    reminderTestOk: "Отправлено",
    reminderTestFail: "Не удалось отправить",
    statsTitle: "Статистика опросов",
    statsModeHint: "Выберите просмотр: по дням (календарь) или по неделям.",
    statsByDays: "По дням",
    statsByWeeks: "По неделям",
    statsExportBtn: "Скачать таблицу",
    statsBackSettings: "Назад к настройкам",
    statsBackModes: "К режимам",
    statsBackCalendar: "К календарю",
    statsBackWeek: "К неделе",
    statsEmpty: "Пока нет завершённых опросов.",
    statsDayHeader: "Ответы за",
    statsWeekHeader: "Неделя",
    statsWeekCount: "Завершений за неделю:",
    statsPassAt: "Прохождение",
    statsCalendarHint: "Точка — есть ответы в этот день. Выберите день.",
    statsWeekPickDay: "Нажмите день недели для подробностей.",
    statsNoDayEntries: "Нет записей",
    homeTitle: "Неврология головного мозга",
    homeSurveyZone: "Опрос",
    homeSettingsZoneLine1: "Настройки",
    homeSettingsZoneLine2: "Статистика",
    homeStartSurvey: "Начать опрос",
    invalidTime: "Формат времени: HH:MM",
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
    backHome: "Back to home",
    settingsHeader: "Settings",
    remindersBtn: "Reminders",
    statisticsBtn: "Statistics",
    reminderEnabled: "Survey reminder: on",
    reminderDisabled: "Survey reminder: off",
    reminderTime: "Time (HH:MM)",
    reminderTz: "Time zone",
    reminderSaveTime: "Save time",
    reminderTest: "Test reminder",
    reminderTestOk: "Sent",
    reminderTestFail: "Could not send",
    statsTitle: "Survey statistics",
    statsModeHint: "Choose view: by day (calendar) or by week.",
    statsByDays: "By day",
    statsByWeeks: "By week",
    statsExportBtn: "Download spreadsheet",
    statsBackSettings: "Back to settings",
    statsBackModes: "Back to modes",
    statsBackCalendar: "Back to calendar",
    statsBackWeek: "Back to week",
    statsEmpty: "No completed surveys yet.",
    statsDayHeader: "Answers for",
    statsWeekHeader: "Week",
    statsWeekCount: "Completions this week:",
    statsPassAt: "Completion",
    statsCalendarHint: "Dot = answers that day. Pick a day.",
    statsWeekPickDay: "Tap a day below for details.",
    statsNoDayEntries: "No entries",
    homeTitle: "Neurology of the brain",
    homeSurveyZone: "Survey",
    homeSettingsZoneLine1: "Settings",
    homeSettingsZoneLine2: "Statistics",
    homeStartSurvey: "Start survey",
    invalidTime: "Time format: HH:MM",
  },
};

export type CopyKey = keyof (typeof copy)["ru"];

export function t(lang: Lang, key: CopyKey): string {
  return copy[lang][key];
}

export const TIMEZONE_OPTIONS = [
  { id: "Europe/Moscow", label: "Europe/Moscow (UTC+3)" },
  { id: "Europe/Kaliningrad", label: "Europe/Kaliningrad (UTC+2)" },
  { id: "Asia/Yekaterinburg", label: "Asia/Yekaterinburg (UTC+5)" },
  { id: "Asia/Novosibirsk", label: "Asia/Novosibirsk (UTC+7)" },
  { id: "Asia/Irkutsk", label: "Asia/Irkutsk (UTC+8)" },
  { id: "Asia/Yakutsk", label: "Asia/Yakutsk (UTC+9)" },
  { id: "Asia/Vladivostok", label: "Asia/Vladivostok (UTC+10)" },
  { id: "Asia/Magadan", label: "Asia/Magadan (UTC+11)" },
  { id: "Asia/Kamchatka", label: "Asia/Kamchatka (UTC+12)" },
  { id: "UTC", label: "UTC" },
] as const;
