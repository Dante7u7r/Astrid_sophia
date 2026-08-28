import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseCircuitFile } from "../persistence/circuit_file";
import { solveCircuitTS } from "./fallback_solver";
import type { CircuitNetlist } from "./netlist_extractor";

describe("Demo Circuits E2E Oracle & Integrity Suite", () => {
  const demosDir = path.resolve(__dirname, "../../public/demos");
  const demoFiles = [
    "01_amplificador_no_inversor.astryd",
    "02_rectificador_filtro_c.astryd",
    "03_puente_wheatstone_desbalanceado.astryd",
    "04_detector_cruce_por_cero_basico.astryd",
    "05_detector_cruce_por_cero_aislado.astryd",
  ];

  it.each(demoFiles)("Demo '%s' must be valid, well-formed and parse cleanly", (fileName) => {
    const filePath = path.join(demosDir, fileName);
    expect(fs.existsSync(filePath)).toBe(true);

    const rawContent = fs.readFileSync(filePath, "utf-8");
    const parsed = parseCircuitFile(rawContent);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.components.length).toBeGreaterThan(0);
      expect(parsed.data.wires.length).toBeGreaterThan(0);
      expect(parsed.data.simSettings).toBeDefined();
      expect(parsed.data.simSettings.dt).toBeGreaterThan(0);
    }
  });

  it("Demo 03_puente_wheatstone_desbalanceado must solve DC operating point correctly", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "V1", type: "vsource", value: 30.0, pins: ["1", "0"] },
        { id: "R1", type: "resistor", value: 10000, pins: ["1", "2"] },
        { id: "R2", type: "resistor", value: 10000, pins: ["2", "0"] },
        { id: "R3", type: "resistor", value: 20000, pins: ["1", "3"] },
        { id: "R4", type: "resistor", value: 10000, pins: ["3", "0"] },
      ],
      nodes: ["0", "1", "2", "3"],
      groundNode: "0",
    };

    const res = solveCircuitTS(netlist);
    expect(typeof res).not.toBe("string");
    if (typeof res !== "string") {
      expect(res.nodeVoltages["1"]).toBeCloseTo(30.0, 2);
      expect(res.nodeVoltages["2"]).toBeCloseTo(15.0, 2); // 30 * 10k/(10k+10k) = 15V
      expect(res.nodeVoltages["3"]).toBeCloseTo(10.0, 2); // 30 * 10k/(20k+10k) = 10V
    }
  });
});
