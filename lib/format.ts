import { translate, type Language } from "@/lib/i18n";

export function formatTime(iso: string, language: Language = "zh"): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;

  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return translate(language, "timeDate", {
    year: y,
    month: m,
    day: d,
    time: `${hh}:${mm}`,
  });
}

export function formatRelative(iso: string, language: Language = "zh"): string {
  const date = new Date(iso).getTime();
  const diff = Date.now() - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return translate(language, "timeJustNow");
  if (minutes < 60) {
    return translate(language, "timeMinutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(language, "timeHoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return translate(language, "timeDaysAgo", { count: days });
  return formatTime(iso, language);
}
