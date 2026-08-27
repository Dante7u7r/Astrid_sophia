// ==========================================================================
// BIAANI INTERACTIVE FEATURE TOUR — CAPA VISUAL OVERLAY & SPOTLIGHT
// ==========================================================================

import type { GuidePlacement, GuideStep, GuideTopic, GuideTopicId } from "./guide_types";

export interface GuideOverlayCallbacks {
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  onTopicChange?: (topicId: GuideTopicId) => void;
  onAction?: (actionId: string, step: GuideStep) => void;
}

export class GuideOverlay {
  private rootEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private haloEl: HTMLElement | null = null;
  private cutoutEl: SVGRectElement | null = null;
  private callbacks: GuideOverlayCallbacks;
  private isVisible: boolean = false;

  constructor(callbacks: GuideOverlayCallbacks) {
    this.callbacks = callbacks;
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public show(): void {
    if (!this.rootEl) {
      this.buildDOM();
    }
    if (this.rootEl) {
      this.rootEl.style.display = "block";
      this.rootEl.classList.add("active");
      this.isVisible = true;
    }
  }

  public hide(): void {
    if (this.rootEl) {
      if (document.activeElement && this.rootEl.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur?.();
      }
      this.rootEl.classList.remove("active");
      this.rootEl.style.display = "none";
    }
    this.isVisible = false;
  }

  public destroy(): void {
    if (this.rootEl && this.rootEl.parentNode) {
      this.rootEl.parentNode.removeChild(this.rootEl);
    }
    this.rootEl = null;
    this.cardEl = null;
    this.haloEl = null;
    this.cutoutEl = null;
    this.isVisible = false;
  }

  public renderStep(
    step: GuideStep,
    stepIndex: number,
    totalSteps: number,
    topic: GuideTopic | null,
    allTopics: GuideTopic[] = []
  ): void {
    if (!this.rootEl || !this.cardEl) {
      this.buildDOM();
    }
    this.show();

    // 1. Localizar elemento objetivo
    let targetEl: HTMLElement | null = null;
    if (step.targetSelector) {
      try {
        targetEl = document.querySelector<HTMLElement>(step.targetSelector);
      } catch {
        targetEl = null;
      }
    }

    // 2. Actualizar contenido de la tarjeta
    this.updateCardContent(step, stepIndex, totalSteps, topic, allTopics);

    // 3. Posicionar spotlight y tarjeta
    this.updatePositions(targetEl, step.placement ?? "bottom");
  }

  public recalculatePosition(step: GuideStep): void {
    if (!this.isVisible || !this.cardEl) return;
    let targetEl: HTMLElement | null = null;
    if (step.targetSelector) {
      try {
        targetEl = document.querySelector<HTMLElement>(step.targetSelector);
      } catch {
        targetEl = null;
      }
    }
    this.updatePositions(targetEl, step.placement ?? "bottom");
  }

  private buildDOM(): void {
    const existing = document.getElementById("biaani-guide-overlay");
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const root = document.createElement("div");
    root.id = "biaani-guide-overlay";
    root.className = "guide-overlay-root";
    root.style.display = "none";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Guía interactiva de Biaani");

    // SVG Backdrop Mask
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "guide-backdrop-svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");

    const defs = document.createElementNS(svgNS, "defs");
    const mask = document.createElementNS(svgNS, "mask");
    mask.setAttribute("id", "biaani-guide-mask");

    const whiteBg = document.createElementNS(svgNS, "rect");
    whiteBg.setAttribute("width", "100%");
    whiteBg.setAttribute("height", "100%");
    whiteBg.setAttribute("fill", "#ffffff");
    mask.appendChild(whiteBg);

    const cutout = document.createElementNS(svgNS, "rect");
    cutout.setAttribute("class", "guide-spotlight-cutout");
    cutout.setAttribute("fill", "#000000");
    cutout.setAttribute("x", "0");
    cutout.setAttribute("y", "0");
    cutout.setAttribute("width", "0");
    cutout.setAttribute("height", "0");
    mask.appendChild(cutout);
    defs.appendChild(mask);
    svg.appendChild(defs);

    const maskRect = document.createElementNS(svgNS, "rect");
    maskRect.setAttribute("class", "guide-backdrop-mask-bg");
    maskRect.setAttribute("width", "100%");
    maskRect.setAttribute("height", "100%");
    maskRect.setAttribute("mask", "url(#biaani-guide-mask)");
    svg.appendChild(maskRect);

    // Halo
    const halo = document.createElement("div");
    halo.className = "guide-spotlight-halo";
    halo.style.display = "none";

    // Tarjeta Flotante
    const card = document.createElement("div");
    card.className = "guide-card";

    root.appendChild(svg);
    root.appendChild(halo);
    root.appendChild(card);

    document.body.appendChild(root);

    this.rootEl = root;
    this.cardEl = card;
    this.haloEl = halo;
    this.cutoutEl = cutout;

    // Listeners
    maskRect.addEventListener("click", () => {
      this.callbacks.onClose();
    });
  }

