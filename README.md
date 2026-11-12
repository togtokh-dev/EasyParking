# easyparking

Zero-dependency Node.js / TypeScript client for the **EasyParking × Wallet partner API** (Mongolia, spec v1.3) — used by wallet apps such as MonPay, SocialPay, EasyWallet and Ard to look up parking sessions, take payments (with outstanding debts), issue e-Barimt receipts (citizen or organization), make advance reservations, show the parking map, register vehicles, and receive webhooks.

- **0 runtime dependencies** — uses the native `fetch` in Node 18+
- Ships both **ESM and CommonJS** builds with full TypeScript types
- Built-in retry policy: only retry-safe requests are retried automatically
- `payments.confirmSafely()` implements the "confirm returned 409 / 5xx / timeout" reconciliation logic

## Install

```bash
npm install easyparking
```

> ⚠️ Keep your API key on the **backend only**. Constructing the client in a browser throws; pass `dangerouslyAllowBrowser: true` to override intentionally.

## Quick start

TypeScript:

```ts
import { EasyParking } from "easyparking";

const ep = new EasyParking({
  apiKey: process.env.EASYPARKING_API_KEY, // read from this env var by default
  environment: "test",                     // "test" (default) | "production"
});
```

JavaScript (ESM):

```js
import { EasyParking } from "easyparking";

const ep = new EasyParking({ apiKey: "your-api-key", environment: "test" });
```

JavaScript (CommonJS):

```js
const { EasyParking } = require("easyparking");

const ep = new EasyParking({ apiKey: "your-api-key", environment: "test" });
```

The library does not read `.env` itself. Load environment variables with Node's
`node --env-file=.env app.js` or a package like `dotenv`:

```bash
EASYPARKING_API_KEY=your-api-key   # required
EASYPARKING_ENVIRONMENT=test       # test | production (default: test)
EASYPARKING_BASE_URL=              # optional, overrides the environment URL
```

### Client options (`ClientOptions`)

| Option | Default | Description |
|---|---|---|
| `apiKey` | `EASYPARKING_API_KEY` env | Sent as the `X-API-Key` header. Throws if neither is set. |
| `environment` | `EASYPARKING_ENVIRONMENT` env → `"test"` | `test` → `https://test.easy-parking.mn/api/v1`, `production` → `https://site.easy-parking.mn/api/v1` |
| `baseURL` | `EASYPARKING_BASE_URL` env | Override the base URL (e.g. a proxy), up to `…/api/v1` |
| `timeout` | `20000` | Per-request timeout in ms |
| `maxRetries` | `2` | Max retries for retry-safe requests only |
| `routes` | `"default"` | `"socialpay"` routes vehicle/parking calls through `/socialpay/*` (identical responses) |
| `fetch` | `globalThis.fetch` | Custom fetch implementation (tests, proxies) |
| `defaultHeaders` | – | Extra headers sent on every request |
| `dangerouslyAllowBrowser` | `false` | Allow constructing the client in a browser |

The exported `BASE_URLS` record maps each environment to its base URL.

The client exposes these resource groups: `ep.sessions`, `ep.recentExits`,
`ep.payments`, `ep.ebarimt`, `ep.reservations`, `ep.parkings`, `ep.sites`, `ep.vehicles`.
Every method takes an optional final `options` argument
(`{ timeout?, maxRetries?, signal?, headers? }`).

## Sessions & the payment flow

```ts
import { EasyParking, normalizePlate, hasLatinLetters } from "easyparking";

const plate = normalizePlate(userInput);          // "7886 укр" → "7886УКР"
if (hasLatinLetters(plate)) throw new Error("Enter the plate in Cyrillic letters");

// 1. Look up the session across all sites
const { sessions } = await ep.sessions.list({ plate });
const s = sessions[0];
// s.amount_due — this session only; s.debts[] — prior debts, shown separately

// 2. Create a payment intent when the user taps "Pay"
const intent = await ep.payments.create({ session_id: s.session_id, include_debts: true });

// 3. Charge intent.amount from the wallet (your side)
const charged = await wallet.charge(user, intent.amount);
if (!charged.ok) {
  await ep.payments.cancel(intent.payment_id);    // always cancel abandoned intents
  return;
}

// 4. Confirm — handles 409/5xx/timeout by re-reading state, then retrying
const result = await ep.payments.confirmSafely(intent.payment_id, {
  transaction_id: charged.txId,
  amount: intent.amount,
});

switch (result.outcome) {
  case "PAID":                       // barrier opens / free exit until exit_deadline
    break;
  case "PAID_BY_OTHER_TRANSACTION":  // already paid by a different transaction — reconcile and refund
    break;
  case "UNRESOLVED":                 // reconcile with EasyParking before refunding
    break;
}
```

`ep.payments.methods`:

