// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuideOverlay } from "./guide_overlay";
import type { GuideStep, GuideTopic } from "./guide_types";

describe("GuideOverlay", () => {
  const mockTopics: GuideTopic[] = [
    { id: "environment", title: "Entorno", icon: "🏛️", description: "Desc 1" },
    { id: "simulation", title: "Simulación", icon: "⚡", description: "Desc 2" },
  ];

  const mockStep: GuideStep = {
    id: "step1",
    topicId: "environment",
    topicTitle: "Entorno",
    title: "Prueba de Paso",
    description: "Descripción de prueba para el overlay.",
    shortcut: "Ctrl+K",
    actionHint: "Haz clic aquí",
    placement: "bottom",
    actionButton: {
      label: "Acción de Prueba",
      actionId: "test_action_id",
      icon: "⚡",
    },
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="target-element" style="width: 100px; height: 40px;">Elemento</div>';
  });

  it("debe crear el contenedor raíz, mostrar el paso y botón de acción", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const onClose = vi.fn();
    const onAction = vi.fn();
    const onTopicChange = vi.fn();

    const overlay = new GuideOverlay({ onNext, onPrev, onClose, onAction, onTopicChange });
    overlay.renderStep(
      { ...mockStep, targetSelector: "#target-element" },
      0,
      3,
      mockTopics[0],
      mockTopics
    );

    const root = document.getElementById("biaani-guide-overlay");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("active")).toBe(true);

    const titleEl = root?.querySelector(".guide-card-title");
    expect(titleEl?.textContent).toBe("Prueba de Paso");

    const descEl = root?.querySelector(".guide-card-desc");
    expect(descEl?.textContent).toBe("Descripción de prueba para el overlay.");

    // Selector de tema
    const topicSelect = root?.querySelector<HTMLSelectElement>("#guide-topic-select");
    expect(topicSelect).not.toBeNull();
    expect(topicSelect?.value).toBe("environment");

    topicSelect!.value = "simulation";
    topicSelect?.dispatchEvent(new Event("change"));
    expect(onTopicChange).toHaveBeenCalledWith("simulation");

    // Botón de acción interactiva
    const actionBtn = root?.querySelector<HTMLButtonElement>("#guide-action-btn");
    expect(actionBtn).not.toBeNull();
    expect(actionBtn?.textContent).toContain("Acción de Prueba");

    actionBtn?.click();
    expect(onAction).toHaveBeenCalledWith("test_action_id", expect.objectContaining({ id: "step1" }));

    // Verificar botones
    const prevBtn = root?.querySelector<HTMLButtonElement>("#guide-prev-btn");
    const nextBtn = root?.querySelector<HTMLButtonElement>("#guide-next-btn");
    const closeBtn = root?.querySelector<HTMLButtonElement>("#guide-close-btn");

    expect(prevBtn?.disabled).toBe(true); // Primer paso

    nextBtn?.click();
    expect(onNext).toHaveBeenCalledTimes(1);

    closeBtn?.click();
    expect(onClose).toHaveBeenCalledTimes(1);

    overlay.hide();
    expect(root?.classList.contains("active")).toBe(false);
    expect(root?.style.display).toBe("none");

    overlay.destroy();
    expect(document.getElementById("biaani-guide-overlay")).toBeNull();
  });

  it("debe recalcular posición con recalculatePosition()", () => {
    const overlay = new GuideOverlay({
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onClose: vi.fn(),
    });

    overlay.renderStep(mockStep, 0, 1, mockTopics[0], mockTopics);
    expect(overlay.getIsVisible()).toBe(true);

    overlay.recalculatePosition(mockStep);
    expect(overlay.getIsVisible()).toBe(true);

    overlay.destroy();
  });

  it("debe posicionar correctamente la tarjeta con placement right en elementos superiores", () => {
    const overlay = new GuideOverlay({
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onClose: vi.fn(),
    });

    overlay.renderStep(
      { ...mockStep, placement: "right", targetSelector: "#target-element" },
      0,
      1,
      mockTopics[0],
      mockTopics
    );

    const card = document.querySelector<HTMLElement>(".guide-card");
    expect(card).not.toBeNull();
    const topVal = parseInt(card?.style.top ?? "0", 10);
    expect(topVal).toBeGreaterThanOrEqual(0);

    overlay.destroy();
  });
});