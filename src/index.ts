export { EasyParking, BASE_URLS, type ClientOptions } from "./client.js";
export type { RequestOptions, Fetch } from "./core.js";
export * from "./errors.js";
export type * from "./types.js";
export type { ConfirmSafelyResult, ConfirmSafelyOptions } from "./resources/payments.js";
export type { RouteVariant } from "./resources/misc.js";
export { normalizePlate, hasLatinLetters, isValidPayerRegNo, parseTime, toZonedISOString, formatUlaanbaatar } from "./utils.js";
export {
  parseWebhook,
  parseVehicleNotification,
  isEasyParkingIP,
  VEHICLE_NOTIFICATION_ACK,
  WEBHOOK_IPS,
  WebhookParseError,
  type Environment,
  type WebhookEvent,
  type PaymentPaidEvent,
  type PaymentPaidTestEvent,
  type ReceiptReadyEvent,
  type ReservationEvent,
  type ReservationEventType,
  type ParsedWebhook,
  type ParsedVehicleNotification,
  type VehicleNotificationData,
} from "./webhooks.js";
export { VERSION } from "./version.js";
