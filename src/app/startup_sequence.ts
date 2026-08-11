import type { VisualAuditConfig } from "../testing/visual_audit_config";

export interface StartupSequenceCallbacks {
  initOscilloscopeInterface(): void;
  initCanvasCAD(): void;
  initFilePersistence(): void;
  initTabManager(): void;
  addLog(text: string, type: "system"): void;
}

export function runStartupSequence(
  visualAudit: VisualAuditConfig,
  callbacks: StartupSequenceCallbacks,
): void {
  if (!visualAudit.enabled) {
    callbacks.initOscilloscopeInterface();
    callbacks.initCanvasCAD();
    callbacks.initFilePersistence();
    callbacks.initTabManager();
    return;
  }

  if (visualAudit.stage === "oscilloscope") {
    callbacks.initOscilloscopeInterface();
  }
  if (visualAudit.stage === "canvas") {
    callbacks.initOscilloscopeInterface();
    callbacks.initCanvasCAD();
  }
  if (visualAudit.stage === "tabs") {
    callbacks.initOscilloscopeInterface();
    callbacks.initCanvasCAD();
    callbacks.initFilePersistence();
    callbacks.initTabManager();
  }

  callbacks.addLog(
    `Modo auditoría visual activo (etapa: ${visualAudit.stage}, paso: ${visualAudit.step}).`,
    "system",
  );
}