  private updateCardContent(
    step: GuideStep,
    stepIndex: number,
    totalSteps: number,
    topic: GuideTopic | null,
    allTopics: GuideTopic[]
  ): void {
    if (!this.cardEl) return;

    const isFirst = stepIndex === 0;
    const isLast = stepIndex === totalSteps - 1;

    const topicOptionsHtml = allTopics.length > 0
      ? `<select class="guide-topic-select" id="guide-topic-select" aria-label="Seleccionar bloque temático">
          ${allTopics
            .map(
              (t) =>
                `<option value="${t.id}" ${t.id === step.topicId ? "selected" : ""}>${t.icon} ${t.title}</option>`
            )
            .join("")}
        </select>`
      : `<span class="guide-topic-pill">${topic?.icon ?? "📖"} ${topic?.title ?? step.topicTitle}</span>`;

    const actionButtonHtml = step.actionButton
      ? `<div class="guide-action-row">
          <button class="guide-btn-action" id="guide-action-btn" type="button">
            <span>${step.actionButton.icon ?? "⚡"}</span>
            <span>${step.actionButton.label}</span>
          </button>
        </div>`
      : "";

    this.cardEl.innerHTML = `
      <div class="guide-card-header">
        ${topicOptionsHtml}
        <span class="guide-step-count">${stepIndex + 1} / ${totalSteps}</span>
        <button class="guide-btn-close" id="guide-close-btn" type="button" aria-label="Cerrar guía (Esc)">✕</button>
      </div>
      <h3 class="guide-card-title">${step.title}</h3>
      <p class="guide-card-desc">${step.description}</p>
      ${
        step.shortcut || step.actionHint
          ? `<div class="guide-card-extra">
              ${step.shortcut ? `<span class="guide-shortcut-badge">⌨️ ${step.shortcut}</span>` : ""}
              ${step.actionHint ? `<span class="guide-action-hint">💡 ${step.actionHint}</span>` : ""}
            </div>`
          : ""
      }
      ${actionButtonHtml}
      <div class="guide-card-footer">
        <button class="guide-btn guide-btn-secondary" id="guide-prev-btn" type="button" ${isFirst ? "disabled" : ""}>
          ◄ Anterior
        </button>
        <button class="guide-btn guide-btn-primary" id="guide-next-btn" type="button">
          ${isLast ? "Finalizar ✓" : "Siguiente ►"}
        </button>
      </div>
    `;

    const closeBtn = this.cardEl.querySelector<HTMLButtonElement>("#guide-close-btn");
    const prevBtn = this.cardEl.querySelector<HTMLButtonElement>("#guide-prev-btn");
    const nextBtn = this.cardEl.querySelector<HTMLButtonElement>("#guide-next-btn");
    const topicSelect = this.cardEl.querySelector<HTMLSelectElement>("#guide-topic-select");
    const actionBtn = this.cardEl.querySelector<HTMLButtonElement>("#guide-action-btn");

    closeBtn?.addEventListener("click", () => this.callbacks.onClose());
    prevBtn?.addEventListener("click", () => this.callbacks.onPrev());
    nextBtn?.addEventListener("click", () => this.callbacks.onNext());

    topicSelect?.addEventListener("change", () => {
      const selectedTopic = topicSelect.value as GuideTopicId;
      this.callbacks.onTopicChange?.(selectedTopic);
    });

    actionBtn?.addEventListener("click", () => {
      if (step.actionButton) {
        this.callbacks.onAction?.(step.actionButton.actionId, step);
      }
    });
  }

