/**
 * EasyParking → wallet мэдэгдлүүд (§8, §11.5).
 *
 * HMAC гарын үсэг одоогоор БАЙХГҮЙ (§8.5): мөнгөний шийдвэр гаргахын өмнө
 * `payments.retrieve()`-ээр status/amount/ebarimts-ыг баталгаажуул. Нэмэлтээр
 * `isEasyParkingIP()`-ээр эх IP-г шалгаж болно.
 */
import type { Debt, Ebarimt, ReceiptType, Reservation, SessionStatus, Timestamp } from "./types.js";

export const WEBHOOK_IPS = {
  production: "202.21.117.178",
  test: "152.42.235.199",
} as const;

export type Environment = keyof typeof WEBHOOK_IPS;

/** Webhook-ийн эх IP EasyParking-ийнх эсэх. `::ffff:` IPv4-mapped хэлбэрийг ч таньна. */
export function isEasyParkingIP(ip: string | undefined | null, environment?: Environment): boolean {
  if (!ip) return false;
  const v4 = ip.trim().replace(/^::ffff:/i, "");
  return environment ? WEBHOOK_IPS[environment] === v4 : Object.values(WEBHOOK_IPS).includes(v4 as never);
}

// ─── Төлбөр, баримт, захиалга (§8) ──────────────────────────────────────────

export interface PaymentPaidEvent {
  event: "payment.paid";
  event_id: string;
  payment_id: string;
  status: "PAID";
  transaction_id: string;
  amount: number;
  vat_amount: number;
  paid_at: Timestamp;
  plate: string;
  site_code: string;
  site_name: string;
  parking_amount: number;
  debt_amount: number;
  debt_count: number;
  debts: Debt[];
  /** qr_data БАЙХГҮЙ */
  ebarimt: Omit<Ebarimt, "qr_data"> | null;
  /** Төлбөр батлагдахаас ӨМНӨХ төлөв — одоогийн төлөвийг GET-ээр */
  session_status: SessionStatus;
  amount_due: number;
  needs_additional_payment: boolean;
  overpaid_amount: number;
  /** v1.3 */
  receipt_type?: ReceiptType;
  payer_reg_no?: string | null;
  test?: false;
}

/** Админы «Турших» товч — event_id байхгүй, мөнгөний бүртгэлд БҮҮ оруул. */
export interface PaymentPaidTestEvent extends Omit<PaymentPaidEvent, "event" | "event_id" | "test" | "ebarimt"> {
  event: "payment.paid.test";
  event_id?: undefined;
  test: true;
  ebarimt: Ebarimt | null;
}

export interface ReceiptReadyEvent {
  event: "receipt.ready";
  event_id: string;
  payment_id: string;
  receipt_id: string;
  ddtd: string;
  lottery: string | null;
  /** ТЕКСТ ("1000.00") — `Number()`-ээр хөрвүүл */
  amount: string;
  vat_amount: string;
  kind: "PARKING" | "DEBT" | "RESERVATION" | (string & {});
  debt_id: string | null;
  status: "SENT" | (string & {});
  /** v1.3 — байгууллагын баримтад lottery гарахгүй */
  receipt_type?: ReceiptType;
  payer_reg_no?: string | null;
}

export type ReservationEventType =
  | "reservation.confirmed"
  | "reservation.checked_in"
  | "reservation.completed"
  | "reservation.cancelled"
  | "reservation.no_show";

export interface ReservationEvent {
  event: ReservationEventType;
  event_id: string;
  reservation: Reservation;
}

export type WebhookEvent = PaymentPaidEvent | PaymentPaidTestEvent | ReceiptReadyEvent | ReservationEvent;

