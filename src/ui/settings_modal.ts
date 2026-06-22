export interface SimulationSettings {
  dt: number;
  tolerance: number;
  maxIterations: number;
}

export class SettingsModal {
  private settingsModal: HTMLElement | null = null;
  private settingsTriggerBtn: HTMLButtonElement | null = null;
  private btnCancelSettings: HTMLButtonElement | null = null;
  private btnSaveSettings: HTMLButtonElement | null = null;

  private dtInput: HTMLInputElement | null = null;
  private tolInput: HTMLInputElement | null = null;
  private iterInput: HTMLInputElement | null = null;

  private settings: SimulationSettings;
  private onSaveCallback: (newSettings: SimulationSettings) => void;

  constructor(initialSettings: SimulationSettings, onSave: (newSettings: SimulationSettings) => void) {
    this.settings = { ...initialSettings };
    this.onSaveCallback = onSave;

    this.settingsModal = document.querySelector("#settings-modal");
    this.settingsTriggerBtn = document.querySelector("#settings-trigger-btn");
    this.btnCancelSettings = document.querySelector("#btn-cancel-settings");
    this.btnSaveSettings = document.querySelector("#btn-save-settings");

    this.dtInput = document.querySelector("#settings-dt-input");
    this.tolInput = document.querySelector("#settings-tol-input");
    this.iterInput = document.querySelector("#settings-iter-input");

    this.initEvents();
  }

  private initEvents() {
    if (this.settingsTriggerBtn && this.settingsModal) {
      this.settingsTriggerBtn.addEventListener("click", () => {
        if (this.dtInput) this.dtInput.value = this.settings.dt.toString();
        if (this.tolInput) this.tolInput.value = this.settings.tolerance.toString();
        if (this.iterInput) this.iterInput.value = this.settings.maxIterations.toString();
        this.settingsModal?.classList.add("open");
      });
    }

    if (this.btnCancelSettings && this.settingsModal) {
      this.btnCancelSettings.addEventListener("click", () => {
        this.settingsModal?.classList.remove("open");
      });
    }

    if (this.btnSaveSettings && this.settingsModal) {
      this.btnSaveSettings.addEventListener("click", () => {
        if (this.dtInput && this.tolInput && this.iterInput) {
          this.settings.dt = parseFloat(this.dtInput.value) || 0.0001;
          this.settings.tolerance = parseFloat(this.tolInput.value) || 0.00001;
          this.settings.maxIterations = parseInt(this.iterInput.value) || 100;
          this.onSaveCallback(this.settings);
        }
        this.settingsModal?.classList.remove("open");
      });
    }
  }

  public getSettings(): SimulationSettings {
    return this.settings;
  }
}