  private updatePositions(targetEl: HTMLElement | null, placement: GuidePlacement): void {
    if (!this.cardEl || !this.haloEl || !this.cutoutEl) return;

    const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
    const padding = 8;
    const cardWidth = 380;

    let targetRect: DOMRect | null = null;
    if (targetEl) {
      try {
        const rect = targetEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          targetRect = rect;
        }
      } catch {
        targetRect = null;
      }
    }

    if (targetRect) {
      const x = Math.max(0, targetRect.left - padding);
      const y = Math.max(0, targetRect.top - padding);
      const w = targetRect.width + padding * 2;
      const h = targetRect.height + padding * 2;

      // Actualizar cutout SVG
      this.cutoutEl.setAttribute("x", `${x}`);
      this.cutoutEl.setAttribute("y", `${y}`);
      this.cutoutEl.setAttribute("width", `${w}`);
      this.cutoutEl.setAttribute("height", `${h}`);

      // Actualizar halo
      this.haloEl.style.display = "block";
      this.haloEl.style.left = `${x}px`;
      this.haloEl.style.top = `${y}px`;
      this.haloEl.style.width = `${w}px`;
      this.haloEl.style.height = `${h}px`;

      // Posicionar tarjeta
      this.positionCardRelativeToTarget(targetRect, placement, cardWidth, viewportW, viewportH);
    } else {
      // Sin elemento: centrar tarjeta y ocultar foco
      this.cutoutEl.setAttribute("width", "0");
      this.cutoutEl.setAttribute("height", "0");
      this.haloEl.style.display = "none";

      this.cardEl.style.left = `${Math.max(16, (viewportW - cardWidth) / 2)}px`;
      this.cardEl.style.top = `${Math.max(16, (viewportH - 240) / 2)}px`;
    }
  }

  private positionCardRelativeToTarget(
    targetRect: DOMRect,
    placement: GuidePlacement,
    cardWidth: number,
    viewportW: number,
    viewportH: number
  ): void {
    if (!this.cardEl) return;

    const margin = 14;
    const cardHeight = this.cardEl.offsetHeight || 240;

    let left = 0;
    let top = 0;

    if (placement === "center") {
      left = (viewportW - cardWidth) / 2;
      top = (viewportH - cardHeight) / 2;
    } else if (placement === "bottom") {
      left = targetRect.left + (targetRect.width - cardWidth) / 2;
      top = targetRect.bottom + margin;
      if (top + cardHeight > viewportH - 16) {
        top = targetRect.top - cardHeight - margin;
      }
    } else if (placement === "top") {
      left = targetRect.left + (targetRect.width - cardWidth) / 2;
      top = targetRect.top - cardHeight - margin;
      if (top < 16) {
        top = targetRect.bottom + margin;
      }
    } else if (placement === "right") {
      left = targetRect.right + margin;
      if (targetRect.top + (targetRect.height - cardHeight) / 2 < 16) {
        top = targetRect.top;
      } else {
        top = targetRect.top + (targetRect.height - cardHeight) / 2;
      }
      if (left + cardWidth > viewportW - 16) {
        left = targetRect.left - cardWidth - margin;
      }
    } else if (placement === "left") {
      left = targetRect.left - cardWidth - margin;
      if (targetRect.top + (targetRect.height - cardHeight) / 2 < 16) {
        top = targetRect.top;
      } else {
        top = targetRect.top + (targetRect.height - cardHeight) / 2;
      }
      if (left < 16) {
        left = targetRect.right + margin;
      }
    } else {
      // Auto
      if (targetRect.bottom + cardHeight + margin <= viewportH - 16) {
        left = targetRect.left + (targetRect.width - cardWidth) / 2;
        top = targetRect.bottom + margin;
      } else {
        left = targetRect.left + (targetRect.width - cardWidth) / 2;
        top = targetRect.top - cardHeight - margin;
      }
    }

    // Clamping dentro del viewport visible
    left = Math.max(16, Math.min(viewportW - cardWidth - 16, left));
    top = Math.max(16, Math.min(viewportH - cardHeight - 16, top));

    this.cardEl.style.left = `${Math.round(left)}px`;
    this.cardEl.style.top = `${Math.round(top)}px`;
  }
}