// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentSpotlightModal } from "./component_spotlight_modal";

afterEach(() => {
  document.body.innerHTML = "";
  const existing = document.querySelector("#spotlight-modal-backdrop");
  if (existing) existing.remove();
});

describe("ComponentSpotlightModal", () => {
  it("abre el modal y enfoca el campo de búsqueda", () => {
    const callback = vi.fn();
    ComponentSpotlightModal.open(callback);

    const modal = document.querySelector<HTMLElement>("#spotlight-modal-backdrop");
    expect(modal).not.toBeNull();
    expect(modal?.classList.contains("open")).toBe(true);

    const input = document.querySelector<HTMLInputElement>("#spotlight-search-input");
    expect(input).not.toBeNull();
  });

  it("filtra componentes con búsqueda difusa", () => {
    const callback = vi.fn();
    ComponentSpotlightModal.open(callback);

    const input = document.querySelector<HTMLInputElement>("#spotlight-search-input")!;
    input.value = "resistor";
    input.dispatchEvent(new Event("input"));

    const results = document.querySelectorAll<HTMLElement>(".spotlight-item");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].textContent).toContain("Resistencia");
  });

  it("selecciona un componente al pulsar Enter y ejecuta el callback", () => {
    const callback = vi.fn();
    ComponentSpotlightModal.open(callback);

    const input = document.querySelector<HTMLInputElement>("#spotlight-search-input")!;
    input.value = "diodo";
    input.dispatchEvent(new Event("input"));

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    input.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].type).toBe("diode");

    // Modal cerrado tras selección
    const modal = document.querySelector<HTMLElement>("#spotlight-modal-backdrop");
    expect(modal).toBeNull();
    expect(ComponentSpotlightModal.isOpen()).toBe(false);
  });

  it("cierra el modal al pulsar Escape", () => {
    const callback = vi.fn();
    ComponentSpotlightModal.open(callback);

    const input = document.querySelector<HTMLInputElement>("#spotlight-search-input")!;
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    input.dispatchEvent(event);

    const modal = document.querySelector<HTMLElement>("#spotlight-modal-backdrop");
    expect(modal).toBeNull();
    expect(ComponentSpotlightModal.isOpen()).toBe(false);
    expect(callback).not.toHaveBeenCalled();
  });

  it("renderiza la estructura visual del buscador, lista y panel de vista previa", () => {
    const callback = vi.fn();
    ComponentSpotlightModal.open(callback);

    const searchBar = document.querySelector(".spotlight-search-bar");
    expect(searchBar).not.toBeNull();

    const results = document.querySelector(".spotlight-results");
    expect(results).not.toBeNull();

    const previewPane = document.querySelector(".spotlight-preview-pane");
    expect(previewPane).not.toBeNull();

    const previewTitle = document.querySelector(".spotlight-preview-title");
    expect(previewTitle).not.toBeNull();
    expect(previewTitle?.textContent).toBe("Resistencia");
  });
});
