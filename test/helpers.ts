import { EasyParking, type ClientOptions } from "../src/index.js";

export interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/** Хариуг дарааллаар нь буцаадаг fake fetch. */
export function mockClient(replies: Reply[], options: ClientOptions = {}) {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetch = async (input: string, init: RequestInit) => {
    calls.push({
      url: new URL(input),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error("mock: хариу дууслаа");
    if (next instanceof Error) throw next;
    const text = typeof next.body === "string" ? next.body : next.body === undefined ? "" : JSON.stringify(next.body);
    return new Response(text, { status: next.status ?? 200, headers: next.headers });
  };
  const client = new EasyParking({ apiKey: "test-key", fetch, maxRetries: 2, ...options });
  return { client, calls };
}
