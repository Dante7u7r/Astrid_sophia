// ==========================================================================
// CRASH REPORTER — Interceptor Global de Errores Críticos y Modal de Emergencia
// ==========================================================================

import {
  collectDiagnosticBundle,
  type DiagnosticBundle,
  type DiagnosticCollectorDeps,
} from "../feedback/diagnostic_collector";
import {
  saveDiagnosticLocally,
  sendDiagnosticToDiscord,
} from "../feedback/discord_webhook_dispatcher";
import { TelemetryPanel } from "../ui/telemetry_panel";

export interface CrashReporterOptions {
  readonly deps: DiagnosticCollectorDeps;
  readonly onCrashObserved?: (error: Error | unknown) => void;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export class CrashReporter {
  private static instance: CrashReporter | null = null;
  private isHandlingCrash = false;
  private backdropElement: HTMLElement | null = null;

  public static install(options: CrashReporterOptions): CrashReporter {
    if (CrashReporter.instance) {
      return CrashReporter.instance;
    }
    const reporter = new CrashReporter(options);
    reporter.bindGlobalListeners();
    CrashReporter.instance = reporter;
    return reporter;
  }

  public static getInstance(): CrashReporter | null {
    return CrashReporter.instance;
  }

  constructor(private readonly options: CrashReporterOptions) {}

  public bindGlobalListeners(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("error", (event: ErrorEvent) => {
      this.handleCrash(event.error || new Error(event.message || "Error no especificado"));
    });

    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const error = reason instanceof Error ? reason : new Error(String(reason || "Promesa rechazada no controlada"));
      this.handleCrash(error);
    });
  }

  public handleCrash(error: Error | unknown): void {
    if (this.isHandlingCrash) return;
    this.isHandlingCrash = true;

    try {
      this.options.onCrashObserved?.(error);
    } catch {
      // Ignorar errores en callback de observación
    }

    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message || "Error crítico desconocido";
    const stack = err.stack || "Sin trazado de pila disponible";

    // 1. Salvaguarda de emergencia en localStorage
    this.performEmergencyAutosave();

    // 2. Construir el paquete de diagnóstico de emergencia
    const bundle = collectDiagnosticBundle(this.options.deps, {
      category: "simulation",
      userNote: `[CRASH AUTOMÁTICO] ${message}`,
      errorDetails: {
        message,
        stack,
        area: "uncaught_global_exception",
        occurredAt: new Date().toISOString(),
      },
    });

    // 3. Renderizar el modal de emergencia
    this.showCrashModal(bundle, message, stack);
  }

  private performEmergencyAutosave(): void {
    try {
      const doc = this.options.deps.getCircuitDocumentController?.()?.serializeCircuit();
      if (doc && typeof localStorage !== "undefined") {
        localStorage.setItem("biaani-emergency-autosave.json", doc);
        localStorage.setItem("biaani-emergency-autosave-timestamp", new Date().toISOString());
      }
    } catch {
      // Fallback silencioso si falla el guardado
    }
  }

  private showCrashModal(bundle: DiagnosticBundle, message: string, stack: string): void {
    if (typeof document === "undefined") return;

    // Remover modal previo si existe
    if (this.backdropElement?.parentElement) {
      this.backdropElement.parentElement.removeChild(this.backdropElement);
    }

    let container = document.getElementById("crash-modal-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "crash-modal-container";
      document.body.appendChild(container);
    }

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop crash-modal-backdrop";
    backdrop.setAttribute("role", "alertdialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "crash-modal-title");

    backdrop.innerHTML = `
      <div class="crash-dialog">
        <div class="crash-header">
          <div class="crash-header-icon">🔴</div>
          <div>
            <h2 id="crash-modal-title" class="crash-title">Error Crítico Inesperado</h2>
            <p class="crash-subtitle">Biaani ha encontrado un problema grave. Hemos resguardado una copia de tu circuito en el almacenamiento local.</p>
          </div>
        </div>

        <div class="crash-body">
          <div class="crash-message-box">
            <strong>Mensaje de error:</strong>
            <p class="crash-error-text">${escapeHtml(message)}</p>
          </div>

          <details class="crash-stack-details">
            <summary class="crash-stack-summary">Ver trazado de pila completo (Stack Trace)</summary>
            <pre class="crash-stack-pre">${escapeHtml(stack)}</pre>
          </details>

          <div class="crash-info-tip">
            💡 Puedes enviar este reporte a los desarrolladores con un solo clic para que podamos corregirlo en la próxima versión.
          </div>
        </div>

        <div class="crash-footer">
          <div class="crash-footer-left">
            <span id="crash-status-msg" class="crash-status-idle" role="status" aria-live="polite">Listo para reportar.</span>
          </div>
          <div class="crash-footer-right">
            <button class="btn-crash-secondary" id="btn-crash-save-local" type="button">
              <span>💾 Descargar Diagnóstico</span>
            </button>
            <button class="btn-crash-dismiss" id="btn-crash-dismiss-action" type="button">
              <span>Continuar de todos modos</span>
            </button>
            <button class="btn-crash-reload" id="btn-crash-reload-app" type="button">
              <span>🔄 Recargar App</span>
            </button>
            <button class="btn-crash-primary" id="btn-crash-send-report" type="button">
              <span>🚀 Enviar Reporte de Fallo</span>
            </button>
          </div>
        </div>
      </div>
    `;

    container.appendChild(backdrop);
    this.backdropElement = backdrop;

    const saveLocalBtn = backdrop.querySelector<HTMLButtonElement>("#btn-crash-save-local");
    const dismissBtn = backdrop.querySelector<HTMLButtonElement>("#btn-crash-dismiss-action");
    const reloadBtn = backdrop.querySelector<HTMLButtonElement>("#btn-crash-reload-app");
    const sendBtn = backdrop.querySelector<HTMLButtonElement>("#btn-crash-send-report");
    const statusMsg = backdrop.querySelector<HTMLElement>("#crash-status-msg");

    saveLocalBtn?.addEventListener("click", () => {
      saveDiagnosticLocally(bundle, "biaani_crash_diagnostico.json");
      if (statusMsg) {
        statusMsg.textContent = "✓ Archivo de diagnóstico guardado en tus descargas.";
      }
    });

    dismissBtn?.addEventListener("click", () => {
      this.closeModal();
    });

    reloadBtn?.addEventListener("click", () => {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    });

    sendBtn?.addEventListener("click", async () => {
      if (sendBtn) sendBtn.disabled = true;
      if (statusMsg) {
        statusMsg.textContent = "⏳ Transmitiendo reporte de fallo a los desarrolladores...";
      }

      try {
        const result = await sendDiagnosticToDiscord(bundle);
        if (result.success) {
          if (statusMsg) {
            statusMsg.textContent = "✓ ¡Reporte de fallo enviado con éxito! Muchas gracias.";
          }
          setTimeout(() => {
            this.closeModal();
          }, 2000);
        } else {
          if (statusMsg) {
            statusMsg.textContent = result.fallbackSaved
              ? "No se pudo conectar a Discord. Se guardó el diagnóstico en tu equipo."
              : `Error: ${result.error || "No se pudo transmitir"}`;
          }
          if (sendBtn) sendBtn.disabled = false;
        }
      } catch (err) {
        if (statusMsg) {
          statusMsg.textContent = `Error: ${String(err)}`;
        }
        if (sendBtn) sendBtn.disabled = false;
      }
    });
  }

  public closeModal(): void {
    if (this.backdropElement?.parentElement) {
      this.backdropElement.parentElement.removeChild(this.backdropElement);
      this.backdropElement = null;
    }
    this.isHandlingCrash = false;
  }

  public static checkAndPromptEmergencyRecovery(
    documentController: { deserializeCircuit(json: string): boolean },
    callbacks: {
      onRestored?: () => void;
      onDismissed?: () => void;
    } = {},
  ): boolean {
    if (typeof localStorage === "undefined") return false;
    const savedJson = localStorage.getItem("biaani-emergency-autosave.json");
    const timestamp = localStorage.getItem("biaani-emergency-autosave-timestamp");
    if (!savedJson) return false;

    let timeLabel = "";
    if (timestamp) {
      try {
        timeLabel = ` (${new Date(timestamp).toLocaleTimeString()})`;
      } catch {
        // ignore
      }
    }

    TelemetryPanel.showToast(
      `Se detectó una copia de seguridad tras un cierre inesperado${timeLabel}.`,
      "warning",
      {
        title: "Recuperación de Emergencia",
        durationMs: 0,
        actions: [
          {
            label: "Restaurar Circuito",
            primary: true,
            onClick: () => {
              const success = documentController.deserializeCircuit(savedJson);
              localStorage.removeItem("biaani-emergency-autosave.json");
              localStorage.removeItem("biaani-emergency-autosave-timestamp");
              if (success) {
                TelemetryPanel.showToast("Circuito restaurado exitosamente.", "success");
                callbacks.onRestored?.();
              } else {
                TelemetryPanel.showToast("No se pudo restaurar el circuito recuperado.", "error");
              }
            },
          },
          {
            label: "Descartar",
            onClick: () => {
              localStorage.removeItem("biaani-emergency-autosave.json");
              localStorage.removeItem("biaani-emergency-autosave-timestamp");
              callbacks.onDismissed?.();
            },
          },
        ],
      },
    );
    return true;
  }
}
