import type { RequestOptions } from "../core.js";
import type {
  Availability,
  AvailabilityParams,
  Reservation,
  ReservationCancelParams,
  ReservationConfirmParams,
  ReservationCreateParams,
  ReservationListParams,
  ReservationListResponse,
} from "../types.js";
import { toZonedISOString } from "../utils.js";
import { enc } from "./payments.js";
import { APIResource } from "./resource.js";

export class Reservations extends APIResource {
  /** Сул байр ба үнэ (§9.3). Байр барихгүй. */
  async availability(params: AvailabilityParams, options?: RequestOptions): Promise<Availability> {
    return this._get(
      "/reservations/availability",
      {
        site_code: params.site_code,
        start_time: toZonedISOString(params.start_time),
        duration_minutes: params.duration_minutes,
        end_time: params.end_time === undefined ? undefined : toZonedISOString(params.end_time),
      },
      options,
    );
  }

  /**
   * Захиалга үүсгэх (§9.4) — байрыг hold_minutes (≈10 мин) барина.
   * `external_ref` өгсөн бол давтахад ижил захиалга буцдаг тул автоматаар
   * давтана (transaction_id-тай нэг алхмын урсгалд ч); өгөөгүй бол давтахгүй.
   */
  async create(params: ReservationCreateParams, options?: RequestOptions): Promise<Reservation> {
    const body = {
      ...params,
      start_time: toZonedISOString(params.start_time),
      end_time: params.end_time === undefined ? undefined : toZonedISOString(params.end_time),
    };
    const idempotent = Boolean(params.external_ref);
    return this._post("/reservations", body, { ...options, idempotent });
  }

  /**
   * Мөнгө татмагц батлах (§9.5). Автоматаар давтахгүй — timeout бол
   * `retrieve()`-ээр шалгаад ИЖИЛ transaction_id + amount-аар давтана.
   */
  confirm(reservationId: string, params: ReservationConfirmParams, options?: RequestOptions): Promise<Reservation> {
    return this._post(`/reservations/${enc(reservationId)}/confirm`, params, { ...options, idempotent: false });
  }

  /** Цуцлах (§9.7). Буцаалтын мөнгийг ТА хэрэглэгчид буцаана (refund_amount). */
  cancel(reservationId: string, params: ReservationCancelParams = {}, options?: RequestOptions): Promise<Reservation> {
    return this._post(`/reservations/${enc(reservationId)}/cancel`, params, { ...options, idempotent: true });
  }

  retrieve(reservationId: string, options?: RequestOptions): Promise<Reservation> {
    return this._get(`/reservations/${enc(reservationId)}`, undefined, options);
  }

  /** Зөвхөн таны түлхүүрийн захиалгууд, шинээс хуучин (≤200). */
  list(params: ReservationListParams = {}, options?: RequestOptions): Promise<ReservationListResponse> {
    const { status, ...rest } = params;
    return this._get(
      "/reservations",
      { ...rest, status: Array.isArray(status) ? status.join(",") : status },
      options,
    );
  }
}
