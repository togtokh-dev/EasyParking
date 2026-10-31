import { sleep, type RequestOptions } from "../core.js";
import {
  APIConnectionError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  type EasyParkingError,
} from "../errors.js";
import type {
  Payment,
  PaymentCancelResponse,
  PaymentConfirmParams,
  PaymentConfirmResponse,
  PaymentCreateParams,
  PaymentIntent,
} from "../types.js";
import { APIResource } from "./resource.js";

/** 409 «Өмнөх баталгаажуулалтын дугаар эсвэл дүн зөрлөө» — өөр гүйлгээгээр төлөгдсөн (§13.2) */
const OTHER_TRANSACTION_DETAIL = "дүн зөрлөө";

export type ConfirmSafelyResult =
  /** Энэ гүйлгээгээр батлагдсан — хаалт/баримт хэвийн */
  | { outcome: "PAID"; confirmation: PaymentConfirmResponse; payment?: Payment }
  /**
   * Төлбөр ӨӨР transaction_id-аар аль хэдийн PAID — энэ гүйлгээний мөнгө
   * илүү. EasyParking-тэй тулгаж буцаана.
   */
  | { outcome: "PAID_BY_OTHER_TRANSACTION"; payment: Payment; error: ConflictError }
  /**
   * Хэдэн оролдлогоор ч батлагдсангүй. Мөнгийг буцаахаас ӨМНӨ payment_id,
   * transaction_id-тай EasyParking-тэй тулгана (§13.2).
   */
  | { outcome: "UNRESOLVED"; payment?: Payment; error: EasyParkingError };

export interface ConfirmSafelyOptions extends RequestOptions {
  /** Confirm-ийн нийт оролдлого (анхдагч 3) */
  maxAttempts?: number;
  /** Оролдлого хоорондын хүлээлт (анхдагч 1500мс, спец: 1–2с) */
  retryDelayMs?: number;
}

export class Payments extends APIResource {
  /**
   * Intent үүсгэнэ (§4.2). Хэрэглэгч «Төлөх» дарсан мөчид, мөнгө татахаас ӨМНӨ.
   * PENDING intent байвал ижлийг нь буцаадаг тул timeout-ийн дараа давтахад аюулгүй.
   */
  create(params: PaymentCreateParams, options?: RequestOptions): Promise<PaymentIntent> {
    return this._post("/payments", params, { ...options, idempotent: true });
  }

  /**
   * Төлбөр батлах (§4.3) — хаалт нээгдэнэ. Мөнгө татмагц (10 мин дотор).
   *
   * АВТОМАТААР ДАВТАХГҮЙ. 409/5xx/timeout бол `confirmSafely()` эсвэл §13.2-ын
   * дагуу эхлээд `retrieve()`.
   */
  confirm(paymentId: string, params: PaymentConfirmParams, options?: RequestOptions): Promise<PaymentConfirmResponse> {
    return this._post(`/payments/${enc(paymentId)}/confirm`, params, { ...options, idempotent: false });
  }

  /**
   * Мөнгө татагдаагүй нь ТОДОРХОЙ үед intent-ийг цуцална (§4.4). Орхигдсон
   * intent БҮРД заавал — эс бөгөөс гарц дээрх QR, кассын төлбөр хаагдана.
   * Мөнгө татагдсан эсэх тодорхойгүй (timeout) бол бүү дууд.
   */
  cancel(paymentId: string, options?: RequestOptions): Promise<PaymentCancelResponse> {
    return this._post(`/payments/${enc(paymentId)}/cancel`, { outcome: "NOT_CHARGED" }, { ...options, idempotent: true });
  }

  /** Төлөв + бүх e-Barimt (QR-тай) (§4.5). */
  retrieve(paymentId: string, options?: RequestOptions): Promise<Payment> {
    return this._get(`/payments/${enc(paymentId)}`, undefined, options);
  }

  /**
   * §13.2-ын дүрмийг хэрэгжүүлсэн confirm. Мөнгө ТАТСАНЫ дараа дуудна.
   *
   * 1. confirm → 200 бол PAID.
   * 2. 409 / 5xx / 429 / timeout / сүлжээ → GET /payments/{id}:
   *    - PAID → ижил body-оор confirm-ийг нэг удаа давтана: 200 → манай гүйлгээ;
   *      409 «…дүн зөрлөө» → өөр гүйлгээгээр төлөгдсөн (PAID_BY_OTHER_TRANSACTION).
   *    - PENDING / CANCELLED → хүлээгээд ИЖИЛ transaction_id + amount-аар давтана.
   * 3. Бусад алдаа (400 «Дүн зөрүүтэй», 401, 422 …) шууд throw.
   *
   * Хэзээ ч мөнгө буцаахыг өөрөө шийдэхгүй — `UNRESOLVED` бол EasyParking-тэй тулгана.
   */
  async confirmSafely(
    paymentId: string,
    params: PaymentConfirmParams,
    options: ConfirmSafelyOptions = {},
  ): Promise<ConfirmSafelyResult> {
    const { maxAttempts = 3, retryDelayMs = 1500, ...reqOptions } = options;
    let lastError: EasyParkingError | undefined;
    let lastPayment: Payment | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(retryDelayMs, reqOptions.signal);
      try {
        return { outcome: "PAID", confirmation: await this.confirm(paymentId, params, reqOptions) };
      } catch (err) {
        if (!isUncertain(err)) throw err;
        lastError = err;
      }

      try {
        lastPayment = await this.retrieve(paymentId, reqOptions);
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof PermissionDeniedError) throw err;
        if (!isUncertain(err)) throw err;
        lastError = err;
        continue;
      }

      if (lastPayment.status === "PAID") {
        try {
          const confirmation = await this.confirm(paymentId, params, reqOptions);
          return { outcome: "PAID", confirmation, payment: lastPayment };
        } catch (err) {
          if (err instanceof ConflictError && err.detail?.includes(OTHER_TRANSACTION_DETAIL)) {
            return { outcome: "PAID_BY_OTHER_TRANSACTION", payment: lastPayment, error: err };
          }
          if (!isUncertain(err)) throw err;
          lastError = err;
        }
      }
    }
    return { outcome: "UNRESOLVED", payment: lastPayment, error: lastError! };
  }
}

function isUncertain(err: unknown): err is EasyParkingError {
  return (
    err instanceof ConflictError ||
    err instanceof InternalServerError ||
    err instanceof RateLimitError ||
    err instanceof APIConnectionError
  );
}

export function enc(id: string): string {
  return encodeURIComponent(id);
}
