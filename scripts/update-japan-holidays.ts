import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface HolidayRow {
  date: string;
  name: string;
}

const SOURCE_URL = "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html";

const HOLIDAYS: HolidayRow[] = [
  ["2026-01-01", "元日"],
  ["2026-01-12", "成人の日"],
  ["2026-02-11", "建国記念の日"],
  ["2026-02-23", "天皇誕生日"],
  ["2026-03-20", "春分の日"],
  ["2026-04-29", "昭和の日"],
  ["2026-05-03", "憲法記念日"],
  ["2026-05-04", "みどりの日"],
  ["2026-05-05", "こどもの日"],
  ["2026-05-06", "休日"],
  ["2026-07-20", "海の日"],
  ["2026-08-11", "山の日"],
  ["2026-09-21", "敬老の日"],
  ["2026-09-22", "休日"],
  ["2026-09-23", "秋分の日"],
  ["2026-10-12", "スポーツの日"],
  ["2026-11-03", "文化の日"],
  ["2026-11-23", "勤労感謝の日"],
  ["2027-01-01", "元日"],
  ["2027-01-11", "成人の日"],
  ["2027-02-11", "建国記念の日"],
  ["2027-02-23", "天皇誕生日"],
  ["2027-03-21", "春分の日"],
  ["2027-03-22", "休日"],
  ["2027-04-29", "昭和の日"],
  ["2027-05-03", "憲法記念日"],
  ["2027-05-04", "みどりの日"],
  ["2027-05-05", "こどもの日"],
  ["2027-07-19", "海の日"],
  ["2027-08-11", "山の日"],
  ["2027-09-20", "敬老の日"],
  ["2027-09-23", "秋分の日"],
  ["2027-10-11", "スポーツの日"],
  ["2027-11-03", "文化の日"],
  ["2027-11-23", "勤労感謝の日"],
].map(([date, name]) => ({ date, name }));

const output = `export interface JapanHoliday {
  date: string;
  name: string;
  shortName: string;
}

// Source: Cabinet Office, Government of Japan
// ${SOURCE_URL}
export const JAPAN_HOLIDAYS: Record<string, JapanHoliday> = {
${HOLIDAYS.map((row) => `  "${row.date}": holiday("${row.date}", "${row.name}"),`).join("\n")}
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
  return \`${"${year}"}-${"${month}"}-${"${day}"}\`;
}

function holiday(date: string, name: string): JapanHoliday {
  return {
    date,
    name,
    shortName: name === "休日" ? "休" : name.replace(/の日$/, ""),
  };
}
`;

writeFileSync(resolve("lib/japanHolidays.ts"), output, "utf8");
console.log(`Generated lib/japanHolidays.ts from ${HOLIDAYS.length} Cabinet Office holiday rows.`);
