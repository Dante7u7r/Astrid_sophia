// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuideEngine, STORAGE_KEY_GUIDE_SEEN } from "./guide_engine";
import type { GuideStep, GuideTopic } from "./guide_types";

const MOCK_TOPICS: GuideTopic[] = [
  { id: "environment", title: "Entorno", icon: "🏛️", description: "Desc 1" },
  { id: "simulation", title: "Simulación", icon: "⚡", description: "Desc 2" },
];

const MOCK_STEPS: GuideStep[] = [
  {
    id: "step1",
    topicId: "environment",
    topicTitle: "Entorno",
    title: "Paso 1",
    description: "Desc 1",
    actionButton: {
      label: "Acción 1",
      actionId: "action_1",
    },
  },
  {
    id: "step2",
    topicId: "environment",
    topicTitle: "Entorno",
    title: "Paso 2",
    description: "Desc 2",
    requiresPanel: "left",
  },
  {
    id: "step3",
    topicId: "simulation",
    topicTitle: "Simulación",
    title: "Paso 3",
    description: "Desc 3",
  },
];

describe("GuideEngine", () => {
  let mockStorage: Storage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    mockStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
      key: () => null,
      length: 0,
    };
    document.body.innerHTML = "";
  });

  it("debe inicializarse en estado inactivo", () => {
    const engine = new GuideEngine({ storage: mockStorage }, MOCK_STEPS, MOCK_TOPICS);
    const state = engine.getState();
    expect(state.isActive).toBe(false);
    expect(state.currentStepIndex).toBe(0);
    expect(state.totalSteps).toBe(3);
    expect(state.currentStep).toBeNull();
  });

  it("debe avanzar y retroceder pasos correctamente", () => {
    const onPanelOpen = vi.fn();
    const engine = new GuideEngine(
      { storage: mockStorage, onPanelOpenRequest: onPanelOpen },
      MOCK_STEPS,
      MOCK_TOPICS
    );

    engine.start();
    expect(engine.getState().isActive).toBe(true);
    expect(engine.getState().currentStepIndex).toBe(0);
    expect(engine.getState().currentStep?.id).toBe("step1");

    engine.next();
    expect(engine.getState().currentStepIndex).toBe(1);
    expect(engine.getState().currentStep?.id).toBe("step2");
    expect(onPanelOpen).toHaveBeenCalledWith("left");

    engine.next();
    expect(engine.getState().currentStepIndex).toBe(2);
    expect(engine.getState().currentStep?.id).toBe("step3");

    // Al avanzar en el último paso, debe salir
    engine.next();
    expect(engine.getState().isActive).toBe(false);

    engine.destroy();
  });

  it("debe delegar onActionTrigger al pulsar el botón de acción", () => {
    const onAction = vi.fn();
    const engine = new GuideEngine(
      { storage: mockStorage, onActionTrigger: onAction },
      MOCK_STEPS,
      MOCK_TOPICS
    );

    engine.start();
    const actionBtn = document.getElementById("guide-action-btn");
    expect(actionBtn).not.toBeNull();

    actionBtn?.click();
    expect(onAction).toHaveBeenCalledWith("action_1", expect.objectContaining({ id: "step1" }));

    engine.destroy();
  });

  it("debe reaccionar a eventos de resize de ventana sin fallar", () => {
    const engine = new GuideEngine({ storage: mockStorage }, MOCK_STEPS, MOCK_TOPICS);
    engine.start();

    expect(() => {
      window.dispatchEvent(new Event("resize"));
    }).not.toThrow();

    engine.destroy();
  });

  it("debe permitir cambiar de tema mediante el selector", () => {
    const engine = new GuideEngine({ storage: mockStorage }, MOCK_STEPS, MOCK_TOPICS);
    engine.start();
    expect(engine.getState().currentStepIndex).toBe(0);

    const select = document.querySelector<HTMLSelectElement>("#guide-topic-select");
    expect(select).not.toBeNull();

    select!.value = "simulation";
    select?.dispatchEvent(new Event("change"));

    expect(engine.getState().currentStepIndex).toBe(2);
    expect(engine.getState().currentStep?.id).toBe("step3");

    engine.destroy();
  });

  it("debe responder a eventos de teclado (Escape, Flechas, Enter)", () => {
    const engine = new GuideEngine({ storage: mockStorage }, MOCK_STEPS, MOCK_TOPICS);
    engine.start();

    // Flecha derecha avanza
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.getState().currentStepIndex).toBe(1);

    // Flecha izquierda retrocede
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(engine.getState().currentStepIndex).toBe(0);

    // Enter avanza
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(engine.getState().currentStepIndex).toBe(1);

    // Escape sale
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(engine.getState().isActive).toBe(false);

    engine.destroy();
  });

  it("debe gestionar firstVisit y marcar como visto en storage", () => {
    const engine = new GuideEngine({ storage: mockStorage }, MOCK_STEPS, MOCK_TOPICS);
    expect(engine.isFirstVisit()).toBe(true);

    engine.markAsSeen();
    expect(engine.isFirstVisit()).toBe(false);
    expect(mockStorage.getItem(STORAGE_KEY_GUIDE_SEEN)).toBe("true");

    engine.destroy();
  });

  it("debe conmutar estado con toggle()", () => {
    const engine = new GuideEngine({ storage: mockStorage }, MOCK_STEPS, MOCK_TOPICS);
    expect(engine.getState().isActive).toBe(false);

    engine.toggle();
    expect(engine.getState().isActive).toBe(true);

    engine.toggle();
    expect(engine.getState().isActive).toBe(false);

    engine.destroy();
  });

  it("debe solicitar activación de pestaña de instrumento si el paso lo define", () => {
    const onTabRequest = vi.fn();
    const customSteps: GuideStep[] = [
      {
        id: "step_tab",
        topicId: "simulation",
        topicTitle: "Simulación",
        title: "Paso Tab",
        description: "Desc",
        requiresInstrumentTab: "oscilloscope",
      },
    ];

    const engine = new GuideEngine(
      { storage: mockStorage, onInstrumentTabRequest: onTabRequest },
      customSteps,
      MOCK_TOPICS
    );

    engine.start();
    expect(onTabRequest).toHaveBeenCalledWith("oscilloscope");

    engine.destroy();
  });

  it("no debe interceptar flechas ni enter si el foco está en un select o input", () => {
    const engine = new GuideEngine({ storage: mockStorage }, MOCK_STEPS, MOCK_TOPICS);
    engine.start();
    expect(engine.getState().currentStepIndex).toBe(0);

    const select = document.querySelector<HTMLSelectElement>("#guide-topic-select");
    expect(select).not.toBeNull();
    select?.focus();

    // Disparar evento de tecla directamente en el select
    select?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(engine.getState().currentStepIndex).toBe(0); // No debe avanzar

    select?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(engine.getState().currentStepIndex).toBe(0); // No debe avanzar

    engine.destroy();
  });
});