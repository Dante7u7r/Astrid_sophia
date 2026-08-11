import { describe, expect, it, vi } from "vitest";
import { runStartupSequence } from "./startup_sequence";
import type { VisualAuditConfig } from "../testing/visual_audit_config";

function config(enabled: boolean, stage: VisualAuditConfig["stage"] = "static"): VisualAuditConfig {
  return {
    enabled,
    stage,
    step: "full",
    isStep: (candidate) => enabled && candidate === "full",
  };
}

function callbacks() {
  return {
    initOscilloscopeInterface: vi.fn(),
    initCanvasCAD: vi.fn(),
    initFilePersistence: vi.fn(),
    initTabManager: vi.fn(),
    addLog: vi.fn(),
  };
}

describe("runStartupSequence", () => {
  it("inicializa toda la aplicacion fuera de auditoria visual", () => {
    const cb = callbacks();

    runStartupSequence(config(false), cb);

    expect(cb.initOscilloscopeInterface).toHaveBeenCalledOnce();
    expect(cb.initCanvasCAD).toHaveBeenCalledOnce();
    expect(cb.initFilePersistence).toHaveBeenCalledOnce();
    expect(cb.initTabManager).toHaveBeenCalledOnce();
    expect(cb.addLog).not.toHaveBeenCalled();
  });

  it("limita el arranque segun la etapa de auditoria", () => {
    const cb = callbacks();

    runStartupSequence(config(true, "canvas"), cb);

    expect(cb.initOscilloscopeInterface).toHaveBeenCalledOnce();
    expect(cb.initCanvasCAD).toHaveBeenCalledOnce();
    expect(cb.initFilePersistence).not.toHaveBeenCalled();
    expect(cb.initTabManager).not.toHaveBeenCalled();
    expect(cb.addLog).toHaveBeenCalledOnce();
  });
});
