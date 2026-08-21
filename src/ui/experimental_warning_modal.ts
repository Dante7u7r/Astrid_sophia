// ==========================================================================
// EXPERIMENTAL WARNING MODAL — Gate & Warning para PSS, STB y BSIM
// ==========================================================================

export interface ExperimentalWarningOptions {
  featureName: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export class ExperimentalWarningModal {
  private static instance: ExperimentalWarningModal | null = null;

  private modal: HTMLElement | null = null;
  private btnConfirm: HTMLButtonElement | null = null;
  private btnCancel: HTMLButtonElement | null = null;
  private messageEl: HTMLElement | null = null;
  private currentOptions: ExperimentalWarningOptions | null = null;

  public static getInstance(): ExperimentalWarningModal {
    if (!ExperimentalWarningModal.instance) {
      ExperimentalWarningModal.instance = new ExperimentalWarningModal();
    }
    return ExperimentalWarningModal.instance;
  }

  public static show(options: ExperimentalWarningOptions): void {
    const modal = ExperimentalWarningModal.getInstance();
    modal.open(options);
  }

  public static close(): void {
    if (ExperimentalWarningModal.instance) {
      ExperimentalWarningModal.instance.hide();
    }
  }

  constructor() {
    if (typeof document === "undefined") return;
    this.modal = document.querySelector("#experimental-warning-modal");
    this.btnConfirm = document.querySelector("#btn-exp-confirm");
    this.btnCancel = document.querySelector("#btn-exp-cancel");
    this.messageEl = document.querySelector("#exp-warning-message");

    this.initEvents();
  }

  private initEvents(): void {
    if (this.btnConfirm) {
      this.btnConfirm.addEventListener("click", () => {
        const opts = this.currentOptions;
        this.hide();
        if (opts?.onConfirm) {
          opts.onConfirm();
        }
      });
    }

    if (this.btnCancel) {
      this.btnCancel.addEventListener("click", () => {
        const opts = this.currentOptions;
        this.hide();
        if (opts?.onCancel) {
          opts.onCancel();
        }
      });
    }

    this.modal?.addEventListener("click", (e) => {
      if (e.target === this.modal) {
        const opts = this.currentOptions;
        this.hide();
        if (opts?.onCancel) opts.onCancel();
      }
    });

    this.modal?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        const opts = this.currentOptions;
        this.hide();
        if (opts?.onCancel) opts.onCancel();
      }
    });
  }

  public open(options: ExperimentalWarningOptions): void {
    this.currentOptions = options;
    if (!this.modal) {
      this.modal = document.querySelector("#experimental-warning-modal");
      this.btnConfirm = document.querySelector("#btn-exp-confirm");
      this.btnCancel = document.querySelector("#btn-exp-cancel");
      this.messageEl = document.querySelector("#exp-warning-message");
      this.initEvents();
    }

    if (this.messageEl) {
      this.messageEl.innerHTML = `Has solicitado ejecutar una función de física experimental (<strong>${options.featureName}</strong>) que requiere confirmación explícita para evitar uso en diseño real no calificado:`;
    }

    if (this.modal) {
      this.modal.classList.add("open");
      this.modal.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => this.btnConfirm?.focus({ preventScroll: true }));
    }
  }

  public hide(): void {
    if (!this.modal?.classList.contains("open")) return;
    this.modal.classList.remove("open");
    this.modal.setAttribute("aria-hidden", "true");
    this.currentOptions = null;
  }
}
