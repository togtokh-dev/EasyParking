import type { CoreConfig, Fetch } from "./core.js";
import { EasyParkingError } from "./errors.js";
import { Parkings, RecentExits, Sessions, Sites, Vehicles, type RouteVariant } from "./resources/misc.js";
import { Payments } from "./resources/payments.js";
import { Reservations } from "./resources/reservations.js";
import { VERSION } from "./version.js";
import type { Environment } from "./webhooks.js";

export const BASE_URLS: Record<Environment, string> = {
  test: "https://test.easy-parking.mn/api/v1",
  production: "https://site.easy-parking.mn/api/v1",
};

export interface ClientOptions {
  /** X-API-Key. Анхдагч: `process.env.EASYPARKING_API_KEY` */
  apiKey?: string;
  /** Анхдагч "test". Түлхүүр орчин бүрд тусдаа. */
  environment?: Environment;
  /** `environment`-ийг дарж бичнэ (жишээ нь proxy). `/api/v1` хүртэл. */
  baseURL?: string;
  /** мс, анхдагч 20000 */
  timeout?: number;
  /** Давтахад аюулгүй хүсэлтийн давталт (429/5xx/сүлжээ), анхдагч 2 */
  maxRetries?: number;
  /**
   * Машин бүртгэл, /parkings-ийн зам: "default" → /vehicles/*, /parkings;
   * "socialpay" → /socialpay/* (SocialPay-ийн spec). Хариу ЯГ ИЖИЛ.
   */
  routes?: RouteVariant;
  fetch?: Fetch;
  defaultHeaders?: Record<string, string>;
  /**
   * Түлхүүрийг зөвхөн backend-д хадгална (§2). Browser-т ажиллуулахыг
   * санаатайгаар зөвшөөрөх бол л true.
   */
  dangerouslyAllowBrowser?: boolean;
}

export class EasyParking {
  readonly environment: Environment;
  readonly baseURL: string;

  readonly parkings: Parkings;
  readonly sites: Sites;
  readonly sessions: Sessions;
  readonly recentExits: RecentExits;
  readonly payments: Payments;
  readonly reservations: Reservations;
  readonly vehicles: Vehicles;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("EASYPARKING_API_KEY");
    if (!apiKey) {
      throw new EasyParkingError("apiKey шаардлагатай (эсвэл EASYPARKING_API_KEY орчны хувьсагч)");
    }
    if (!options.dangerouslyAllowBrowser && isBrowser()) {
      throw new EasyParkingError(
        "EasyParking API түлхүүрийг browser/мобайл-д бүү оруул — бүх дуудлагыг backend-ээс хийнэ (§2). " +
          "Санаатай бол dangerouslyAllowBrowser: true.",
      );
    }
    const fetchFn = options.fetch ?? (globalThis.fetch?.bind(globalThis) as Fetch | undefined);
    if (!fetchFn) throw new EasyParkingError("fetch олдсонгүй — Node 18+ эсвэл `fetch` сонголт өгнө үү");

    this.environment = options.environment ?? "test";
    this.baseURL = options.baseURL ?? BASE_URLS[this.environment];

    const config: CoreConfig = {
      apiKey,
      baseURL: this.baseURL,
      timeout: options.timeout ?? 20_000,
      maxRetries: options.maxRetries ?? 2,
      fetch: fetchFn,
      userAgent: `easyparking-node/${VERSION}`,
      defaultHeaders: options.defaultHeaders,
    };
    const routes = options.routes ?? "default";

    this.parkings = new Parkings(config, routes);
    this.sites = new Sites(config);
    this.sessions = new Sessions(config);
    this.recentExits = new RecentExits(config);
    this.payments = new Payments(config);
    this.reservations = new Reservations(config);
    this.vehicles = new Vehicles(config, routes);
  }
}

function readEnv(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof (window as { document?: unknown }).document !== "undefined";
}
