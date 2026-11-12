/**
 * API-ийн өгөгдлийн төрлүүд (EasyParking × Wallet API v1.2).
 *
 * Талбарын нэр wire дээрхтэйгээ ЯГ ижил (төлбөр/захиалга snake_case,
 * машин бүртгэл/газрын зураг camelCase) — специйг шууд харьцуулахад хялбар.
 * Цагийн утга бүгд UTC string (§2.2); `parseTime()`-аар Date болгоно.
 * API шинэ талбар нэмж болох тул үл мэдэх талбарыг үл тооно (§14).
 */

/** UTC ISO-8601 string. Бүсгүй ("2026-10-22T04:30:00.123456") ч UTC гэж уншина. */
export type Timestamp = string;

// ─── Өр (§6) ────────────────────────────────────────────────────────────────

export type DebtReason =
  | "unpaid_exit"
  | "auto_close"
  | "night_close"
  | "shift_close"
  | "manual"
  | "admin_remove"
  | "log_exit"
  | (string & {});

/** /sessions, /payments, payment.paid дахь өр (snake_case). */
export interface Debt {
  debt_id: string;
  amount: number;
  created_at: Timestamp;
  reason: DebtReason;
  /** Хэрэглэгчид харуулах тайлбар */
  reason_text: string;
  site_code: string;
  site_name: string;
  /** Гараар бүртгэсэн өрт null */
  session_id: string | null;
  entry_time: Timestamp | null;
  exit_time: Timestamp | null;
  duration_minutes: number | null;
}

/** /vehicles/bill дахь өр (camelCase, цаг «…Z»). */
export interface BillDebt {
  debtId: string;
  amount: number;
  createdAt: Timestamp;
  reason: DebtReason;
  reasonText: string;
  siteCode: string;
  siteName: string;
  enteredDate: Timestamp | null;
  exitedDate: Timestamp | null;
  minutesParked: number | null;
}

// ─── Зогсолт (§4.1, §4.6) ───────────────────────────────────────────────────

export type SessionStatus = "OPEN" | "AWAITING_PAYMENT" | "PAID" | "CLOSED" | (string & {});

export interface Session {
  session_id: string;
  plate_number: string;
  site_code: string;
  site_name: string;
  entry_time: Timestamp;
  duration_minutes: number;
  base_fee: number;
  vat_amount: number;
  discount_amount: number;
  total_fee: number;
  /** Зөвхөн энэ зогсолтын төлөх дүн — өр БАГТААГҮЙ */
  amount_due: number;
  is_free: boolean;
  status: SessionStatus;
  paid: boolean;
  debt_amount: number;
  debt_count: number;
  debts: Debt[];
}

export interface SessionListParams {
  /** Машины дугаар, КИРИЛЛ үсгээр (1234УБА). Латин үсэг таарахгүй. */
  plate: string;
  /** Өгөхгүй бол бүх зогсоолоос хайна */
  site_code?: string;
}

export interface SessionListResponse {
  /** Шинээс хуучин, дээд тал нь 5. Олдохгүй бол [] */
  sessions: Session[];
}

export interface RecentExit extends Session {
  exit_read_at: Timestamp;
}

export interface RecentExitsParams {
  /** 1–60, анхдагч 5 */
  minutes?: number;
  site_code?: string;
  include_completed?: boolean;
}

export interface RecentExitsResponse {
  minutes: number;
  waiting: RecentExit[];
  /** include_completed=true үед (өргүй) */
  completed?: RecentExit[];
}

// ─── e-Barimt (§7) ──────────────────────────────────────────────────────────

export type ReceiptKind = "PARKING" | "DEBT" | "RESERVATION" | (string & {});
/** Төлбөрийн түвшний баримтын төрөл (v1.3) */
export type ReceiptType = "ORGANIZATION" | "CITIZEN" | (string & {});
export type ReceiptStatus = "PENDING" | "SENT" | "FAILED" | "REVIEW" | (string & {});

