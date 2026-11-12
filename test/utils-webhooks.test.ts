import { describe, expect, it } from "vitest";
import {
  formatUlaanbaatar,
  hasLatinLetters,
  isEasyParkingIP,
  isValidPayerRegNo,
  normalizePlate,
  parseTime,
  parseVehicleNotification,
  parseWebhook,
  toZonedISOString,
  WebhookParseError,
} from "../src/index.js";

describe("plates", () => {
  it("normalizes spaces, dashes, case", () => {
    expect(normalizePlate("7886 укр")).toBe("7886УКР");
    expect(normalizePlate(" 1234-уба ")).toBe("1234УБА");
    expect(normalizePlate("1234өүё")).toBe("1234ӨҮЁ");
  });
  it("detects latin and does not convert it", () => {
    expect(hasLatinLetters("7886UKR")).toBe(true);
    expect(hasLatinLetters("7886УКР")).toBe(false);
    expect(normalizePlate("7886ukr")).toBe("7886UKR");
  });
});

describe("payer reg no", () => {
  it("accepts 7-digit register and 11–14 digit TIN only", () => {
    expect(isValidPayerRegNo("6235971")).toBe(true);
    expect(isValidPayerRegNo("12345678901")).toBe(true);
    expect(isValidPayerRegNo("12345678901234")).toBe(true);
    expect(isValidPayerRegNo("УБ99112233")).toBe(false); // иргэний регистр
    expect(isValidPayerRegNo("123456")).toBe(false);
    expect(isValidPayerRegNo("123456789")).toBe(false);
  });
});

describe("time", () => {
  it("parses all three API formats as UTC", () => {
    const iso = "2026-10-22T04:30:00.123Z";
    expect(parseTime("2026-10-22T04:30:00.123456")!.toISOString()).toBe(iso);
    expect(parseTime("2026-10-22T04:30:00.123456Z")!.toISOString()).toBe(iso);
    expect(parseTime("2026-10-22T04:30:00.123Z")!.toISOString()).toBe(iso);
    expect(parseTime("2026-10-22T04:30:00")!.toISOString()).toBe("2026-10-22T04:30:00.000Z");
    expect(parseTime(null)).toBeNull();
  });
  it("requires zone for reservations", () => {
    expect(toZonedISOString("2026-10-23T10:00:00+08:00")).toBe("2026-10-23T10:00:00+08:00");
    expect(() => toZonedISOString("2026-10-23T10:00:00")).toThrow(TypeError);
  });
  it("formats in Ulaanbaatar time", () => {
    expect(formatUlaanbaatar("2026-10-01T05:31:00")).toBe("01/10, 13:31");
  });
});

describe("webhooks", () => {
  it("parses payment.paid with headers", () => {
    const body = JSON.stringify({ event: "payment.paid", event_id: "e1", payment_id: "p1", amount: 4000 });
    const r = parseWebhook(body, { "X-Parking-Partner": "mobifinance", "X-Parking-Event": "payment.paid" });
    expect(r.event.event).toBe("payment.paid");
    expect(r.idempotencyKey).toBe("e1");
    expect(r.partner).toBe("mobifinance");
    expect(r.isTest).toBe(false);
  });
  it("flags admin test events and drops idempotency key", () => {
    const r = parseWebhook({ event: "payment.paid.test", test: true, payment_id: "p" });
    expect(r.isTest).toBe(true);
    expect(r.idempotencyKey).toBeUndefined();
  });
  it("parses receipt.ready from Buffer", () => {
    const r = parseWebhook(Buffer.from(JSON.stringify({ event: "receipt.ready", event_id: "e2", amount: "1000.00" })));
    expect(r.event.event).toBe("receipt.ready");
  });
  it("rejects garbage", () => {
    expect(() => parseWebhook("not json")).toThrow(WebhookParseError);
    expect(() => parseWebhook({})).toThrow(WebhookParseError);
  });

  it("parses vehicle entry/exit", () => {
    const entry = parseVehicleNotification(
      { data: { plateNo: "7886УКР", enteredDate: "2026-10-22T04:12:48.375Z" } },
      new Headers({ "X-Parking-Event": "vehicle.entry", "Idempotency-Key": "u1" }),
    );
    expect(entry.type).toBe("vehicle.entry");
    expect(entry.idempotencyKey).toBe("u1");

    const exit = parseVehicleNotification({
      data: { plateNo: "7886УКР", enteredDate: "2026-10-22T04:12:48.375Z", exitedDate: "2026-10-22T05:47:50.910Z" },
    });
    expect(exit.type).toBe("vehicle.exit");
    expect(exit.idempotencyKey).toBe("7886УКР|2026-10-22T04:12:48.375Z|vehicle.exit");
  });
  it("flags vehicle test notification", () => {
    const r = parseVehicleNotification(
      { data: { plateNo: "0000ТЕС", enteredDate: "2026-10-22T04:12:48.375Z" } },
      { "idempotency-key": "test-abc" },
    );
    expect(r.isTest).toBe(true);
  });

  it("checks EasyParking IPs", () => {
    expect(isEasyParkingIP("202.21.117.178", "production")).toBe(true);
    expect(isEasyParkingIP("::ffff:152.42.235.199", "test")).toBe(true);
    expect(isEasyParkingIP("152.42.235.199", "production")).toBe(false);
    expect(isEasyParkingIP("1.2.3.4")).toBe(false);
  });
});
