// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendDiagnosticToDiscord,
  dataUrlToBlob,
  DEFAULT_DISCORD_WEBHOOK_URL,
} from "./discord_webhook_dispatcher";
import type { DiagnosticBundle } from "./diagnostic_collector";

describe("discord_webhook_dispatcher", () => {
  const sampleBundle: DiagnosticBundle = {
    format: "biaani-diagnostic-bundle",
    schemaVersion: 1,
    createdAt: "2026-08-26T18:00:00.000Z",
    category: "simulation",
    userNote: "Error en convergencia",
    contact: "tester@biaani.org",
    environment: {
      appVersion: "0.1.0",
      os: "Windows",
      userAgent: "TestAgent",
      screenResolution: "1920x1080",
      devicePixelRatio: 1,
      timestamp: "2026-08-26T18:00:00.000Z",
    },
    circuit: {
      componentCount: 5,
      wireCount: 4,
      rawFileJson: "{}",
    },
    simulation: {
      activeMode: "TRAN",
      settings: { dt: 0.001, tolerance: 1e-5, maxIterations: 100, transientDuration: 0.01 },
      isSimulating: false,
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("convierte data URL base64 a Blob correctamente", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const blob = dataUrlToBlob(dataUrl);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBeGreaterThan(0);
  });

  it("retorna null para data URLs inválidas", () => {
    expect(dataUrlToBlob("invalid-data-url")).toBeNull();
  });

  it("envía reporte exitoso a Discord Webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiagnosticToDiscord(sampleBundle);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      DEFAULT_DISCORD_WEBHOOK_URL,
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      }),
    );
  });

  it("maneja fallo de red activando fallback local", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiagnosticToDiscord(sampleBundle);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Fallo de conexión");
  });

  it("maneja respuesta de error HTTP desde Discord", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue("Bad Request"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiagnosticToDiscord(sampleBundle);
    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
  });

  it("adjunta capturas y archivos de referencia externos en reportes de comparativa", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    const bundleWithAttachment: DiagnosticBundle = {
      ...sampleBundle,
      category: "comparison",
      userNote: "Comparando respuesta con LTspice XVII",
      externalAttachment: {
        name: "ltspice_benchmark.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    };

    const result = await sendDiagnosticToDiscord(bundleWithAttachment);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });
});