| Method | Notes |
|---|---|
| `create(params)` | Create/return a PENDING payment intent (retry-safe) |
| `confirm(paymentId, params)` | Confirm after charging. **Never retried automatically** |
| `confirmSafely(paymentId, params, options?)` | Confirm + reconciliation; returns `{ outcome: "PAID" \| "PAID_BY_OTHER_TRANSACTION" \| "UNRESOLVED", … }` |
| `cancel(paymentId)` | Cancel an intent known not to be charged (retry-safe) |
| `retrieve(paymentId)` | Fetch payment status and all e-Barimt receipts |
| `setEbarimtPayer(paymentId, { payer_reg_no })` | After payment: switch a not-yet-issued receipt to an organization (v1.3). Not retried automatically |

Call `confirm()` directly if you prefer, but it is **never retried automatically** —
you must resolve the post-charge uncertainty yourself. `confirmSafely()` accepts
`maxAttempts` (default 3) and `retryDelayMs` (default 1500) in addition to the
usual request options.

### e-Barimt receipts

Receipts are issued **only by EasyParking** — never generate them in the wallet.
After a `receipt.ready` webhook (or by polling), fetch and persist the QR data:

```ts
const p = await ep.payments.retrieve(paymentId);
for (const r of p.ebarimts) {
  if (r.status === "SENT") {
    save(r.receipt_id, { kind: r.kind, debt_id: r.debt_id, ddtd: r.ddtd, lottery: r.lottery, qr: r.qr_data });
  }
}
```

### Organization receipts (v1.3)

To issue the receipt in a company's name, pass `payer_reg_no` — a 7-digit company
register number or an 11–14 digit TIN. Omit it (never send an empty or citizen
register) for the default citizen receipt with a lottery number.

```ts
import { isValidPayerRegNo } from "easyparking";

if (!isValidPayerRegNo(regNo)) throw new Error("7-digit register or 11–14 digit TIN"); // avoids a 422

// Optional: show the company name to the user first
const payer = await ep.ebarimt.lookupPayer(regNo);
// payer.available === false → the lookup service is down (NOT "not found") — you may still continue
// payer.found, payer.name, payer.tin, payer.is_vat_payer

// Send it BEFORE confirming — on the intent (recommended) or on confirm
const intent = await ep.payments.create({ session_id, include_debts: true, payer_reg_no: regNo });
// intent.receipt_type === "ORGANIZATION"
```

- All receipts of the payment (parking + each debt) go to the same organization; organization receipts have no lottery number.
- Responses (intent, confirm, `retrieve`, `payment.paid`, `receipt.ready`) carry `receipt_type` (`ORGANIZATION` | `CITIZEN`) and `payer_reg_no`; each `ebarimts[]` row has `receiver_type` (`COMPANY` | `CITIZEN`) and `payer_reg_no`.
- Re-calling `payments.create` on the same unpaid session updates the payer; a repeated confirm does not.
- After payment, `payments.setEbarimtPayer()` works only while the receipt is not yet issued. Once it is `SENT` you get `409` with `err.code === "RECEIPT_ALREADY_ISSUED"` — EasyParking finance must handle it manually.
- `lookupPayer` is rate-limited to 60 requests/minute per key.

## Reservations

```ts
const a = await ep.reservations.availability({
  site_code: "your-site-code",
  start_time: "2026-10-23T10:00:00+08:00",   // timezone offset REQUIRED (or a Date)
  duration_minutes: 120,
});

const r = await ep.reservations.create({
  site_code: "your-site-code",
  plate_number: "1234УБА",
  start_time: "2026-10-23T10:00:00+08:00",
  duration_minutes: 120,
  external_ref: order.id,                     // idempotent — safe to retry after a timeout
});

// Charge r.amount, then confirm before hold_expires_at:
await ep.reservations.confirm(r.reservation_id, { transaction_id: tx.id, amount: r.amount });

await ep.reservations.cancel(r.reservation_id, { reason: "user" });  // you refund refund_amount
await ep.reservations.retrieve(r.reservation_id);
await ep.reservations.list({ user_id: "your-user-id", status: ["CONFIRMED", "CHECKED_IN"] });
```

`availability()` and `create()` convert `start_time` / `end_time` to a
timezone-qualified ISO string via `toZonedISOString()`; a zone offset is required.
`create()` is retried automatically only when `external_ref` is set; `confirm()` is
never retried automatically. Reservation errors surface a machine-readable
`err.code` (`NO_AVAILABILITY`, `HOLD_EXPIRED`, `NO_REFUND_WINDOW`, …).

## Parking map & sites

```ts
await ep.parkings.list();                   // cache for 1–5 min — don't call per user
await ep.recentExits.list({ minutes: 5 });  // cars waiting to pay at the exit; poll ≥ every 30s
await ep.sites.list();                      // resolve inner-area site codes by name
```

## Vehicle registration & bill (requires the `vehicles` scope)

