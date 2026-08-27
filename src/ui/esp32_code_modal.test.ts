// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { ComponentInstance } from "../canvas_orchestrator";
import {
  openEsp32CodeModal,
  closeEsp32CodeModal,
} from "./esp32_code_modal";

describe("esp32_code_modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    closeEsp32CodeModal();
  });

  it("abre el modal de código y renderiza el editor y monitor serie", () => {
    const comp: ComponentInstance = {
      id: "ESP1",
      type: "esp32",
      x: 0,
      y: 0,
      rotation: 0,
      value: "ESP32",
    };

    openEsp32CodeModal(comp);

    const overlay = document.querySelector(".esp32-modal-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("ESP32 DevKit V1");
    expect(overlay?.textContent).toContain("Monitor Serie");
  });

  it("cierra el modal al invocar closeEsp32CodeModal()", () => {
    const comp: ComponentInstance = {
      id: "ESP2",
      type: "esp32",
      x: 0,
      y: 0,
      rotation: 0,
      value: "ESP32",
    };

    openEsp32CodeModal(comp);
    expect(document.querySelector(".esp32-modal-overlay")).not.toBeNull();

    closeEsp32CodeModal();
    expect(document.querySelector(".esp32-modal-overlay")).toBeNull();
  });
});
