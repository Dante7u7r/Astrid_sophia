// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CornerAnalysisDashboard } from "./corner_analysis_dashboard";
import type { PvtRunResult } from "./oscilloscope_panel";

describe("CornerAnalysisDashboard", () => {
  let mockPvtResults: PvtRunResult[];
  let addLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="corner-dashboard-container">
        <div id="corner-yield-badge">YIELD: --</div>
        <div id="corner-summary-text"></div>
        <div id="corner-volt-tabs"></div>
        <div id="corner-specs-list"></div>
        <canvas id="corner-heatmap-canvas" width="600" height="300"></canvas>
        <button id="corner-export-csv-btn">Exportar CSV</button>
      </div>
    `;

    mockPvtResults = [
      {
        config: { corner: "tt", temperatureC: 27, voltageScaling: 1.0 },
        converged: true,
        transient: [
          { time: 0, nodeVoltages: { "out": 0 }, branchCurrents: {} },
          { time: 0.00001, nodeVoltages: { "out": 3.3 }, branchCurrents: {} },
        ],
        error: null,
      },
      {
        config: { corner: "ff", temperatureC: 70, voltageScaling: 1.05 },
        converged: true,
        transient: [
          { time: 0, nodeVoltages: { "out": 0 }, branchCurrents: {} },
          { time: 0.00001, nodeVoltages: { "out": 3.4 }, branchCurrents: {} },
        ],
        error: null,
      },
    ];

    addLog = vi.fn();
  });

  it("inicializa y renderiza el indicador de yield, pestañas de voltaje y heatmap", () => {
    const dashboard = new CornerAnalysisDashboard({
      getPvtResults: () => mockPvtResults,
      getCircuitTitle: () => "Buffer Digital",
      addLog,
    });

    dashboard.init();

    const yieldBadge = document.querySelector("#corner-yield-badge");
    expect(yieldBadge?.textContent).toContain("RENDIMIENTO (YIELD): 100.0%");

    const voltTabs = document.querySelector("#corner-volt-tabs");
    expect(voltTabs?.children.length).toBeGreaterThan(0);

    const specsList = document.querySelector("#corner-specs-list");
    expect(specsList?.children.length).toBeGreaterThan(0);
  });

  it("exporta matriz PVT a CSV correctamente", () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-csv");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const dashboard = new CornerAnalysisDashboard({
      getPvtResults: () => mockPvtResults,
      getCircuitTitle: () => "Buffer Digital",
      addLog,
    });

    dashboard.init();
    dashboard.exportCsv();

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(addLog).toHaveBeenCalledWith(
      expect.stringContaining("Reporte de esquinas PVT exportado exitosamente a CSV"),
      "receive",
    );
  });
});
