// ==========================================================================
// DIAGNOSTIC MODAL — Centro de Diagnóstico Interactivo y Asistente ERC
// ==========================================================================

export interface DiagnosticIssue {
  readonly id: string;
  readonly severity: 'error' | 'warning';
  readonly title: string;
  readonly message: string;
  readonly remedy?: string;
  readonly componentId?: string;
  readonly pinIndex?: number;
}

export interface DiagnosticModalOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly issues: readonly DiagnosticIssue[];
  readonly onFocusComponent?: (componentId: string, pinIndex?: number) => void;
  readonly onOpenSettings?: () => void;
  readonly onDismiss?: () => void;
}

export class DiagnosticModal {
  private static currentInstance: DiagnosticModal | null = null;
  private backdropElement: HTMLElement | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  public static show(options: DiagnosticModalOptions): DiagnosticModal {
    if (DiagnosticModal.currentInstance) {
      DiagnosticModal.currentInstance.close();
    }
    const modal = new DiagnosticModal(options);
    modal.render();
    DiagnosticModal.currentInstance = modal;
    return modal;
  }

  public static closeCurrent(): void {
    if (DiagnosticModal.currentInstance) {
      DiagnosticModal.currentInstance.close();
      DiagnosticModal.currentInstance = null;
    }
  }

  constructor(private readonly options: DiagnosticModalOptions) {}

  public render(): void {
    if (typeof document === 'undefined') return;
    this.removeRenderedState();
    let container = document.getElementById('diagnostic-modal-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'diagnostic-modal-container';
      document.body.appendChild(container);
    }

    const errorCount = this.options.issues.filter((i) => i.severity === 'error').length;
    const warningCount = this.options.issues.filter((i) => i.severity === 'warning').length;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop diagnostic-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'diagnostic-modal-title');

    backdrop.innerHTML = `
      <div class="diagnostic-dialog">
        <div class="diagnostic-header">
          <div class="diagnostic-header-left">
            <span class="diagnostic-header-icon">${errorCount > 0 ? '🔴' : '🟡'}</span>
            <div>
              <h2 id="diagnostic-modal-title" class="diagnostic-title">${escapeHtml(this.options.title)}</h2>
              ${this.options.subtitle ? `<p class="diagnostic-subtitle">${escapeHtml(this.options.subtitle)}</p>` : ''}
            </div>
          </div>
          <div class="diagnostic-badges">
            ${errorCount > 0 ? `<span class="badge-erc-error">${errorCount} Error${errorCount > 1 ? 'es' : ''}</span>` : ''}
            ${warningCount > 0 ? `<span class="badge-erc-warning">${warningCount} Advertencia${warningCount > 1 ? 's' : ''}</span>` : ''}
            <button class="diagnostic-close-btn" type="button" aria-label="Cerrar diagnóstico">✕</button>
          </div>
        </div>

        <div class="diagnostic-body">
          <div class="diagnostic-issue-list">
            ${this.options.issues
              .map(
                (issue) => `
              <div class="diagnostic-issue-card issue-${issue.severity}">
                <div class="issue-main">
                  <div class="issue-icon">${issue.severity === 'error' ? '🚫' : '⚠️'}</div>
                  <div class="issue-content">
                    <div class="issue-header-row">
                      <span class="issue-title">${escapeHtml(issue.title)}</span>
                      ${issue.componentId ? `<span class="issue-comp-badge">[${escapeHtml(issue.componentId)}${issue.pinIndex !== undefined ? ` : Pin ${issue.pinIndex + 1}` : ''}]</span>` : ''}
                    </div>
                    <p class="issue-message">${escapeHtml(issue.message)}</p>
                    ${issue.remedy ? `<div class="issue-remedy"><span class="remedy-icon">💡</span> <span>${escapeHtml(issue.remedy)}</span></div>` : ''}
                  </div>
                </div>
                <div class="issue-actions">
                  ${
                    issue.componentId && this.options.onFocusComponent
                      ? `<button class="btn-issue-action btn-focus" type="button" data-comp-id="${escapeHtml(issue.componentId)}" data-pin-idx="${issue.pinIndex !== undefined ? issue.pinIndex : ''}">
                          <span>🎯 Localizar en Esquema</span>
                        </button>`
                      : ''
                  }
                </div>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>

        <div class="diagnostic-footer">
          <div class="diagnostic-footer-left">
            <span class="diagnostic-tip">Corrige los problemas indicados en el lienzo para poder iniciar la simulación.</span>
          </div>
          <div class="diagnostic-footer-right">
            ${
              this.options.onOpenSettings
                ? `<button class="btn-diagnostic-secondary" id="btn-diag-settings" type="button">
                    <span>⚙️ Ajustes de Simulación</span>
                  </button>`
                : ''
            }
            <button class="btn-diagnostic-primary" id="btn-diag-close" type="button">
              <span>Entendido</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    const closeBtn = backdrop.querySelector('.diagnostic-close-btn');
    const understandBtn = backdrop.querySelector('#btn-diag-close');
    const settingsBtn = backdrop.querySelector('#btn-diag-settings');

    const handleClose = () => {
      this.close();
      if (this.options.onDismiss) this.options.onDismiss();
    };

    closeBtn?.addEventListener('click', handleClose);
    understandBtn?.addEventListener('click', handleClose);

    if (settingsBtn && this.options.onOpenSettings) {
      settingsBtn.addEventListener('click', () => {
        this.close();
        this.options.onOpenSettings!();
      });
    }

    // Botones de localizar en esquema
    backdrop.querySelectorAll<HTMLButtonElement>('.btn-focus').forEach((btn) => {
      btn.addEventListener('click', () => {
        const compId = btn.getAttribute('data-comp-id');
        const pinIdxStr = btn.getAttribute('data-pin-idx');
        const pinIdx = pinIdxStr ? parseInt(pinIdxStr, 10) : undefined;
        if (compId && this.options.onFocusComponent) {
          this.close();
          this.options.onFocusComponent(compId, pinIdx);
        }
      });
    });

    // Cerrar con Escape
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    backdrop.dataset.keyHandler = 'true';

    container.appendChild(backdrop);
    this.backdropElement = backdrop;
  }

  public close(): void {
    this.removeRenderedState();
    if (DiagnosticModal.currentInstance === this) {
      DiagnosticModal.currentInstance = null;
    }
  }

  private removeRenderedState(): void {
    if (this.keyHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.backdropElement) {
      this.backdropElement.remove();
      this.backdropElement = null;
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
