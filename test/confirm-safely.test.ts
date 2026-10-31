import { describe, expect, it } from "vitest";
import { BadRequestError } from "../src/index.js";
import { mockClient } from "./helpers.js";

const params = { transaction_id: "MP-1", amount: 4000 };
const opts = { retryDelayMs: 0 };
const paid = { payment_id: "p1", status: "PAID" };
const pending = { payment_id: "p1", status: "PENDING" };

describe("payments.confirmSafely (§13.2)", () => {
  it("returns PAID on first success", async () => {
    const { client, calls } = mockClient([{ body: paid }]);
    const r = await client.payments.confirmSafely("p1", params, opts);
    expect(r.outcome).toBe("PAID");
    expect(calls).toHaveLength(1);
  });

  it("timeout → GET PAID → re-confirm 200 → PAID (ours)", async () => {
    const { client, calls } = mockClient([new TypeError("socket hang up"), { body: paid }, { body: paid }]);
    const r = await client.payments.confirmSafely("p1", params, opts);
    expect(r.outcome).toBe("PAID");
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /api/v1/payments/p1/confirm",
      "GET /api/v1/payments/p1",
      "POST /api/v1/payments/p1/confirm",
    ]);
    expect(calls[2]!.body).toEqual(params);
  });

  it("409 → GET PAID → 409 mismatch → PAID_BY_OTHER_TRANSACTION", async () => {
    const { client } = mockClient([
      { status: 409, body: { detail: "Төлбөр боловсруулагдаж байна. Дахин шалгана уу." } },
      { body: paid },
      { status: 409, body: { detail: "Өмнөх баталгаажуулалтын дугаар эсвэл дүн зөрлөө" } },
    ]);
    const r = await client.payments.confirmSafely("p1", params, opts);
    expect(r.outcome).toBe("PAID_BY_OTHER_TRANSACTION");
  });

  it("5xx → GET PENDING → retry confirm with same body → PAID", async () => {
    const { client, calls } = mockClient([{ status: 500, body: { detail: "x" } }, { body: pending }, { body: paid }]);
    const r = await client.payments.confirmSafely("p1", params, opts);
    expect(r.outcome).toBe("PAID");
    expect(calls[2]!.body).toEqual(params);
  });

  it("gives up as UNRESOLVED (never decides refunds itself)", async () => {
    const { client } = mockClient([
      { status: 503, body: "x" }, { body: pending },
      { status: 503, body: "x" }, { body: pending },
    ]);
    const r = await client.payments.confirmSafely("p1", params, { ...opts, maxAttempts: 2 });
    expect(r.outcome).toBe("UNRESOLVED");
    if (r.outcome === "UNRESOLVED") expect(r.payment?.status).toBe("PENDING");
  });

  it("throws definite errors (400 amount mismatch) without GET", async () => {
    const { client, calls } = mockClient([{ status: 400, body: { detail: "Дүн зөрүүтэй" } }]);
    await expect(client.payments.confirmSafely("p1", params, opts)).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(1);
  });
});
