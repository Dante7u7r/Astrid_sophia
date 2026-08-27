// ==========================================================================
// FEEDBACK MODAL — Diálogo Glassmorphic de Diagnóstico y Telemetría en 1 Clic
// ==========================================================================

import {
  collectDiagnosticBundle,
  type DiagnosticBundle,
  type DiagnosticCollectorDeps,
  type DiagnosticExternalAttachment,
  type DiagnosticInclusions,
} from "../feedback/diagnostic_collector";
import {
  saveDiagnosticLocally,
  sendDiagnosticToDiscord,
} from "../feedback/discord_webhook_dispatcher";

export interface FeedbackModalOptions {
  readonly deps: DiagnosticCollectorDeps;
  readonly initialCategory?: string;
  readonly initialNote?: string;
  readonly onDismiss?: () => void;
  readonly onSuccess?: () => void;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export class FeedbackModal {
  private static currentInstance: FeedbackModal | null = null;
  private backdropElement: HTMLElement | null = null;
  private isSubmitting = false;
  private attachedFile: DiagnosticExternalAttachment | undefined = undefined;

  public static show(options: FeedbackModalOptions): FeedbackModal {
    if (FeedbackModal.currentInstance) {
      FeedbackModal.currentInstance.close();
    }
    const modal = new FeedbackModal(options);
    modal.render();
    FeedbackModal.currentInstance = modal;
    return modal;
  }

  public static closeCurrent(): void {
    if (FeedbackModal.currentInstance) {
      FeedbackModal.currentInstance.close();
      FeedbackModal.currentInstance = null;
    }
  }

  constructor(private readonly options: FeedbackModalOptions) {}

  private getSelectedInclusions(backdrop: HTMLElement): DiagnosticInclusions {
    return {
      includeCircuitFile: backdrop.querySelector<HTMLInputElement>("#chk-include-circuit")?.checked ?? true,
      includeSpiceNetlist: backdrop.querySelector<HTMLInputElement>("#chk-include-netlist")?.checked ?? true,
      includeScreenshot: backdrop.querySelector<HTMLInputElement>("#chk-include-screenshot")?.checked ?? true,
      includeLogs: backdrop.querySelector<HTMLInputElement>("#chk-include-logs")?.checked ?? true,
      includeEnvironment: backdrop.querySelector<HTMLInputElement>("#chk-include-env")?.checked ?? true,
    };
  }

  private generateBundle(backdrop: HTMLElement): DiagnosticBundle {
    const category = backdrop.querySelector<HTMLSelectElement>("#feedback-category")?.value ?? "simulation";
    const userNote = backdrop.querySelector<HTMLTextAreaElement>("#feedback-note")?.value ?? "";
    const contact = backdrop.querySelector<HTMLInputElement>("#feedback-contact")?.value.trim() ?? "";
    const inclusions = this.getSelectedInclusions(backdrop);

    return collectDiagnosticBundle(this.options.deps, {
      category,
      userNote,
      contact: contact || undefined,
      inclusions,
      externalAttachment: this.attachedFile,
    });
  }

  public render(): void {
    let container = document.getElementById("feedback-modal-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "feedback-modal-container";
      document.body.appendChild(container);
    }
    container.replaceChildren();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop feedback-modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "feedback-modal-title");

    const initialCat = this.options.initialCategory || "simulation";

    backdrop.innerHTML = `
      <div class="feedback-dialog">
        <div class="feedback-header">
          <div class="feedback-header-left">
            <span class="feedback-header-icon">💬</span>
            <div>
              <h2 id="feedback-modal-title" class="feedback-title">Reportar Problema o Enviar Feedback</h2>
              <p class="feedback-subtitle">Tu reporte incluirá los datos técnicos necesarios para reproducir y resolver el fallo en desarrollo.</p>
            </div>
          </div>
          <button class="feedback-close-btn" id="btn-feedback-close" type="button" aria-label="Cerrar ventana de feedback">✕</button>
        </div>

        <div class="feedback-body">
          <form id="feedback-form" onsubmit="return false;">
            <div class="feedback-form-group">
              <label for="feedback-category" class="feedback-label">Tipo de reporte:</label>
              <select id="feedback-category" class="feedback-select">
                <option value="comparison" ${initialCat === "comparison" ? "selected" : ""}>📊 Comparativa con otro Simulador (LTspice, Proteus, etc.)</option>
                <option value="simulation" ${initialCat === "simulation" ? "selected" : ""}>⚙️ Error en Simulación / Solver</option>
                <option value="canvas" ${initialCat === "canvas" ? "selected" : ""}>🎨 Fallo Visual en Canvas o Instrumentos</option>
                <option value="feature" ${initialCat === "feature" ? "selected" : ""}>💡 Sugerencia o Nueva Función</option>
                <option value="other" ${initialCat === "other" ? "selected" : ""}>💬 Otro Asunto</option>
              </select>
            </div>

            <div class="feedback-form-group">
              <label for="feedback-note" class="feedback-label">Descripción del problema o comparativa:</label>
              <textarea id="feedback-note" class="feedback-textarea" rows="4" placeholder="¿Qué circuito probaste? ¿Qué resultado dio el otro simulador y qué viste en Biaani?">${this.options.initialNote ? escapeHtml(this.options.initialNote) : ""}</textarea>
            </div>

            <div class="feedback-form-group">
              <label class="feedback-label">Adjuntar captura o archivo de referencia (opcional):</label>
              <div class="feedback-file-upload-zone" id="feedback-upload-zone">
                <input type="file" id="feedback-external-file" class="feedback-file-input" accept="image/png,image/jpeg,image/webp,.cir,.asc,.sp,.txt" style="display: none;" />
                <button type="button" class="btn-feedback-file-picker" id="btn-feedback-pick-file">
                  <span>📎 Seleccionar archivo / captura</span>
                </button>
                <span id="feedback-selected-filename" class="feedback-selected-filename">Ningún archivo adjunto</span>
                <button type="button" class="feedback-clear-file-btn" id="btn-feedback-clear-file" style="display: none;" title="Quitar archivo adjunto">✕</button>
              </div>
            </div>

            <div class="feedback-form-group">
              <label for="feedback-contact" class="feedback-label">Contacto (opcional):</label>
              <input type="text" id="feedback-contact" class="feedback-input" placeholder="Tu correo o usuario de Discord (para notificarte de la solución)" />
            </div>

            <div class="feedback-checklist-section">
              <div class="checklist-title">Datos técnicos que se adjuntarán:</div>
              <div class="feedback-checkbox-grid">
                <label class="feedback-check-label">
                  <input type="checkbox" id="chk-include-circuit" checked />
                  <span>Esquemático actual (.biaani)</span>
                </label>
                <label class="feedback-check-label">
                  <input type="checkbox" id="chk-include-netlist" checked />
                  <span>Netlist SPICE generada</span>
                </label>
                <label class="feedback-check-label">
                  <input type="checkbox" id="chk-include-screenshot" checked />
                  <span>Captura de pantalla del circuito</span>
                </label>
                <label class="feedback-check-label">
                  <input type="checkbox" id="chk-include-logs" checked />
                  <span>Registros de consola y solver</span>
                </label>
                <label class="feedback-check-label">
                  <input type="checkbox" id="chk-include-env" checked />
                  <span>Información de SO y versión</span>
                </label>
              </div>
            </div>

            <details class="feedback-preview-accordion" id="feedback-preview-details">
              <summary class="preview-summary">🔍 Inspeccionar contenido del paquete de diagnóstico</summary>
              <pre class="preview-json-box" id="feedback-json-preview">Cargando previsualización...</pre>
            </details>
          </form>
        </div>

        <div class="feedback-footer">
          <div class="feedback-footer-left">
            <span id="feedback-status-msg" class="feedback-status-idle" role="status" aria-live="polite">Listo para enviar.</span>
          </div>
          <div class="feedback-footer-right">
            <button class="btn-feedback-secondary" id="btn-feedback-save-local" type="button" title="Guarda el archivo .json en tu equipo sin enviarlo por internet">
              <span>💾 Guardar .json</span>
            </button>
            <button class="btn-feedback-cancel" id="btn-feedback-cancel-action" type="button">
              <span>Cancelar</span>
            </button>
            <button class="btn-feedback-primary" id="btn-feedback-submit" type="button">
              <span>🚀 Enviar Reporte</span>
            </button>
          </div>
        </div>
      </div>
    `;

    container.appendChild(backdrop);
    this.backdropElement = backdrop;

    // Elements
    const categorySelect = backdrop.querySelector<HTMLSelectElement>("#feedback-category");
    if (categorySelect) {
      categorySelect.value = initialCat;
    }
    const closeBtn = backdrop.querySelector<HTMLButtonElement>("#btn-feedback-close");
    const cancelBtn = backdrop.querySelector<HTMLButtonElement>("#btn-feedback-cancel-action");
    const saveLocalBtn = backdrop.querySelector<HTMLButtonElement>("#btn-feedback-save-local");
    const submitBtn = backdrop.querySelector<HTMLButtonElement>("#btn-feedback-submit");
    const statusMsg = backdrop.querySelector<HTMLElement>("#feedback-status-msg");
    const previewDetails = backdrop.querySelector<HTMLDetailsElement>("#feedback-preview-details");
    const jsonPreviewBox = backdrop.querySelector<HTMLElement>("#feedback-json-preview");

    // External file upload elements
    const fileInput = backdrop.querySelector<HTMLInputElement>("#feedback-external-file");
    const pickFileBtn = backdrop.querySelector<HTMLButtonElement>("#btn-feedback-pick-file");
    const fileNameSpan = backdrop.querySelector<HTMLElement>("#feedback-selected-filename");
    const clearFileBtn = backdrop.querySelector<HTMLButtonElement>("#btn-feedback-clear-file");

    pickFileBtn?.addEventListener("click", () => {
      fileInput?.click();
    });

    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      if (file.size > 8 * 1024 * 1024) {
        if (statusMsg) {
          statusMsg.className = "feedback-status-error";
          statusMsg.textContent = "El archivo excede el tamaño máximo de 8 MB.";
        }
        fileInput.value = "";
        return;
      }

      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();

      reader.onload = () => {
        if (isImage) {
          this.attachedFile = {
            name: file.name,
            mimeType: file.type || "image/png",
            sizeBytes: file.size,
            dataUrl: reader.result as string,
          };
        } else {
          this.attachedFile = {
            name: file.name,
            mimeType: file.type || "text/plain",
            sizeBytes: file.size,
            textContent: typeof reader.result === "string" ? reader.result : undefined,
          };
        }

        if (fileNameSpan) {
          fileNameSpan.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
          fileNameSpan.classList.add("has-file");
        }
        if (clearFileBtn) {
          clearFileBtn.style.display = "inline-block";
        }
        updatePreview();
      };

      if (isImage) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });

    clearFileBtn?.addEventListener("click", () => {
      this.attachedFile = undefined;
      if (fileInput) fileInput.value = "";
      if (fileNameSpan) {
        fileNameSpan.textContent = "Ningún archivo adjunto";
        fileNameSpan.classList.remove("has-file");
      }
      if (clearFileBtn) {
        clearFileBtn.style.display = "none";
      }
      updatePreview();
    });

    const updatePreview = () => {
      if (previewDetails?.open && jsonPreviewBox) {
        const bundle = this.generateBundle(backdrop);
        const cleanForDisplay = {
          ...bundle,
          screenshotBase64: bundle.screenshotBase64 ? "[PNG Imagen Base64]" : undefined,
          externalAttachment: bundle.externalAttachment?.dataUrl
            ? { ...bundle.externalAttachment, dataUrl: "[Adjunto Base64]" }
            : bundle.externalAttachment,
        };
        jsonPreviewBox.textContent = JSON.stringify(cleanForDisplay, null, 2);
      }
    };

    previewDetails?.addEventListener("toggle", updatePreview);
    backdrop.querySelectorAll("input, select, textarea").forEach((el) => {
      el.addEventListener("change", updatePreview);
    });

    const handleClose = () => {
      this.close();
      if (this.options.onDismiss) this.options.onDismiss();
    };

    closeBtn?.addEventListener("click", handleClose);
    cancelBtn?.addEventListener("click", handleClose);

    saveLocalBtn?.addEventListener("click", () => {
      const bundle = this.generateBundle(backdrop);
      const saved = saveDiagnosticLocally(bundle);
      if (saved) {
        if (statusMsg) {
          statusMsg.className = "feedback-status-success";
          statusMsg.textContent = "✓ Archivo de diagnóstico guardado localmente.";
        }
      } else if (statusMsg) {
        statusMsg.className = "feedback-status-error";
        statusMsg.textContent = "No se pudo guardar el archivo local.";
      }
    });

    submitBtn?.addEventListener("click", async () => {
      if (this.isSubmitting) return;
      this.isSubmitting = true;
      if (submitBtn) submitBtn.disabled = true;
      if (statusMsg) {
        statusMsg.className = "feedback-status-busy";
        statusMsg.textContent = "⏳ Enviando reporte a los desarrolladores...";
      }

      try {
        const bundle = this.generateBundle(backdrop);
        const result = await sendDiagnosticToDiscord(bundle);

        if (result.success) {
          if (statusMsg) {
            statusMsg.className = "feedback-status-success";
            statusMsg.textContent = "✓ ¡Reporte enviado con éxito! Gracias por tu apoyo.";
          }
          if (this.options.onSuccess) this.options.onSuccess();
          setTimeout(() => {
            handleClose();
          }, 1500);
        } else {
          if (statusMsg) {
            statusMsg.className = "feedback-status-error";
            statusMsg.textContent = result.fallbackSaved
              ? "No se pudo conectar a Discord. Guardamos el archivo .json en tu equipo."
              : `Error al enviar: ${result.error || "Fallo de conexión"}`;
          }
          if (submitBtn) submitBtn.disabled = false;
        }
      } catch (err) {
        if (statusMsg) {
          statusMsg.className = "feedback-status-error";
          statusMsg.textContent = `Error: ${String(err)}`;
        }
        if (submitBtn) submitBtn.disabled = false;
      } finally {
        this.isSubmitting = false;
      }
    });

    // Escape listener
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", keyHandler);
    backdrop.dataset.keyHandler = "true";
  }

  public close(): void {
    if (this.backdropElement && this.backdropElement.parentElement) {
      this.backdropElement.parentElement.removeChild(this.backdropElement);
      this.backdropElement = null;
    }
  }
}