```ts
const ep = new EasyParking({ apiKey: "your-api-key", routes: "socialpay" }); // or "default"

await ep.vehicles.register({ plateNo: "7886УКР", userId: "your-user-id" }); // Message: OK | ALREADY_REGISTERED
const bill = await ep.vehicles.bill({ plateNo: "7886УКР", userId: "your-user-id" });
if (bill.Message === "NO_ACTIVE_SESSION") {
  // not currently parked
} else if (bill.data?.payableOnline) {
  await ep.payments.create({ session_id: bill.data.sessionId, include_debts: bill.data.debtCount > 0 });
}
await ep.vehicles.delete({ plateNo: "7886УКР", userId: "your-user-id" });   // Message: OK | NOT_FOUND
```

Business errors (`{ "Success": false, … }`) are thrown as `APIError`, with the
server's `Message` exposed on `err.code`.

## Webhooks

There is **no HMAC signature** — before acting on money, verify with
`payments.retrieve()`. You can optionally check the source IP. The same event may
arrive more than once (at-least-once delivery).

```ts
import express from "express";
import {
  parseWebhook,
  parseVehicleNotification,
  isEasyParkingIP,
  VEHICLE_NOTIFICATION_ACK,
} from "easyparking";

// Payment / receipt / reservation events
app.post("/easyparking/webhook", express.text({ type: "*/*" }), async (req, res) => {
  if (!isEasyParkingIP(req.ip, "production")) return res.sendStatus(403);
  const { event, idempotencyKey, isTest } = parseWebhook(req.body, req.headers);
  if (isTest) return res.sendStatus(200);                 // payment.paid.test — don't record as money
  if (await alreadyProcessed(idempotencyKey)) return res.sendStatus(200);
  await queue.push(event);                                // respond 2xx within 10s; process async
  res.sendStatus(200);
});

// Vehicle entry/exit notifications — reply 2xx AND {"Success": true} within 5s
app.post("/parking/notification", express.json(), async (req, res) => {
  const n = parseVehicleNotification(req.body, req.headers);
  // n.type: "vehicle.entry" | "vehicle.exit"
  await queue.push(n);
  res.json(VEHICLE_NOTIFICATION_ACK);
});
```

`parseWebhook()` returns `{ event, idempotencyKey, partner, isTest }`;
`parseVehicleNotification()` returns `{ type, data, idempotencyKey, isTest }`.
A malformed body throws `WebhookParseError`. On `receipt.ready` events, `amount`
and `vat_amount` are **strings** (e.g. `"1000.00"`) — convert with `Number()`.
`WEBHOOK_IPS` holds the known source IPs per environment.

## Errors

```ts
import { APIError, ConflictError, RateLimitError, APITimeoutError } from "easyparking";

try {
  // …
} catch (err) {
  if (err instanceof APIError) {
    err.status;  // 400, 409, …
    err.detail;  // human-readable description (Mongolian)
    err.code;    // NO_AVAILABILITY / INVALID_PLATE / RECEIPT_ALREADY_ISSUED (when the API provides one)
    err.body;    // raw body (text when not JSON, e.g. an nginx 429 HTML page)
    err.headers; // response headers
  }
}
```

All errors extend `EasyParkingError`. HTTP responses map to status-specific subclasses:

| Class | HTTP |
|---|---|
| `BadRequestError` | 400 |
| `AuthenticationError` | 401 |
| `PermissionDeniedError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `UnprocessableEntityError` | 422 |
| `RateLimitError` | 429 |
| `InternalServerError` | 5xx |
| `APIConnectionError` / `APITimeoutError` | no response (network / timeout) |
| `APIUserAbortError` | aborted via `options.signal` |

`{ "Success": false }` responses from the vehicle-registration endpoints are also
thrown as `APIError`.

### Automatic retries

On 429 / 5xx / network errors, retry-safe requests are retried with exponential
backoff, honoring `Retry-After`:

| Request | Auto-retried |
|---|---|
| All GET requests | ✅ |
| `payments.create` (returns the same PENDING intent) | ✅ |
| `payments.cancel`, `reservations.cancel` | ✅ |
| `reservations.create` | ✅ only with `external_ref` |
| `vehicles.register / delete / bill` | ✅ |
| `payments.confirm`, `reservations.confirm` | ❌ — use `confirmSafely()` / GET first |
| `payments.setEbarimtPayer` | ❌ — check `retrieve()` first |

## Utility functions

| Function | Description |
|---|---|
| `normalizePlate(s)` | Strip spaces/dashes and uppercase. Does **not** transliterate Latin → Cyrillic |
| `hasLatinLetters(s)` | True if the plate contains Latin letters (won't match the server) |
| `isValidPayerRegNo(s)` | 7-digit company register or 11–14 digit TIN (organization e-Barimt) |
| `parseTime(s)` | Parse the API's time formats (zoneless = UTC, ms/µs fractions) into a `Date` |
| `toZonedISOString(v)` | Reservation times → zoned ISO string; throws if the zone is missing |
| `formatUlaanbaatar(v, opts?)` | Format a time in Ulaanbaatar time (UTC+8) for display |
| `isEasyParkingIP(ip, env?)` | Check a webhook source IP against the known EasyParking IPs |

The `VERSION` constant exports the current client version.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT
