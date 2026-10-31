# @togtokh.dev/easyparking

EasyParking × Wallet партнер API v1.2-ийн Node.js / TypeScript client.
Зогсолт хайх, төлбөр (өртэй нь), e-Barimt, урьдчилсан захиалга, газрын зураг,
машин бүртгэл, webhook — MonPay, SocialPay, EasyWallet, Ард апп-д.

- Runtime dependency **0** — Node 18+ native `fetch`
- ESM + CommonJS, бүрэн TypeScript төрөл
- Специйн давталтын дүрэм (§13) суусан: аюулгүй хүсэлтийг л автоматаар давтана
- `payments.confirmSafely()` — §13.2-ын «confirm-ийн 409/5xx/timeout»-ын логик бэлэн

```bash
npm install @togtokh.dev/easyparking
```

> ⚠️ API түлхүүрийг **зөвхөн backend**-д хадгална (§2). Browser-т client үүсгэвэл
> алдаа заана (`dangerouslyAllowBrowser: true`-ээр л зөвшөөрнө).

## Эхлэх

```ts
import { EasyParking } from "@togtokh.dev/easyparking";

const ep = new EasyParking({
  apiKey: process.env.EASYPARKING_API_KEY, // анхдагчаар энэ env-ээс уншина
  environment: "test",                     // "test" (анхдагч) | "production"
});
```

Орчны хувьсагчаар тохируулах бол [.env.example](.env.example)-ийг `.env` болгон хуулна
(lib өөрөө `.env` уншихгүй — `node --env-file=.env app.js` эсвэл `dotenv` ашиглана):

```bash
EASYPARKING_API_KEY=...          # заавал
EASYPARKING_ENVIRONMENT=test     # test | production
EASYPARKING_BASE_URL=            # сонголттой
```

| Сонголт | Анхдагч | Тайлбар |
|---|---|---|
| `apiKey` | `EASYPARKING_API_KEY` | `X-API-Key` |
| `environment` | `EASYPARKING_ENVIRONMENT` → `"test"` | `test.easy-parking.mn` / `site.easy-parking.mn` |
| `baseURL` | `EASYPARKING_BASE_URL` | Proxy г.м (`…/api/v1` хүртэл) |
| `timeout` | `20000` | мс |
| `maxRetries` | `2` | Зөвхөн давтахад аюулгүй хүсэлтэд |
| `routes` | `"default"` | `"socialpay"` → `/socialpay/*` замууд |
| `fetch` | `globalThis.fetch` | Custom fetch (тест, proxy) |

## Төлбөрийн үндсэн урсгал (§3)

```ts
import { normalizePlate, hasLatinLetters } from "@togtokh.dev/easyparking";

const plate = normalizePlate(userInput);          // "7886 укр" → "7886УКР"
if (hasLatinLetters(plate)) throw new Error("Дугаараа кирилл үсгээр оруулна уу");

// 1. Лавлах — бүх зогсоолоос
const { sessions } = await ep.sessions.list({ plate });
const s = sessions[0];
// s.amount_due — зөвхөн зогсолт; s.debts[] — өмнөх өр (огноотой), тусад нь харуулна

// 2. «Төлөх» дармагц intent
const intent = await ep.payments.create({ session_id: s.session_id, include_debts: true });

// 3. Хэтэвчээс intent.amount-ыг татна (таны тал)
const charged = await wallet.charge(user, intent.amount);
if (!charged.ok) {
  await ep.payments.cancel(intent.payment_id);    // орхигдсон intent БҮРИЙГ цуцална!
  return;
}

// 4. Батлах — 409/5xx/timeout-ийн үед §13.2-ын дагуу GET → давталт
const result = await ep.payments.confirmSafely(intent.payment_id, {
  transaction_id: charged.txId,
  amount: intent.amount,
});

switch (result.outcome) {
  case "PAID":                       // ✅ хаалт нээгдэнэ / exit_deadline хүртэл үнэгүй гарна
    break;
  case "PAID_BY_OTHER_TRANSACTION":  // өөр гүйлгээгээр аль хэдийн төлөгдсөн — энэ мөнгийг тулгаж буцаана
    break;
  case "UNRESOLVED":                 // мөнгийг буцаахаас ӨМНӨ EasyParking-тэй тулгана
    break;
}
```

