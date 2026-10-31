import { describe, expect, it, vi } from "vitest";
import {
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  EasyParking,
  RateLimitError,
} from "../src/index.js";
import { mockClient } from "./helpers.js";

describe("client", () => {
  it("requires an api key", () => {
    const prev = process.env.EASYPARKING_API_KEY;
    delete process.env.EASYPARKING_API_KEY;
    expect(() => new EasyParking({ fetch: async () => new Response() })).toThrow(/apiKey/);
    process.env.EASYPARKING_API_KEY = prev;
  });

  it("defaults to TEST and sends X-API-Key", async () => {
    const { client, calls } = mockClient([{ body: { sessions: [] } }]);
    expect(client.baseURL).toBe("https://test.easy-parking.mn/api/v1");
    await client.sessions.list({ plate: "1234УБА" });
    expect(calls[0]!.headers["X-API-Key"]).toBe("test-key");
    expect(calls[0]!.url.pathname).toBe("/api/v1/sessions");
    expect(calls[0]!.url.searchParams.get("plate")).toBe("1234УБА");
    expect(calls[0]!.url.search).toContain("%D0%A3"); // UTF-8 URL-encode
  });

  it("reads environment and baseURL from env", () => {
    const fetch = async () => new Response();
    process.env.EASYPARKING_ENVIRONMENT = "production";
    expect(new EasyParking({ apiKey: "k", fetch }).baseURL).toBe("https://site.easy-parking.mn/api/v1");
    process.env.EASYPARKING_BASE_URL = "https://proxy.local/api/v1";
    expect(new EasyParking({ apiKey: "k", fetch }).baseURL).toBe("https://proxy.local/api/v1");
    process.env.EASYPARKING_ENVIRONMENT = "";
    process.env.EASYPARKING_BASE_URL = "";
    expect(new EasyParking({ apiKey: "k", fetch }).environment).toBe("test");
    process.env.EASYPARKING_ENVIRONMENT = "prod";
    expect(() => new EasyParking({ apiKey: "k", fetch })).toThrow(/test" эсвэл "production/);
    delete process.env.EASYPARKING_ENVIRONMENT;
    delete process.env.EASYPARKING_BASE_URL;
  });

  it("uses production base URL", () => {
    const { client } = mockClient([], { environment: "production" });
    expect(client.baseURL).toBe("https://site.easy-parking.mn/api/v1");
  });
});

describe("errors", () => {
  it("maps payment API {detail}", async () => {
    const { client } = mockClient([{ status: 400, body: { detail: "Дүн зөрүүтэй: систем 2000.0₮ хүлээж байна" } }]);
    const err = await client.payments.confirm("p1", { transaction_id: "t", amount: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.status).toBe(400);
    expect(err.detail).toMatch(/Дүн зөрүүтэй/);
    expect(err.code).toBeUndefined();
  });

  it("maps reservation {detail, code}", async () => {
    const { client } = mockClient([{ status: 409, body: { detail: "Сул байр алга", code: "NO_AVAILABILITY" } }]);
    const err = await client.reservations
      .create({ site_code: "NOMADS", plate_number: "1234УБА", start_time: "2026-10-23T10:00:00+08:00", duration_minutes: 60 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe("NO_AVAILABILITY");
  });

  it("maps vehicles envelope and treats Success:false as error", async () => {
    const { client } = mockClient([
      { status: 400, body: { Success: false, Message: "INVALID_PLATE", Detail: "Дугаарын формат буруу" } },
    ]);
    const err = await client.vehicles.register({ plateNo: "7886UKR", userId: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.code).toBe("INVALID_PLATE");
    expect(err.detail).toBe("Дугаарын формат буруу");
  });

  it("handles HTML 429 from nginx and retries GETs", async () => {
    vi.useFakeTimers();
    const { client, calls } = mockClient([
      { status: 429, body: "<html>429 Too Many Requests</html>", headers: { "retry-after": "1" } },
      { body: { sessions: [] } },
    ]);
    const p = client.sessions.list({ plate: "1234УБА" });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ sessions: [] });
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it("surfaces non-JSON 429 body after retries", async () => {
    const { client } = mockClient([{ status: 429, body: "<html>slow down</html>" }], { maxRetries: 0 });
    const err = await client.sessions.list({ plate: "1234УБА" }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.body).toContain("slow down");
  });

  it("does not retry 401", async () => {
    const { client, calls } = mockClient([{ status: 401, body: { detail: "API түлхүүр буруу" } }]);
    await expect(client.parkings.list()).rejects.toBeInstanceOf(AuthenticationError);
    expect(calls).toHaveLength(1);
  });

  it("never auto-retries payment confirm", async () => {
    const { client, calls } = mockClient([{ status: 503, body: { detail: "x" } }]);
    await expect(client.payments.confirm("p1", { transaction_id: "t", amount: 1 })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("times out", async () => {
    const fetch = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    const client = new EasyParking({ apiKey: "k", fetch, timeout: 10, maxRetries: 0 });
    await expect(client.sessions.list({ plate: "1234УБА" })).rejects.toBeInstanceOf(APITimeoutError);
  });
});

describe("routes", () => {
  it("socialpay variant uses /socialpay/*", async () => {
    const { client, calls } = mockClient(
      [{ body: { Success: true, Message: "OK" } }, { body: { Success: true, Message: "OK", data: [], sampledAt: "x" } }],
      { routes: "socialpay" },
    );
    await client.vehicles.register({ plateNo: "7886УКР", userId: "100264" });
    await client.parkings.list();
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/v1/socialpay/register", "/api/v1/socialpay/parkings"]);
  });

  it("bill returns NO_ACTIVE_SESSION as success", async () => {
    const { client } = mockClient([{ body: { Success: true, Message: "NO_ACTIVE_SESSION", data: null } }]);
    const res = await client.vehicles.bill({ plateNo: "7886УКР", userId: "100264" });
    expect(res.Message).toBe("NO_ACTIVE_SESSION");
    expect(res.data).toBeNull();
  });
});

describe("payments", () => {
  it("create / cancel bodies", async () => {
    const { client, calls } = mockClient([
      { body: { payment_id: "p1", amount: 4000 } },
      { body: { payment_id: "p1", status: "CANCELLED" } },
    ]);
    await client.payments.create({ session_id: "s1", include_debts: true });
    await client.payments.cancel("p1");
    expect(calls[0]!.body).toEqual({ session_id: "s1", include_debts: true });
    expect(calls[1]!.url.pathname).toBe("/api/v1/payments/p1/cancel");
    expect(calls[1]!.body).toEqual({ outcome: "NOT_CHARGED" });
  });
});

describe("reservations", () => {
  it("rejects naive start_time locally", async () => {
    const { client, calls } = mockClient([]);
    await expect(
      client.reservations.create({ site_code: "NOMADS", plate_number: "1234УБА", start_time: "2026-10-23T10:00:00" }),
    ).rejects.toThrow(/бүсийн тэмдэг/);
    expect(calls).toHaveLength(0);
  });

  it("serializes Date and status arrays", async () => {
    const { client, calls } = mockClient([{ body: {} }, { body: { reservations: [] } }]);
    await client.reservations.availability({
      site_code: "NOMADS",
      start_time: new Date("2026-10-23T02:00:00Z"),
      duration_minutes: 120,
    });
    await client.reservations.list({ status: ["CONFIRMED", "CHECKED_IN"] });
    expect(calls[0]!.url.searchParams.get("start_time")).toBe("2026-10-23T02:00:00.000Z");
    expect(calls[1]!.url.searchParams.get("status")).toBe("CONFIRMED,CHECKED_IN");
  });

  it("retries create only when external_ref is set", async () => {
    const r = { reservation_id: "r1" };
    const a = mockClient([{ status: 502, body: "bad gateway" }, { body: r }]);
    vi.useFakeTimers();
    const p = a.client.reservations.create({
      site_code: "NOMADS", plate_number: "1234УБА", start_time: "2026-10-23T02:00:00Z", duration_minutes: 60, external_ref: "X1",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual(r);
    vi.useRealTimers();

    const b = mockClient([{ status: 502, body: "bad gateway" }]);
    await expect(
      b.client.reservations.create({ site_code: "NOMADS", plate_number: "1234УБА", start_time: "2026-10-23T02:00:00Z", duration_minutes: 60 }),
    ).rejects.toThrow();
    expect(b.calls).toHaveLength(1);
  });
});
