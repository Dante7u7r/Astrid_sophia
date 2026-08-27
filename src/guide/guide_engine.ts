// ==========================================================================
// BIAANI INTERACTIVE FEATURE TOUR — MOTOR DE CONTROL PRINCIPAL (ENGINE)
// ==========================================================================

import { GUIDE_STEPS, GUIDE_TOPICS } from "./guide_steps";
import { GuideOverlay } from "./guide_overlay";
import type {
  GuideEngineDeps,
  GuideState,
  GuideStateChangeListener,
  GuideStep,
  GuideTopic,
  GuideTopicId,
} from "./guide_types";

export const STORAGE_KEY_GUIDE_SEEN = "biaani_guide_tour_seen";

export class GuideEngine {
  private steps: GuideStep[];
  private topics: GuideTopic[];
  private currentStepIndex: number = 0;
  private isActive: boolean = false;
  private overlay: GuideOverlay;
  private deps: GuideEngineDeps;
  private listeners: Set<GuideStateChangeListener> = new Set();
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundResizeHandler: (() => void) | null = null;

  constructor(deps: GuideEngineDeps = {}, customSteps?: GuideStep[], customTopics?: GuideTopic[]) {
    this.deps = deps;
    this.steps = customSteps ?? GUIDE_STEPS;
    this.topics = customTopics ?? GUIDE_TOPICS;

    this.overlay = new GuideOverlay({
      onNext: () => this.next(),
      onPrev: () => this.prev(),
      onClose: () => this.exit(),
      onTopicChange: (topicId) => this.start(topicId),
      onAction: (actionId, step) => this.deps.onActionTrigger?.(actionId, step),
    });
  }

  public start(topicId?: GuideTopicId): void {
    if (this.steps.length === 0) return;

    if (topicId) {
      const idx = this.steps.findIndex((s) => s.topicId === topicId);
      this.currentStepIndex = idx >= 0 ? idx : 0;
    } else {
      this.currentStepIndex = 0;
    }

    this.isActive = true;
    this.attachEventListeners();
    this.renderCurrentStep();
    this.notifyState();
  }

  public toggle(topicId?: GuideTopicId): void {
    if (this.isActive) {
      this.exit();
    } else {
      this.start(topicId);
    }
  }