`confirm()`-ийг шууд дуудаж болно, гэхдээ тэр **хэзээ ч автоматаар давтагдахгүй** —
мөнгө татагдсаны дараах тодорхойгүй байдлыг өөрөө шийдэх ёстой.

### e-Barimt (§7)

Баримтыг **зөвхөн EasyParking** гаргана — wallet өөрөө бүү гарга. Confirm-ийн
хариунд ихэвчлэн `ddtd: null`. `receipt.ready` webhook ирмэгц (эсвэл webhook-гүй бол
2–3с, дараа нь 5–10с тутам) GET хийж QR-ыг **өөрөө хадгална**:

```ts
const p = await ep.payments.retrieve(paymentId);
for (const r of p.ebarimts) {
  if (r.status === "SENT") save(r.receipt_id, { kind: r.kind, debt_id: r.debt_id, ddtd: r.ddtd, lottery: r.lottery, qr: r.qr_data });
}
```

## Урьдчилсан захиалга (§9)

```ts
const a = await ep.reservations.availability({
  site_code: "NOMADS",
  start_time: "2026-10-23T10:00:00+08:00",   // бүсийн тэмдэг ЗААВАЛ (эсвэл Date)
  duration_minutes: 120,
});

const r = await ep.reservations.create({
  site_code: "NOMADS", plate_number: "1234УБА",
  start_time: "2026-10-23T10:00:00+08:00", duration_minutes: 120,
  external_ref: order.id,                    // идемпотент — timeout-ийн дараа аюулгүй давтана
});
// r.amount-ыг татаад hold_expires_at-аас өмнө:
await ep.reservations.confirm(r.reservation_id, { transaction_id: tx.id, amount: r.amount });

await ep.reservations.cancel(r.reservation_id, { reason: "user" });  // refund_amount-ыг ТА буцаана
await ep.reservations.list({ user_id: "100264", status: ["CONFIRMED", "CHECKED_IN"] });
```

Захиалгын алдаа `err.code`-оор ирнэ (`NO_AVAILABILITY`, `HOLD_EXPIRED`, `NO_REFUND_WINDOW` …).

## Газрын зураг, бусад

```ts
await ep.parkings.list();       // 1–5 минут кэшлэ — хэрэглэгч бүрээр бүү тат
await ep.recentExits.list({ minutes: 5 });   // ≥30 секунд тутам
await ep.sites.list();          // доторх хэсгийн site_code тайлах үед л
```

## Машин бүртгэл, bill (§11) — `vehicles` эрх

```ts
const ep = new EasyParking({ apiKey, routes: "socialpay" }); // SocialPay бол; бусад нь "default"

await ep.vehicles.register({ plateNo: "7886УКР", userId: "100264" }); // Message: OK | ALREADY_REGISTERED
const bill = await ep.vehicles.bill({ plateNo: "7886УКР", userId: "100264" });
if (bill.Message === "NO_ACTIVE_SESSION") { /* зогсоолд алга */ }
else if (bill.data!.payableOnline) {
  await ep.payments.create({ session_id: bill.data!.sessionId, include_debts: bill.data!.debtCount > 0 });
}
await ep.vehicles.delete({ plateNo: "7886УКР", userId: "100264" });   // Message: OK | NOT_FOUND
```

## Webhook (§8, §11.5)

HMAC гарын үсэг **байхгүй** — мөнгөний шийдвэрийн өмнө `payments.retrieve()`-ээр
баталгаажуул. Хүсвэл эх IP-г шалга. Event дахин ирж болно (at-least-once).