export interface Ebarimt {
  receipt_id?: string;
  kind?: ReceiptKind;
  debt_id?: string | null;
  /** Баримт үүсэх хүртэл null */
  ddtd: string | null;
  lottery: string | null;
  amount: number;
  vat_amount: number;
  status: ReceiptStatus;
  provider: string | null;
  receiver_type?: "CITIZEN" | "COMPANY" | (string & {});
  /** Байгууллагын баримтад регистр/ТТД (v1.3) */
  payer_reg_no?: string | null;
  error: string | null;
  /** Зөвхөн SENT баримтад, зөвхөн GET /payments/{id}-д. Авмагц өөрөө хадгална. */
  qr_data?: string | null;
  created_at: Timestamp;
}

// ─── Төлбөр (§4.2–4.5) ──────────────────────────────────────────────────────

export type PaymentStatus = "PENDING" | "PAID" | "CANCELLED" | (string & {});

export type BarrierCommandStatus =
  | "SUCCESS"
  | "PENDING"
  | "FAILED"
  | "UNKNOWN"
  | "REVIEWED"
  | "NOT_REQUESTED"
  | (string & {});

export interface PaymentCreateParams {
  session_id: string;
  /** true — өмнөх айлчлалын өрийг хамт нэг төлбөрт нийлүүлнэ. Нэг зогсолтод тогтмол нэг утга. */
  include_debts?: boolean;
  /**
   * Байгууллагын e-Barimt (v1.3, §7.5): ААН регистр (7 орон) эсвэл ТТД (11–14 орон).
   * Иргэний баримтад бүү илгээ. Буруу формат → 422. PENDING intent-ийг ижил
   * session_id-аар дахин дуудахад хүлээн авагч шинэчлэгдэнэ.
   */
  payer_reg_no?: string;
}

export interface PaymentIntent {
  payment_id: string;
  /** Хэрэглэгчээс татах НИЙТ дүн (parking_amount + debt_amount) */
  amount: number;
  vat_amount: number;
  status: PaymentStatus;
  plate_number: string;
  parking_amount: number;
  debt_amount: number;
  debt_count: number;
  debts: Debt[];
  /** v1.3 */
  receipt_type?: ReceiptType;
  payer_reg_no?: string | null;
}

export interface PaymentConfirmParams {
  /** Таны гүйлгээний давтагдашгүй дугаар (1–120 тэмдэгт). Нэг гүйлгээ = нэг төлбөр. */
  transaction_id: string | number;
  /** Татсан дүн — intent-ийн amount-тай ЯГ тэнцүү. Давхар шалгалтад заавал илгээхийг зөвлөнө. */
  amount?: number;
  /**
   * Intent-д өгөөгүй бол энд (баримт үүсэхээс ӨМНӨ хэрэглэгдэнэ, v1.3).
   * Давтан confirm хүлээн авагчийг өөрчлөхгүй.
   */
  payer_reg_no?: string;
}

interface PaymentStateFields {
  payment_id: string;
  status: PaymentStatus;
  session_status: SessionStatus;
  amount_due: number;
  needs_additional_payment: boolean;
  overpaid_amount: number;
  barrier_opened: boolean;
  barrier_command_status: BarrierCommandStatus;
  barrier_command_id: string | null;
  gate_acknowledged: boolean;
  /** Үргэлж UNKNOWN */
  physical_gate_state: string;
  exit_deadline: Timestamp | null;
  exit_waiting: boolean;
  parking_amount: number;
  debt_amount: number;
  debt_count: number;
  debts: Debt[];
  /** v1.3 */
  receipt_type?: ReceiptType;
  payer_reg_no?: string | null;
}

/**
 * Confirm-ийн хариу. Давтан confirm-д (ижил transaction_id) `paid_at`,
 * `ebarimt`, `ebarimts` БАЙХГҮЙ — `payments.retrieve()`-ээр авна.
 */
export interface PaymentConfirmResponse extends PaymentStateFields {
  paid_at?: Timestamp;
  /** Хамгийн сүүлийн баримт (хуучин талбар) */
  ebarimt?: Ebarimt | null;
  /** Төлбөрийн бүх баримт */
  ebarimts?: Ebarimt[];
}

export interface Payment extends PaymentStateFields {
  amount: number;
  paid_at: Timestamp | null;
  ebarimt: Ebarimt | null;
  ebarimts: Ebarimt[];
}

export interface PaymentCancelResponse {
  payment_id: string;
  status: "CANCELLED";
}

// ─── Байгууллагын e-Barimt (v1.3, §7.5) ─────────────────────────────────────

export interface PayerLookupResponse {
  reg_no: string;
  receipt_type: ReceiptType;
  /** false = шалгах суваг түр ажиллахгүй («олдсонгүй» биш) — төлбөрийг үргэлжлүүлж болно */
  available: boolean;
  found: boolean;
  name: string | null;
  tin: string | null;
  is_vat_payer: boolean | null;
}

export interface PaymentEbarimtParams {
  /** ААН регистр (7 орон) эсвэл ТТД (11–14 орон) */
  payer_reg_no: string;
}

/** Spec хариуны бүтцийг бичээгүй — танигдсан талбаруудаас гадна бусдыг ч агуулж болно. */
export interface PaymentEbarimtResponse {
  payment_id?: string;
  receipt_type?: ReceiptType;
  payer_reg_no?: string | null;
  ebarimts?: Ebarimt[];
  [key: string]: unknown;
}

// ─── Захиалга (§9) ──────────────────────────────────────────────────────────

export type ReservationStatus =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "NO_SHOW"
  | (string & {});

export interface ReservationRules {
  min_minutes: number;
  max_minutes: number;
  max_days_ahead: number;
  min_lead_minutes: number;
  hold_minutes: number;
  arrive_early_minutes: number;
  cancel_free_minutes: number;
}

/** Бүсийн тэмдэгтэй ISO string ("…+08:00" / "…Z") эсвэл Date. */
export type ZonedTime = string | Date;

export interface AvailabilityParams {
  site_code: string;
  start_time: ZonedTime;
  duration_minutes?: number;
  end_time?: ZonedTime;
}

export interface Availability {
  site_code: string;
  site_name: string;
  start_time: Timestamp;
  end_time: Timestamp;
  duration_minutes: number;
  available: boolean;
  spots: number;
  reserved: number;
  free_spots: number;
  amount: number;
  vat_amount: number;
  currency: "MNT" | (string & {});
  rules: ReservationRules;
}

export interface ReservationCreateParams {
  site_code: string;
  /** Кирилл үсгээр */
  plate_number: string;
  /** Бүсийн тэмдэг ЗААВАЛ (бүсгүй утгыг сервер татгалзана) */
  start_time: ZonedTime;
  duration_minutes?: number;
  end_time?: ZonedTime;
  /** Таны захиалгын дугаар (1–120). Идемпотент түлхүүр — заавал илгээхийг зөвлөнө. */
  external_ref?: string;
  user_id?: string;
  phone?: string;
  /** Нэг алхмын урсгал (§9.6): мөнгө аль хэдийн татсан бол */
  transaction_id?: string | number;
  amount?: number;
}

export interface Reservation {
  reservation_id: string;
  /** Харуулд хэлэх 6 тэмдэгтийн код */
  reservation_no: string;
  status: ReservationStatus;
  plate_number: string;
  site_code: string;
  site_name: string;
  address: string | null;
  start_time: Timestamp;
  end_time: Timestamp;
  duration_minutes: number;
  amount: number;
  vat_amount: number;
  currency: string;
  /** Тулгалтад. /payments/*-аар УДИРДАХГҮЙ. */
  payment_id: string | null;
  transaction_id: string | null;
  external_ref: string | null;
  user_id: string | null;
  arrive_from: Timestamp;
  free_cancel_until: Timestamp;
  cancellable: boolean;
  refund_if_cancelled_now: number;
  created_at: Timestamp;
  hold_expires_at: Timestamp | null;
  confirmed_at: Timestamp | null;
  checked_in_at: Timestamp | null;
  completed_at: Timestamp | null;
  cancelled_at: Timestamp | null;
  cancel_reason: string | null;
  refund_amount: number | null;
  session_id: string | null;
  ebarimt: Ebarimt | null;
  ebarimts: Ebarimt[];
}

export interface ReservationConfirmParams {
  transaction_id: string | number;
  amount: number;
}

export interface ReservationCancelParams {
  reason?: string;
  /** Буцаалтгүй цонхонд (NO_REFUND_WINDOW) байрыг чөлөөлөх */
  accept_no_refund?: boolean;
}

export interface ReservationListParams {
  plate?: string;
  user_id?: string;
  external_ref?: string;
  status?: ReservationStatus | ReservationStatus[];
  /** ≤200 */
  limit?: number;
}

export interface ReservationListResponse {
  reservations: Reservation[];
  [key: string]: unknown;
}

/** §9.10 */
export type ReservationErrorCode =
  | "INVALID_PLATE"
  | "INVALID_USER_ID"
  | "NOT_SUPPORTED"
  | "NOTHING_TO_CHARGE"
  | "AMOUNT_MISMATCH"
  | "FORBIDDEN"
  | "SITE_NOT_FOUND"
  | "NOT_FOUND"
  | "RESERVATIONS_DISABLED"
  | "NO_AVAILABILITY"
  | "DUPLICATE_RESERVATION"
  | "EXTERNAL_REF_CONFLICT"
  | "ALREADY_CONFIRMED"
  | "RESERVATION_CANCELLED"
  | "HOLD_EXPIRED"
  | "NO_REFUND_WINDOW"
  | "NOT_CANCELLABLE"
  | "INVALID_TIME"
  | "INVALID_DURATION"
  | "INVALID_WINDOW"
  | "START_TOO_SOON"
  | "START_TOO_FAR"
  | "INVALID_REQUEST";

// ─── Зогсоол (§10) ──────────────────────────────────────────────────────────

export interface Parking {
  siteCode: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  /** false бол координатыг газрын зурагт бүү таамагла */
  locationAvailable: boolean;
  /** 0 бол тохируулаагүй (free: null) */
  capacity: number;
  occupied: number;
  free: number | null;
  freeMinutes: number;
  noCharge: boolean;
  reservable: boolean;
  reservationSpots: number;
  reservationFreeNow: number;
  // Цахилгаан машины цэнэглэгч — spec v1.2-д бичигдээгүй, TEST-ийн хариунд ирдэг (2026-11-01)
  hasEvCharger?: boolean;
  evChargers?: unknown[];
  evConnectorsTotal?: number;
  evConnectorsFree?: number;
}

export interface ParkingListResponse {
  Success: boolean;
  Message: string;
  data: Parking[];
  sampledAt: Timestamp;
}

export interface SiteListResponse {
  sites: Array<Record<string, unknown> & { site_code: string }>;
  sampled_at: Timestamp;
}

// ─── Машин бүртгэл (§11) ────────────────────────────────────────────────────

export interface VehicleParams {
  /** Кирилл үсгээр */
  plateNo: string;
  /** 1–64 ASCII тэмдэгт (латин, цифр, . _ - : @ +) */
  userId: string | number;
}

export interface Envelope<T = undefined> {
  Success: boolean;
  /** OK / ALREADY_REGISTERED / NOT_FOUND / NO_ACTIVE_SESSION */
  Message: string;
  Detail?: string;
  data?: T;
}

export type VehicleRegisterResponse = Envelope & { Message: "OK" | "ALREADY_REGISTERED" | (string & {}) };
export type VehicleDeleteResponse = Envelope & { Message: "OK" | "NOT_FOUND" | (string & {}) };

export interface Bill {
  plateNo: string;
  sessionId: string;
  status: SessionStatus;
  siteCode: string;
  siteName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  enteredDate: Timestamp;
  minutesParked: number;
  freeMinutes: number;
  freeUntil: Timestamp | null;
  freeRemainingMinutes: number | null;
  isFree: boolean;
  freeReason: string | null;
  totalFee: number;
  paidAmount: number;
  /** Өр БАГТААГҮЙ */
  amountDue: number;
  debtAmount: number;
  debtCount: number;
  amountDueWithDebts: number;
  debts: BillDebt[];
  exitBlockReason: "debt_rule" | "minimum_stay" | (string & {}) | null;
  exitBlockReasonWithDebts: string | null;
  payableOnline: boolean;
  notPayableReason: "PAID_OVERSTAY" | "ALREADY_PAID" | "NOTHING_DUE" | (string & {}) | null;
  currency: string;
  exitDeadline: Timestamp | null;
  /** Таны энэ зогсолтод үүсгэсэн PENDING intent */
  paymentId: string | null;
  paymentAmount: number | null;
}

/** Машин зогсоолд байхгүй бол Message: "NO_ACTIVE_SESSION", data: null */
export type BillResponse = Envelope<Bill | null>;