  public next(): void {
    if (!this.isActive) return;

    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
      this.renderCurrentStep();
      this.notifyState();
    } else {
      this.exit();
    }
  }

  public prev(): void {
    if (!this.isActive) return;

    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.renderCurrentStep();
      this.notifyState();
    }
  }

  public goToStep(index: number): void {
    if (!this.isActive) return;
    if (index >= 0 && index < this.steps.length) {
      this.currentStepIndex = index;
      this.renderCurrentStep();
      this.notifyState();
    }
  }

  public exit(): void {
    if (!this.isActive) return;

    this.isActive = false;
    this.detachEventListeners();
    this.overlay.hide();
    this.markAsSeen();
    this.notifyState();
  }

  public destroy(): void {
    this.exit();
    this.overlay.destroy();
    this.listeners.clear();
  }

  public getState(): GuideState {
    const currentStep = this.isActive && this.steps[this.currentStepIndex] ? this.steps[this.currentStepIndex] : null;
    const currentTopic = currentStep
      ? this.topics.find((t) => t.id === currentStep.topicId) ?? null
      : null;

    return {
      isActive: this.isActive,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      currentStep,
      currentTopic,
    };
  }

  public subscribe(listener: GuideStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public isFirstVisit(): boolean {
    try {
      const storage = this.deps.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
      if (!storage) return false;
      return storage.getItem(STORAGE_KEY_GUIDE_SEEN) === null;
    } catch {
      return false;
    }
  }

  public markAsSeen(): void {
    try {
      const storage = this.deps.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
      if (storage) {
        storage.setItem(STORAGE_KEY_GUIDE_SEEN, "true");
      }
    } catch {
      // Ignorar errores de localStorage restringido
    }
  }

  public showWelcomeToastIfFirstVisit(): void {
    if (!this.isFirstVisit()) return;
    if (typeof document === "undefined") return;

    const existingToast = document.getElementById("biaani-welcome-toast");
    if (existingToast) return;

    const toast = document.createElement("div");
    toast.id = "biaani-welcome-toast";
    toast.className = "guide-welcome-toast";
    toast.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-weight: 700; color: #fff; font-size: 0.9rem;">⚡ Bienvenido a Biaani</span>
        <button id="toast-close-btn" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 14px;">✕</button>
      </div>
      <p style="font-size: 0.78rem; color: #c9d1d9; line-height: 1.4; margin: 0;">
        ¿Es tu primera vez explorando el simulador? Puedes iniciar un recorrido guiado rápido de 1 minuto.
      </p>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
        <button id="toast-skip-btn" class="guide-btn guide-btn-secondary" style="font-size: 0.72rem; padding: 4px 10px;">
          Omitir
        </button>
        <button id="toast-start-btn" class="guide-btn guide-btn-primary" style="font-size: 0.72rem; padding: 4px 10px;">
          Ver Guía (F1)
        </button>
      </div>
    `;

    document.body.appendChild(toast);

    const closeToast = () => {
      this.markAsSeen();
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    };

    toast.querySelector("#toast-close-btn")?.addEventListener("click", closeToast);
    toast.querySelector("#toast-skip-btn")?.addEventListener("click", closeToast);
    toast.querySelector("#toast-start-btn")?.addEventListener("click", () => {
      closeToast();
      this.start();
    });
  }

  private renderCurrentStep(): void {
    const step = this.steps[this.currentStepIndex];
    if (!step) return;

    // Si el paso requiere que un panel esté abierto, emitir la petición
    if (step.requiresPanel && this.deps.onPanelOpenRequest) {
      this.deps.onPanelOpenRequest(step.requiresPanel);
    }

    // Si el paso requiere una pestaña de instrumento activa
    if (step.requiresInstrumentTab && this.deps.onInstrumentTabRequest) {
      this.deps.onInstrumentTabRequest(step.requiresInstrumentTab);
    }

    const topic = this.topics.find((t) => t.id === step.topicId) ?? null;
    this.overlay.renderStep(step, this.currentStepIndex, this.steps.length, topic, this.topics);

    // Recalcular posición tras posibles transiciones y aperturas de paneles en el DOM
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (this.isActive && this.steps[this.currentStepIndex]?.id === step.id) {
          this.overlay.recalculatePosition(step);
        }
      }, 60);
      window.setTimeout(() => {
        if (this.isActive && this.steps[this.currentStepIndex]?.id === step.id) {
          this.overlay.recalculatePosition(step);
        }
      }, 220);
    }
  }

  private attachEventListeners(): void {
    this.detachEventListeners();

    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (!this.isActive) return;

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toUpperCase();
      const isInteractiveFormEl = tagName === "SELECT" || tagName === "INPUT" || tagName === "TEXTAREA";

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.exit();
      } else if ((e.key === "ArrowRight" || e.key === "Enter") && !isInteractiveFormEl) {
        e.preventDefault();
        e.stopPropagation();
        this.next();
      } else if (e.key === "ArrowLeft" && !isInteractiveFormEl) {
        e.preventDefault();
        e.stopPropagation();
        this.prev();
      }
    };

    this.boundResizeHandler = () => {
      if (this.isActive) {
        const step = this.steps[this.currentStepIndex];
        if (step) {
          this.overlay.recalculatePosition(step);
        }
      }
    };

    window.addEventListener("keydown", this.boundKeyHandler, { capture: true });
    window.addEventListener("resize", this.boundResizeHandler, { passive: true });
  }

  private detachEventListeners(): void {
    if (this.boundKeyHandler) {
      window.removeEventListener("keydown", this.boundKeyHandler, { capture: true });
      this.boundKeyHandler = null;
    }
    if (this.boundResizeHandler) {
      window.removeEventListener("resize", this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
  }

  private notifyState(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error("[GuideEngine] Error in state listener:", err);
      }
    });
  }
}