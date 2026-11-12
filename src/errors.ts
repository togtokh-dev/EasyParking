/**
 * Алдааны классууд. Бүх алдаа `EasyParkingError`-оос удамшина.
 *
 * HTTP хариуны алдаа нь `APIError` (статусаар нь дэд класс) — специйн гурван
 * хэлбэрийг бүгдийг задална:
 *  - төлбөрийн API:      {"detail": "..."}
 *  - захиалгын API:      {"detail": "...", "code": "NO_AVAILABILITY"}
 *  - машин бүртгэл/зураг: {"Success": false, "Message": "INVALID_PLATE", "Detail": "..."}
 */
export class EasyParkingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class APIError extends EasyParkingError {
  /** HTTP статус */
  readonly status: number;
  /** Монгол хэлээрх тайлбар (`detail` / `Detail`) */
  readonly detail: string | undefined;
  /**
   * Машинаар уншигдах код: захиалгын `code` (NO_AVAILABILITY г.м) эсвэл
   * машин бүртгэлийн `Message` (INVALID_PLATE г.м). Төлбөрийн API-д байхгүй.
   */
  readonly code: string | undefined;
  /** Задалсан JSON body (JSON биш бол текст, жишээ нь nginx-ийн 429 HTML) */
  readonly body: unknown;
  readonly headers: Headers;

  constructor(status: number, body: unknown, headers: Headers) {
    const { detail, code } = extractDetail(body);
    super(`${status}${code ? ` ${code}` : ""}: ${detail ?? "EasyParking API алдаа"}`);
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.body = body;
    this.headers = headers;
  }

  static from(status: number, body: unknown, headers: Headers): APIError {
    const Cls =
      status === 400 ? BadRequestError
      : status === 401 ? AuthenticationError
      : status === 403 ? PermissionDeniedError
      : status === 404 ? NotFoundError
      : status === 409 ? ConflictError
      : status === 422 ? UnprocessableEntityError
      : status === 429 ? RateLimitError
      : status >= 500 ? InternalServerError
      : APIError;
    return new Cls(status, body, headers);
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class UnprocessableEntityError extends APIError {}
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}

/** Сүлжээ тасарсан, DNS, TLS г.м — хариу ирээгүй. */
export class APIConnectionError extends EasyParkingError {}

/** Хүсэлт `timeout`-д багтсангүй. Confirm-ийн үед мөнгө татагдсан эсэх ТОДОРХОЙГҮЙ. */
export class APITimeoutError extends APIConnectionError {}

/** Хэрэглэгчийн `signal`-аар зогсоосон. */
export class APIUserAbortError extends EasyParkingError {}

function extractDetail(body: unknown): { detail?: string; code?: string } {
  if (typeof body === "string") {
    return { detail: body.trim().slice(0, 300) || undefined };
  }
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const detail = pickString(b.detail) ?? pickString(b.Detail);
    const code =
      pickString(b.code) ??
      (b.Success === false ? pickString(b.Message) : undefined) ??
      // "RECEIPT_ALREADY_ISSUED: баримт …" — detail-ийн угтвар код (v1.3)
      (detail ? /^([A-Z][A-Z0-9_]{2,}):\s/.exec(detail)?.[1] : undefined);
    if (detail || code) return { detail: detail ?? code, code };
    // FastAPI-ийн 422: {"detail": [{"loc": ..., "msg": ...}]}
    if (Array.isArray(b.detail)) {
      return { detail: b.detail.map((d) => (d && typeof d === "object" ? (d as { msg?: string }).msg : String(d))).join("; ") };
    }
  }
  return {};
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