```ts
import express from "express";
import { parseWebhook, parseVehicleNotification, isEasyParkingIP, VEHICLE_NOTIFICATION_ACK } from "@togtokh.dev/easyparking";

app.post("/easyparking/webhook", express.text({ type: "*/*" }), async (req, res) => {
  if (!isEasyParkingIP(req.ip, "production")) return res.sendStatus(403);
  const { event, idempotencyKey, isTest } = parseWebhook(req.body, req.headers);
  if (isTest) return res.sendStatus(200);                 // payment.paid.test — мөнгөний бүртгэлд бүү оруул
  if (await alreadyProcessed(idempotencyKey)) return res.sendStatus(200);
  await queue.push(event);                                // 10с-д 2xx — дараалалд хийгээд шууд хариул
  res.sendStatus(200);
});

// Орох/гарах мэдэгдэл — 2xx БӨГӨӨД {"Success": true} (5с дотор)
app.post("/parking/notification", express.json(), async (req, res) => {
  const n = parseVehicleNotification(req.body, req.headers);
  // n.type: "vehicle.entry" | "vehicle.exit"; гарсныг plateNo + enteredDate-ээр хосло
  await queue.push(n);
  res.json(VEHICLE_NOTIFICATION_ACK);
});
```

`receipt.ready`-ийн `amount`, `vat_amount` нь **текст** (`"1000.00"`).

## Алдаа

```ts
import { APIError, ConflictError, RateLimitError, APITimeoutError } from "@togtokh.dev/easyparking";

try { … } catch (err) {
  if (err instanceof APIError) {
    err.status;  // 400, 409 …
    err.detail;  // Монгол тайлбар: "Үнэ өөрчлөгдсөн…"
    err.code;    // NO_AVAILABILITY / INVALID_PLATE (захиалга, машин бүртгэл)
    err.body;    // raw (JSON биш бол текст — nginx 429 HTML)
  }
}
```

| Класс | HTTP |
|---|---|
| `BadRequestError` | 400 |
| `AuthenticationError` | 401 |
| `PermissionDeniedError` | 403 |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `UnprocessableEntityError` | 422 |
| `RateLimitError` | 429 |
| `InternalServerError` | 5xx |
| `APIConnectionError` / `APITimeoutError` | хариугүй |

Машин бүртгэлийн `{"Success": false}` хариу мөн `APIError` болж throw хийгдэнэ.

### Автомат давталт (§13.3)

429 / 5xx / сүлжээний алдаанд `Retry-After`-ийг дагаж exponential backoff-оор давтана —
**зөвхөн** давтахад аюулгүй хүсэлтэд:

| Хүсэлт | Автомат давталт |
|---|---|
| Бүх GET | ✅ |
| `payments.create` (ижил PENDING intent буцдаг) | ✅ |
| `payments.cancel`, `reservations.cancel` | ✅ |
| `reservations.create` | ✅ зөвхөн `external_ref`-тэй үед |
| `vehicles.register / delete / bill` | ✅ |
| `payments.confirm`, `reservations.confirm` | ❌ — `confirmSafely()` / эхлээд GET |

## Туслах функцууд

| Функц | |
|---|---|
| `normalizePlate(s)` | Зай/зураас хасаж том үсэг. Латиныг кирилл рүү **хөрвүүлэхгүй** |
| `hasLatinLetters(s)` | Латин үсэгтэй дугаар — сервер таарахгүй |
| `parseTime(s)` | API-ийн 3 цагийн форматыг (бүсгүй = UTC, микросекунд) `Date` болгоно |
| `toZonedISOString(v)` | Захиалгын цаг — бүсгүй бол throw |
| `formatUlaanbaatar(v)` | UTC+8-аар харуулах |
| `isEasyParkingIP(ip, env?)` | PROD `202.21.117.178`, TEST `152.42.235.199` |

## Хөгжүүлэлт

```bash
npm install
npm test
npm run build
```

## License

MIT
