// ==========================================================================
// CONFIRMATION MODAL — Diálogos de Confirmación Estilizados y Seguros
// ==========================================================================

export interface ConfirmationModalOptions {
  readonly title?: string;
  readonly message: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly icon?: string;
  readonly danger?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export class ConfirmationModal {
  private static currentContainer: HTMLElement | null = null;

  /**
   * Muestra un diálogo de confirmación moderno no bloqueante que resuelve con true (confirmar) o false (cancelar).
   */
  public static confirm(options: ConfirmationModalOptions): Promise<boolean> {
    if (typeof document === "undefined") {
      return Promise.resolve(true);
    }

    // Cerrar cualquier modal previo
    ConfirmationModal.closeCurrent();

    return new Promise<boolean>((resolve) => {
      const container = document.createElement("div");
      container.className = "confirmation-modal-backdrop";
      container.setAttribute("role", "alertdialog");
      container.setAttribute("aria-modal", "true");

      const icon = options.icon ?? (options.danger ? "⚠️" : "💬");
      const title = options.title ?? "Confirmar acción";
      const confirmText = options.confirmText ?? (options.danger ? "Aceptar" : "Confirmar");
      const cancelText = options.cancelText ?? "Cancelar";
      const confirmButtonClass = options.danger ? "btn-confirm-danger" : "btn-confirm-primary";

      container.innerHTML = `
        <div class="confirmation-dialog">
          <div class="confirmation-header">
            <span class="confirmation-icon">${icon}</span>
            <h3 class="confirmation-title">${escapeHtml(title)}</h3>
          </div>
          <div class="confirmation-body">
            <p>${escapeHtml(options.message)}</p>
          </div>
          <div class="confirmation-footer">
            <button type="button" class="btn-confirm-cancel" id="btn-modal-cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="${confirmButtonClass}" id="btn-modal-confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(container);
      ConfirmationModal.currentContainer = container;

      const btnConfirm = container.querySelector<HTMLButtonElement>("#btn-modal-confirm");
      const btnCancel = container.querySelector<HTMLButtonElement>("#btn-modal-cancel");

      const cleanup = () => {
        document.removeEventListener("keydown", onKeyDown);
        if (container.parentNode) {
          container.parentNode.removeChild(container);
        }
        if (ConfirmationModal.currentContainer === container) {
          ConfirmationModal.currentContainer = null;
        }
      };

      const handleConfirm = () => {
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          handleCancel();
        } else if (e.key === "Enter" && document.activeElement === btnConfirm) {
          e.preventDefault();
          handleConfirm();
        }
      };

      btnConfirm?.addEventListener("click", handleConfirm);
      btnCancel?.addEventListener("click", handleCancel);

      container.addEventListener("click", (e) => {
        if (e.target === container) {
          handleCancel();
        }
      });

      document.addEventListener("keydown", onKeyDown);

      // Focus por defecto en el botón cancelar para evitar confirmaciones accidentales si es peligroso
      requestAnimationFrame(() => {
        if (options.danger) {
          btnCancel?.focus();
        } else {
          btnConfirm?.focus();
        }
      });
    });
  }

  public static closeCurrent(): void {
    if (ConfirmationModal.currentContainer) {
      if (ConfirmationModal.currentContainer.parentNode) {
        ConfirmationModal.currentContainer.parentNode.removeChild(ConfirmationModal.currentContainer);
      }
      ConfirmationModal.currentContainer = null;
    }
  }
}
