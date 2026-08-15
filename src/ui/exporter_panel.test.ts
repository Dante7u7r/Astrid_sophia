// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { OscilloscopePanel } from "./oscilloscope_panel";
import { ExporterPanel } from "./exporter_panel";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ExporterPanel", () => {
  it("exporta HDF5 Lite transitorio con metadata tipada", () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-h5");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const addLog = vi.fn();

    const oscilloscopePanel = {
      transientResults: [
        { time: 0, nodeVoltages: { "1": 0, "2": 1 }, branchCurrents: {} },
        { time: 0.001, nodeVoltages: { "1": 5, "2": 2.5 }, branchCurrents: {} },
      ],
      acSweepResults: null,
      ch1ProbeNode: "1",
      ch2ProbeNode: "2",
    } as unknown as OscilloscopePanel;

    const panel = new ExporterPanel({
      getOscilloscopePanel: () => oscilloscopePanel,
      getActiveAnalysisMode: () => "TRAN",
      getProbeNodes: () => ({ ch1: "1", ch2: "2" }),
      getVoltageMap: () => ({}),
      addLog,
    });

    panel.exportarDatosHDF5();

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    const link = document.querySelector<HTMLAnchorElement>("a[download]");
    expect(link).toBeNull();
    expect(addLog).toHaveBeenCalledWith(
      "Datos binarios exportados a formato HDF5 Lite (.h5) en reporte_transitorio.h5",
      "receive",
    );
  });

  it("exporta plano esquemático vectorial CAD SVG", () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-svg");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const addLog = vi.fn();

    const panel = new ExporterPanel({
      getOscilloscopePanel: () => null,
      getActiveAnalysisMode: () => "DC",
      getProbeNodes: () => ({ ch1: null, ch2: null }),
      getVoltageMap: () => ({}),
      addLog,
      getComponents: () => [
        { id: "R1", type: "resistor", value: 1000, x: 100, y: 100, rotation: 0 },
      ],
      getWires: () => [],
      getCircuitTitle: () => "Circuito de Prueba",
    });

    panel.exportarEsquemaCAD_SVG("print_clean");

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(addLog).toHaveBeenCalledWith(
      expect.stringContaining("Plano esquemático vectorial CAD exportado exitosamente"),
      "receive",
    );
  });

  it("exporta lista de materiales BOM CSV", () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-csv");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const addLog = vi.fn();

    const panel = new ExporterPanel({
      getOscilloscopePanel: () => null,
      getActiveAnalysisMode: () => "DC",
      getProbeNodes: () => ({ ch1: null, ch2: null }),
      getVoltageMap: () => ({}),
      addLog,
      getComponents: () => [
        { id: "R1", type: "resistor", value: 1000, x: 100, y: 100, rotation: 0 },
        { id: "R2", type: "resistor", value: 1000, x: 200, y: 100, rotation: 0 },
      ],
      getWires: () => [],
      getCircuitTitle: () => "Amplificador",
    });

    panel.exportarListaMaterialesBOM();

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(addLog).toHaveBeenCalledWith(
      expect.stringContaining("Lista de Materiales (BOM) exportada exitosamente"),
      "receive",
    );
  });
});
