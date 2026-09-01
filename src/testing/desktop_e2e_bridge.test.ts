import { describe, expect, it } from "vitest";
import { isDesktopE2eBridgeEnabled } from "./desktop_e2e_bridge";

describe("isDesktopE2eBridgeEnabled", () => {
  it.each([
    [{ isDevelopment: true, mode: "development" }, true],
    [{ isDevelopment: false, mode: "audit" }, true],
    [{ isDevelopment: false, mode: "wdio" }, true],
    [{ isDevelopment: false, mode: "production" }, false],
    [{ isDevelopment: false, mode: "test" }, false],
  ] as const)("resuelve %o como %s", (runtime, expected) => {
    expect(isDesktopE2eBridgeEnabled(runtime)).toBe(expected);
  });

  it("no recibe ni confía en parámetros de URL para habilitar producción", () => {
    const hostileQuery = "?audit=1&e2e=1";

    expect(hostileQuery).toContain("e2e=1");
    expect(isDesktopE2eBridgeEnabled({ isDevelopment: false, mode: "production" })).toBe(false);
  });
});
