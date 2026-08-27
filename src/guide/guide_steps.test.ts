import { describe, expect, it } from "vitest";
import { GUIDE_STEPS, GUIDE_TOPICS } from "./guide_steps";

describe("guide_steps catalog", () => {
  it("debe contener al menos 5 temas y 10 pasos", () => {
    expect(GUIDE_TOPICS.length).toBeGreaterThanOrEqual(5);
    expect(GUIDE_STEPS.length).toBeGreaterThanOrEqual(10);
  });

  it("debe tener IDs de paso únicos", () => {
    const ids = GUIDE_STEPS.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("cada paso debe pertenecer a un tema válido", () => {
    const topicIds = new Set(GUIDE_TOPICS.map((t) => t.id));
    for (const step of GUIDE_STEPS) {
      expect(topicIds.has(step.topicId)).toBe(true);
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
      if (step.actionButton) {
        expect(step.actionButton.label.trim().length).toBeGreaterThan(0);
        expect(step.actionButton.actionId.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("cada tema debe tener icono, título y descripción", () => {
    for (const topic of GUIDE_TOPICS) {
      expect(topic.icon.trim().length).toBeGreaterThan(0);
      expect(topic.title.trim().length).toBeGreaterThan(0);
      expect(topic.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("los pasos de instrumentos deben solicitar la pestaña adecuada", () => {
    const oscStep = GUIDE_STEPS.find((s) => s.id === "oscilloscope");
    expect(oscStep?.requiresInstrumentTab).toBe("oscilloscope");
    expect(oscStep?.requiresPanel).toBe("dock");

    const optStep = GUIDE_STEPS.find((s) => s.id === "circuit_optimizer");
    expect(optStep?.requiresInstrumentTab).toBe("optimizer");
    expect(optStep?.requiresPanel).toBe("dock");

    const mcuStep = GUIDE_STEPS.find((s) => s.id === "mcu_cosimulation");
    expect(mcuStep?.requiresPanel).toBe("left");
    expect(mcuStep?.targetSelector).toBe("#sidebar-left");
  });
});