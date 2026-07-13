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
});
