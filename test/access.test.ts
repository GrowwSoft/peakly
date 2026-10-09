import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { assertCanAccessPrivateData } from "@/lib/server/access";
import { forgetApps, getApps, getReadiness } from "@/lib/server/apps";
import { loadReportTableAction } from "@/app/tables/actions";
import { checkAppStoreConnect, removeAppStoreConnect, saveVendorNumber } from "@/app/settings/actions";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), load: vi.fn(), remove: vi.fn(), list: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/server/connections", () => ({
  connectionStatus: () => ({ appStoreConnect: { configured: true, keyId: "test", savedAt: "now" } }),
  loadAscCredentials: mocks.load, removeAscCredentials: mocks.remove,
  saveAscCredentials: vi.fn(), setVendorNumber: vi.fn(),
}));
vi.mock("@/lib/server/platform", () => ({ nodePlatform: {}, authFromCredentials: () => ({}) }));
vi.mock("@/core/dataset", () => ({ listApps: mocks.list }));

const authorized = `Basic ${btoa("test:password")}`;
const request = (authorization?: string) => new NextRequest("http://localhost/settings", {
  headers: authorization ? { authorization } : {},
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("GI_BASIC_AUTH", "test:password");
  vi.stubEnv("GI_ENCRYPTION_KEY", "test-configured-key");
  vi.clearAllMocks();
  forgetApps();
  mocks.headers.mockResolvedValue(new Headers({ host: "localhost:3001", authorization: authorized }));
});
afterEach(() => vi.unstubAllEnvs());

describe("private web access", () => {
  it.each(["GI_BASIC_AUTH", "GI_ENCRYPTION_KEY"])("fails closed without %s, even with a local Host and valid password", async (name) => {
    vi.stubEnv(name, "");
    expect(proxy(request(authorized)).status).toBe(503);
    await expect(assertCanAccessPrivateData()).rejects.toThrow("before accessing a production");
  });

  it.each([undefined, "Basic !!!", "Bearer token", `Basic ${btoa("test:wrong")}`])("rejects invalid authorization %s at both entry points", async (authorization) => {
    mocks.headers.mockResolvedValue(new Headers({ host: "localhost:3001", ...(authorization ? { authorization } : {}) }));
    const response = proxy(request(authorization));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
    await expect(assertCanAccessPrivateData()).rejects.toThrow("Not authorized");
  });

  it("allows an authenticated request with production configuration", async () => {
    expect(proxy(request(authorized)).status).toBe(200);
    await expect(assertCanAccessPrivateData()).resolves.toBeUndefined();
  });

  it("keeps unauthenticated development scoped to the loopback host", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GI_BASIC_AUTH", "");
    for (const host of ["localhost:3001", "127.0.0.1:3001", "[::1]:3001"]) {
      mocks.headers.mockResolvedValue(new Headers({ host }));
      await expect(assertCanAccessPrivateData()).resolves.toBeUndefined();
    }
    for (const host of ["attacker.example", "anything.localhost", "invalid host"]) {
      mocks.headers.mockResolvedValue(new Headers({ host }));
      await expect(assertCanAccessPrivateData()).rejects.toThrow("non-local host");
    }
  });

  it("does not return cached account data to a subsequent unauthorized request", async () => {
    mocks.load.mockReturnValue({});
    mocks.list.mockResolvedValue([{ id: "private-app" }]);
    await expect(getApps()).resolves.toMatchObject({ mode: "live" });
    mocks.headers.mockResolvedValue(new Headers({ host: "localhost" }));
    await expect(getApps()).rejects.toThrow("Not authorized");
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("denies readiness and direct Server Functions before reading or modifying credentials", async () => {
    mocks.headers.mockResolvedValue(new Headers({ host: "localhost" }));
    await expect(getReadiness()).rejects.toThrow("Not authorized");
    await expect(loadReportTableAction(null, 30, "anything")).rejects.toThrow("Not authorized");
    await expect(checkAppStoreConnect()).rejects.toThrow("Not authorized");
    await expect(removeAppStoreConnect()).rejects.toThrow("Not authorized");
    await expect(saveVendorNumber({ ok: false, message: "" }, new FormData())).resolves.toMatchObject({ ok: false, message: "Not authorized." });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
