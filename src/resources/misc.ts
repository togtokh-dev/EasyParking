import type { RequestOptions } from "../core.js";
import type {
  BillResponse,
  ParkingListResponse,
  RecentExitsParams,
  RecentExitsResponse,
  SessionListParams,
  SessionListResponse,
  SiteListResponse,
  VehicleDeleteResponse,
  VehicleParams,
  VehicleRegisterResponse,
} from "../types.js";
import { APIResource } from "./resource.js";

export class Sessions extends APIResource {
  /** Дугаараар зогсолт хайх, бүх зогсоолоос (§4.1). Олдохгүй бол `sessions: []`. */
  list(params: SessionListParams, options?: RequestOptions): Promise<SessionListResponse> {
    return this._get("/sessions", { plate: params.plate, site_code: params.site_code }, options);
  }
}

export class RecentExits extends APIResource {
  /** Гарц дээр төлбөр хүлээж буй машинууд (§4.6). 30 секундээс олон давтамжтай бүү дууд. */
  list(params: RecentExitsParams = {}, options?: RequestOptions): Promise<RecentExitsResponse> {
    return this._get("/recent-exits", { ...params }, options);
  }
}

export type RouteVariant = "default" | "socialpay";

export class Parkings extends APIResource {
  constructor(config: ConstructorParameters<typeof APIResource>[0], private readonly _variant: RouteVariant) {
    super(config);
  }

  /** Зогсоолын байршил, багтаамж, захиалга (§10). 1–5 минут кэшлэнэ. */
  list(options?: RequestOptions): Promise<ParkingListResponse> {
    const path = this._variant === "socialpay" ? "/socialpay/parkings" : "/parkings";
    return this._get(path, undefined, { ...options, envelope: true });
  }
}

export class Sites extends APIResource {
  /** Доторх хэсгийн site_code-ийг нэрээр нь тайлах үед л (§10). Газрын зурагт `parkings`. */
  list(options?: RequestOptions): Promise<SiteListResponse> {
    return this._get("/sites", undefined, options);
  }
}

/**
 * Машин бүртгэл, bill (§11). `vehicles` эрх шаардлагатай.
 * `/vehicles/*` ба `/socialpay/*` нь ЯГ ИЖИЛ — client-ийн `routes` тохиргоогоор сонгоно.
 * Бизнесийн алдаа (`Success: false`) нь `APIError` болж throw; `code` = Message.
 */
export class Vehicles extends APIResource {
  constructor(config: ConstructorParameters<typeof APIResource>[0], private readonly _variant: RouteVariant) {
    super(config);
  }

  private path(action: string): string {
    return `/${this._variant === "socialpay" ? "socialpay" : "vehicles"}/${action}`;
  }

  /** Идемпотент — давтан бол Message: "ALREADY_REGISTERED". */
  register(params: VehicleParams, options?: RequestOptions): Promise<VehicleRegisterResponse> {
    return this._post(this.path("register"), params, { ...options, idempotent: true, envelope: true });
  }

  /** Идемпотент — бүртгэлгүй бол Message: "NOT_FOUND" (алдаа биш). */
  delete(params: VehicleParams, options?: RequestOptions): Promise<VehicleDeleteResponse> {
    return this._post(this.path("delete"), params, { ...options, idempotent: true, envelope: true });
  }

  /** Одоогийн зогсолт, үнэгүй хугацаа, төлөх дүн, өр. Зогсоолд байхгүй бол data: null. */
  bill(params: VehicleParams, options?: RequestOptions): Promise<BillResponse> {
    return this._post(this.path("bill"), params, { ...options, idempotent: true, envelope: true });
  }
}
