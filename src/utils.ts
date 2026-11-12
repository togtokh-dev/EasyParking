import type { ZonedTime } from "./types.js";

/**
 * Дугаарыг сервер хүлээн авдаг хэлбэрт оруулна: зай, зураасыг авч том үсэг
 * болгоно ("7886 укр" → "7886УКР"). Латин үсгийг кирилл рүү ХӨРВҮҮЛЭХГҮЙ (§2.2) —
 * өөр хүний машин руу таамаглахгүйн тулд. Латин эсэхийг `hasLatinLetters`-ээр шалгана.
 */
export function normalizePlate(plate: string): string {
  return plate.replace(/[\s\-‐-―]+/g, "").toUpperCase();
}

/** Дугаарт латин үсэг байвал true — хэрэглэгчээр кирилл үсгээр дахин оруулуулна. */
export function hasLatinLetters(plate: string): boolean {
  return /[A-Za-z]/.test(plate);
}

/**
 * Байгууллагын баримтын дугаар зөв эсэх (v1.3, §7.5): ААН регистр 7 орон эсвэл
 * ТТД 11–14 орон, зөвхөн цифр. Иргэний регистр (үсэгтэй) false. Илгээхээс өмнө
 * шалгаж 422-оос сэргийлнэ.
 */
export function isValidPayerRegNo(value: string): boolean {
  return /^(\d{7}|\d{11,14})$/.test(value.trim());
}

/**
 * EasyParking-ийн цагийг Date болгоно (§2.2). Гурван хэлбэрийг бүгд:
 * бүсгүй ("…04:30:00.123456" — UTC гэж), миллисекунд+Z, микросекунд+Z.
 */
export function parseTime(value: string): Date;
export function parseTime(value: string | null | undefined): Date | null;
export function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new TypeError(`Цагийн формат танигдсангүй: ${value}`);
    return d;
  }
  const [, main, frac, zone] = m;
  const ms = frac ? frac.slice(0, 4).padEnd(4, "0") : "";
  return new Date(`${main}${ms}${zone ?? "Z"}`);
}

/**
 * Захиалгын цагийг бүсийн тэмдэгтэй ISO болгоно. Date → UTC "…Z".
 * Бүсгүй string-ийг сервер 8 цагийн алдаанаас сэргийлж татгалздаг тул
 * илгээхээс өмнө энд барина.
 */
export function toZonedISOString(value: ZonedTime): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("Invalid Date");
    return value.toISOString();
  }
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    throw new TypeError(
      `Цаг бүсийн тэмдэгтэй байх ёстой ("2026-10-23T10:00:00+08:00" эсвэл "…Z"): ${value}`,
    );
  }
  return value.trim();
}

/** Цагийг Улаанбаатарын цагаар (UTC+8) "MM/DD HH:mm" хэлбэрээр — UI-д харуулахад. */
export function formatUlaanbaatar(value: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  const date = typeof value === "string" ? parseTime(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ulaanbaatar",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...opts,
  }).format(date);
}
