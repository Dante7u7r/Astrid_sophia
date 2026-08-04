import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function fixtureBundle(): Record<string, unknown> {
  const events = [
    {
      schemaVersion: 1,
      eventId: "event-0001",
      occurredAtUnixMs: 1,
      sessionId: "session-0001",
      runId: "run-0001",
      appVersion: "0.1.0",
      privacyClass: "operational",
      kind: "simulation.failed",
      payload: { analysis: "DC", durationMs: 4, errorCode: "NO_CONVERGENCE", recoverable: true },
    },
    {
      schemaVersion: 1,
      eventId: "event-0002",
      occurredAtUnixMs: 2,
      sessionId: "session-0001",
      runId: "run-0002",
      appVersion: "0.2.0",
      privacyClass: "operational",
      kind: "simulation.completed",
      payload: { analysis: "DC", durationMs: 2, pointCount: 1, converged: true },
    },
  ];
  const summaryMarkdown = "# Diagnóstico de Astryd Sophia\n";
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify({ events, summaryMarkdown }), "utf8")
    .digest("hex");
  return {
    manifest: {
      format: "astryd-feedback-support",
      formatVersion: 2,
      eventSchemaVersion: 1,
      exportedAtUnixMs: 3,
      eventCount: events.length,
      truncated: false,
      contentSha256,
      schemaValidation: "validated-on-ingest",
      redactions: { eventIds: 2, sessionIds: 1, runIds: 2, workspaceIds: 0, fingerprints: 0 },
    },
    summaryMarkdown,
    events,
  };
}

describe("puente MCP local de solo lectura", () => {
  it("expone únicamente recursos y herramientas de lectura, audita y termina al cerrar stdin", () => {
    const directory = mkdtempSync(join(tmpdir(), "astryd-mcp-"));
    const bundlePath = join(directory, "support.json");
    const original = JSON.stringify(fixtureBundle());
    writeFileSync(bundlePath, original, "utf8");
    try {
      const requests = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "resources/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_failures", arguments: { limit: 10 } } },
        { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "compare_versions", arguments: {} } },
        { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "delete_all", arguments: {} } },
      ];
      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/astryd_feedback_mcp.mjs"), "--bundle", bundlePath],
        { input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`, encoding: "utf8", timeout: 5_000 },
      );
      expect(result.status).toBe(0);
      const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(responses[0].result.protocolVersion).toBe("2025-11-25");
      const tools = responses.find((response) => response.id === 3).result.tools;
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
        "list_failures",
        "compare_versions",
        "get_event",
      ]);
      expect(tools.every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint)).toBe(true);
      expect(responses.find((response) => response.id === 4).result.structuredContent.result).toHaveLength(1);
      expect(responses.find((response) => response.id === 5).result.structuredContent.result).toHaveLength(2);
      expect(responses.find((response) => response.id === 6).error.code).toBe(-32602);
      expect(result.stderr).toContain('"method":"tools/call"');
      expect(readFileSync(bundlePath, "utf8")).toBe(original);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rechaza paquetes alterados antes de abrir el protocolo", () => {
    const directory = mkdtempSync(join(tmpdir(), "astryd-mcp-invalid-"));
    const bundlePath = join(directory, "support.json");
    const fixture = fixtureBundle();
    (fixture.manifest as { contentSha256: string }).contentSha256 = "0".repeat(64);
    writeFileSync(bundlePath, JSON.stringify(fixture), "utf8");
    try {
      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/astryd_feedback_mcp.mjs"), "--bundle", bundlePath],
        { encoding: "utf8", timeout: 5_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("verificación SHA-256");
      expect(result.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
