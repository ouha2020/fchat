export interface JapanHoliday {
  date: string;
  name: string;
  shortName: string;
}

// Source: Cabinet Office, Government of Japan
// https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
export const JAPAN_HOLIDAYS: Record<string, JapanHoliday> = {
  "2026-01-01": holiday("2026-01-01", "元日"),
  "2026-01-12": holiday("2026-01-12", "成人の日"),
  "2026-02-11": holiday("2026-02-11", "建国記念の日"),
  "2026-02-23": holiday("2026-02-23", "天皇誕生日"),
  "2026-03-20": holiday("2026-03-20", "春分の日"),
  "2026-04-29": holiday("2026-04-29", "昭和の日"),
  "2026-05-03": holiday("2026-05-03", "憲法記念日"),
  "2026-05-04": holiday("2026-05-04", "みどりの日"),
  "2026-05-05": holiday("2026-05-05", "こどもの日"),
  "2026-05-06": holiday("2026-05-06", "休日"),
  "2026-07-20": holiday("2026-07-20", "海の日"),
  "2026-08-11": holiday("2026-08-11", "山の日"),
  "2026-09-21": holiday("2026-09-21", "敬老の日"),
  "2026-09-22": holiday("2026-09-22", "休日"),
  "2026-09-23": holiday("2026-09-23", "秋分の日"),
  "2026-10-12": holiday("2026-10-12", "スポーツの日"),
  "2026-11-03": holiday("2026-11-03", "文化の日"),
  "2026-11-23": holiday("2026-11-23", "勤労感謝の日"),
  "2027-01-01": holiday("2027-01-01", "元日"),
  "2027-01-11": holiday("2027-01-11", "成人の日"),
  "2027-02-11": holiday("2027-02-11", "建国記念の日"),
  "2027-02-23": holiday("2027-02-23", "天皇誕生日"),
  "2027-03-21": holiday("2027-03-21", "春分の日"),
  "2027-03-22": holiday("2027-03-22", "休日"),
  "2027-04-29": holiday("2027-04-29", "昭和の日"),
  "2027-05-03": holiday("2027-05-03", "憲法記念日"),
  "2027-05-04": holiday("2027-05-04", "みどりの日"),
  "2027-05-05": holiday("2027-05-05", "こどもの日"),
  "2027-07-19": holiday("2027-07-19", "海の日"),
  "2027-08-11": holiday("2027-08-11", "山の日"),
  "2027-09-20": holiday("2027-09-20", "敬老の日"),
  "2027-09-23": holiday("2027-09-23", "秋分の日"),
  "2027-10-11": holiday("2027-10-11", "スポーツの日"),
  "2027-11-03": holiday("2027-11-03", "文化の日"),
  "2027-11-23": holiday("2027-11-23", "勤労感謝の日"),
};

export function getJapanHoliday(date: Date): JapanHoliday | null {
  return JAPAN_HOLIDAYS[toLocalDateKey(date)] ?? null;
}

export function isJapanHoliday(date: Date): boolean {
  return Boolean(getJapanHoliday(date));
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function holiday(date: string, name: string): JapanHoliday {
  return {
    date,
    name,
    shortName: name === "休日" ? "休" : name.replace(/の日$/, ""),
  };
}
