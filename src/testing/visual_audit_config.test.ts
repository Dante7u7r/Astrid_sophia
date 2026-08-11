import { describe, expect, it } from "vitest";
import { resolveVisualAuditConfig } from "./visual_audit_config";

const development = { isDevelopment: true, mode: "development" };
const auditBuild = { isDevelopment: false, mode: "audit" };
const production = { isDevelopment: false, mode: "production" };

describe("resolveVisualAuditConfig", () => {
  it("requires audit=1 even in development", () => {
    expect(resolveVisualAuditConfig("", development).enabled).toBe(false);
    expect(resolveVisualAuditConfig("?audit", development).enabled).toBe(false);
  });

  it("accepts known stages and steps in development", () => {
    const config = resolveVisualAuditConfig(
      "?audit=1&auditStage=canvas&auditStep=skip-osc-render",
      development,
    );

    expect(config.enabled).toBe(true);
    expect(config.stage).toBe("canvas");
    expect(config.step).toBe("skip-osc-render");
    expect(config.isStep("skip-osc-render")).toBe(true);
  });

  it("supports the dedicated audit build mode", () => {
    expect(resolveVisualAuditConfig("?audit=1", auditBuild).enabled).toBe(true);
  });

  it("cannot be activated in a production build", () => {
    const config = resolveVisualAuditConfig(
      "?audit=1&auditStage=tabs&auditStep=drop",
      production,
    );

    expect(config.enabled).toBe(false);
    expect(config.isStep("drop")).toBe(false);
  });

  it("falls back safely when stage or step is unknown", () => {
    const config = resolveVisualAuditConfig(
      "?audit=1&auditStage=unknown&auditStep=anything",
      development,
    );

    expect(config.stage).toBe("static");
    expect(config.step).toBe("full");
  });
});
