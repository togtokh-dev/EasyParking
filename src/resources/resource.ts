import { request, type CoreConfig, type FinalRequest, type RequestOptions } from "../core.js";

type Query = FinalRequest["query"];
type Extra = RequestOptions & { idempotent: boolean; envelope?: boolean };

export abstract class APIResource {
  constructor(protected readonly _config: CoreConfig) {}

  protected _get<T>(path: string, query?: Query, options?: RequestOptions & { envelope?: boolean }): Promise<T> {
    return request<T>(this._config, { ...options, method: "GET", path, query, idempotent: true });
  }

  protected _post<T>(path: string, body: unknown, options: Extra): Promise<T> {
    return request<T>(this._config, { ...options, method: "POST", path, body });
  }
}
