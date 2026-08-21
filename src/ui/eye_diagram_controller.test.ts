// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EyeDiagramController } from "./eye_diagram_controller";
import type { TimeStepResult } from "./oscilloscope_panel";

describe("EyeDiagramController", () => {
  let mockTransient: TimeStepResult[];
  let addLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="eye-diagram-panel">
        <canvas id="eye-canvas" width="600" height="400"></canvas>
        <select id="eye-node-select"></select>
        <input id="eye-baud-input" type="number" />
        <button id="eye-autobaud-btn">Auto</button>
        <select id="eye-mask-select">
          <option value="hex">Hexagonal</option>
          <option value="none">Ninguna</option>
        </select>
        <select id="eye-color-select">
          <option value="cyan_phosphor">Cyan</option>
        </select>
        <button id="eye-export-csv-btn">Exportar CSV</button>

        <span id="eye-hud-height"></span>
        <span id="eye-hud-width"></span>
        <span id="eye-hud-tie-rms"></span>
        <span id="eye-hud-period-jitter"></span>
        <span id="eye-hud-baud"></span>
        <span id="eye-hud-qfactor"></span>
      </div>
    `;

    mockTransient = [];
    const ui = 100e-9;
    for (let t = 0; t <= 2e-6; t += 2e-9) {
      const phase = (t / ui) % 1.0;
      const v = 3.3 / (1 + Math.exp(-((phase - 0.5) * 20)));
      mockTransient.push({
        time: t,
        nodeVoltages: { "out": v, "1": v },
        branchCurrents: {},
      });
    }

    addLog = vi.fn();
  });

  it("inicializa el controlador, calcula el diagrama de ojo y actualiza el HUD", () => {
    const controller = new EyeDiagramController({
      getTransientResults: () => mockTransient,
      getAvailableNodes: () => ["out", "1"],
      addLog,
    });

    controller.init();

    const heightEl = document.querySelector("#eye-hud-height");
    expect(heightEl?.textContent).toContain("V");

    const baudEl = document.querySelector("#eye-hud-baud");
    expect(baudEl?.textContent).toContain("MBaud");

    const tieEl = document.querySelector("#eye-hud-tie-rms");
    expect(tieEl?.textContent).toContain("ps");
  });

  it("exporta métricas de diagrama de ojo y jitter a CSV", () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-eye-csv");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const controller = new EyeDiagramController({
      getTransientResults: () => mockTransient,
      getAvailableNodes: () => ["out"],
      addLog,
    });

    controller.init();
    controller.exportCsv();

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(addLog).toHaveBeenCalledWith(
      expect.stringContaining("Reporte de Diagrama de Ojo y Jitter exportado exitosamente a CSV"),
      "receive",
    );
  });
});
