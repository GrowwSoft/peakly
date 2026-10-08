import type { AscAuth } from "../platform";

const API = "https://api.appstoreconnect.apple.com";

export class AscError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "AscError";
  }
}

interface Page<T> {
  data: T[];
  included?: unknown[];
  links?: { next?: string | null };
}

export interface AscResource<A> {
  id: string;
  type: string;
  attributes: A;
}

async function toError(res: Response): Promise<AscError> {
  let code = `HTTP_${res.status}`;
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { errors?: { code?: string; title?: string; detail?: string }[] };
    const first = body.errors?.[0];
    if (first?.code) code = first.code;
    detail = first?.detail ?? first?.title ?? detail;
  } catch { /* non-JSON error body */ }
  return new AscError(res.status, code, detail);
}

/**
 * Read-only App Store Connect client. Every request is a GET to api.appstoreconnect.apple.com;
 * the bearer token is never sent anywhere else (report segment downloads are pre-signed URLs).
 */
export function createAscClient(auth: AscAuth, fetchImpl: typeof fetch = fetch) {
  async function get(pathOrUrl: string, accept = "application/json"): Promise<Response> {
    const url = new URL(pathOrUrl, API);
    if (url.origin !== API) throw new Error("Refusing to send App Store Connect credentials to another host.");
    return fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${await auth.token()}`, Accept: accept },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  }

  async function json<T>(path: string): Promise<T> {
    const res = await get(path);
    if (!res.ok) throw await toError(res);
    return (await res.json()) as T;
  }

  async function all<T>(path: string, maxPages = 50): Promise<T[]> {
    const items: T[] = [];
    let next: string | null | undefined = path;
    for (let page = 0; next && page < maxPages; page++) {
      const body: Page<T> = await json<Page<T>>(next);
      items.push(...body.data);
      next = body.links?.next;
    }
    return items;
  }

  /**
   * A Sales and Trends report file for one day. Apple answers 404 for "not published yet",
   * "no sales that day" and other cases (such as reports past retention); only its detail
   * text tells which, so anything unrecognized is "unavailable" (unknown), never read as zero.
   */
  async function salesReportFile(spec: { reportType: string; reportSubType: string; version: string; frequency?: string }, date: string): Promise<{ status: "available"; gz: Uint8Array } | { status: "pending" | "no_sales" | "unavailable" }> {
    const q = new URLSearchParams({
      "filter[frequency]": spec.frequency ?? "DAILY", "filter[reportType]": spec.reportType, "filter[reportSubType]": spec.reportSubType,
      "filter[vendorNumber]": auth.vendorNumber, "filter[reportDate]": date, "filter[version]": spec.version,
    });
    const res = await get(`/v1/salesReports?${q}`, "application/a-gzip, application/json");
    if (res.ok) return { status: "available", gz: new Uint8Array(await res.arrayBuffer()) };
    const error = await toError(res);
    if (res.status === 404) return { status: /not available yet/i.test(error.message) ? "pending" : /no sales|no data|no records/i.test(error.message) ? "no_sales" : "unavailable" };
    throw error;
  }

  /** Daily SALES/SUMMARY report. */
  const salesReport = (date: string) => salesReportFile({ reportType: "SALES", reportSubType: "SUMMARY", version: "1_0" }, date);

  async function download(url: string): Promise<Uint8Array> {
    if (new URL(url).protocol !== "https:") throw new Error("Report segment URL must be https.");
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
    if (!res.ok) throw new AscError(res.status, `HTTP_${res.status}`, "Report segment download failed.");
    return new Uint8Array(await res.arrayBuffer());
  }

  return { json, all, salesReport, salesReportFile, download };
}

export type AscClient = ReturnType<typeof createAscClient>;