export class WebhookParseError extends Error {
  override name = "WebhookParseError";
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function header(headers: HeaderBag | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function toObject(body: unknown): Record<string, unknown> {
  let value = body;
  if (typeof value === "string" || value instanceof Uint8Array) {
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);
    try {
      value = JSON.parse(text);
    } catch (err) {
      throw new WebhookParseError("Webhook body JSON биш");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebhookParseError("Webhook body JSON объект биш");
  }
  return value as Record<string, unknown>;
}

export interface ParsedWebhook {
  event: WebhookEvent;
  /** Давхардлыг ялгах түлхүүр (event_id). Туршилтын event-д undefined. */
  idempotencyKey: string | undefined;
  /** X-Parking-Partner — таны түлхүүрийн нэр */
  partner: string | undefined;
  isTest: boolean;
}

/**
 * Төлбөр/баримт/захиалгын webhook-ийг задална (§8). Raw string, Buffer эсвэл
 * аль хэдийн задалсан объект авна. 10 секундэд 2xx буцаах ёстой тул
 * дараалалд хийгээд шууд хариулахыг зөвлөнө; ижил event дахин ирж болно (at-least-once).
 */
export function parseWebhook(body: unknown, headers?: HeaderBag): ParsedWebhook {
  const obj = toObject(body);
  const type = typeof obj.event === "string" ? obj.event : header(headers, "x-parking-event");
  if (!type) throw new WebhookParseError("event талбар/X-Parking-Event толгой алга");
  const event = { ...obj, event: type } as unknown as WebhookEvent;
  const isTest = obj.test === true || type.endsWith(".test");
  const idempotencyKey =
    (typeof obj.event_id === "string" ? obj.event_id : undefined) ??
    header(headers, "x-parking-event-id") ??
    header(headers, "idempotency-key");
  return { event, idempotencyKey: isTest ? undefined : idempotencyKey, partner: header(headers, "x-parking-partner"), isTest };
}

// ─── Машины орох/гарах мэдэгдэл (§11.5) ─────────────────────────────────────

export interface VehicleNotificationData {
  plateNo: string;
  enteredDate: Timestamp;
  /** Зөвхөн «Гарсан»-д */
  exitedDate?: Timestamp;
  // extended формат:
  event?: "ENTRY" | "EXIT";
  sessionId?: string;
  siteCode?: string;
  siteName?: string;
  freeMinutes?: number;
  freeUntil?: Timestamp | null;
  /** false — гарах камерт уншигдалгүй систем хаасан; exitedDate бодит биш */
  exitConfirmed?: boolean;
  minutesParked?: number;
  totalFee?: number;
  isFree?: boolean;
}

export interface ParsedVehicleNotification {
  type: "vehicle.entry" | "vehicle.exit";
  data: VehicleNotificationData;
  /** Idempotency-Key / X-Parking-Event-Id. Байхгүй бол plateNo+enteredDate+төрлөөс бүтээнэ. */
  idempotencyKey: string;
  /** Админы «Турших» (0000ТЕС, Idempotency-Key = test-…) */
  isTest: boolean;
}

/**
 * Хариуны body — 2xx БӨГӨӨД `{"Success": true}` байх ёстой, эс бол EasyParking
 * дахин илгээнэ. 5 секундэд хариулна.
 */
export const VEHICLE_NOTIFICATION_ACK = Object.freeze({ Success: true, Message: "OK" });

export function parseVehicleNotification(body: unknown, headers?: HeaderBag): ParsedVehicleNotification {
  const obj = toObject(body);
  const data = obj.data as VehicleNotificationData | undefined;
  if (!data || typeof data !== "object" || typeof data.plateNo !== "string" || typeof data.enteredDate !== "string") {
    throw new WebhookParseError("data.plateNo / data.enteredDate алга");
  }
  const headerType = header(headers, "x-parking-event");
  const type: ParsedVehicleNotification["type"] =
    headerType === "vehicle.exit" || headerType === "vehicle.entry"
      ? headerType
      : data.exitedDate || data.event === "EXIT"
        ? "vehicle.exit"
        : "vehicle.entry";
  const key = header(headers, "idempotency-key") ?? header(headers, "x-parking-event-id");
  return {
    type,
    data,
    idempotencyKey: key ?? `${data.plateNo}|${data.enteredDate}|${type}`,
    isTest: Boolean(key?.startsWith("test-")) || data.plateNo === "0000ТЕС",
  };
}
