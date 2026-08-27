import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseCircuitFile } from "../persistence/circuit_file";
import { solveCircuitTS } from "./fallback_solver";
import type { CircuitNetlist } from "./netlist_extractor";

describe("Demo Circuits E2E Oracle & Integrity Suite", () => {
  const demosDir = path.resolve(__dirname, "../../public/demos");
  const demoFiles = [
    "01_filtro_rc.astryd",
    "02_puente_rectificador.astryd",
    "03_arduino_led.astryd",
    "04_amp_bjt_bode.astryd",
    "05_amplificador_opamp.astryd",
    "06_inversor_cmos.astryd",
    "07_rlc_resonante.astryd",
    "08_control_rele_interactivo.astryd",
    "09_integrador_opamp.astryd",
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

  it("Demo 01_filtro_rc must solve DC operating point correctly via TypeScript Fallback Solver", () => {
    const netlist: CircuitNetlist = {
      components: [
        { id: "V1", type: "vsource", value: 5.0, pins: ["1", "0"], waveType: "square", frequency: 100, amplitude: 5, offset: 0 },
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
        { id: "C1", type: "capacitor", value: 0.000001, pins: ["2", "0"] },
      ],
      nodes: ["0", "1", "2"],
      groundNode: "0",
    };

    const res = solveCircuitTS(netlist);
    expect(typeof res).not.toBe("string");
    if (typeof res !== "string") {
      expect(res.nodeVoltages["1"]).toBeCloseTo(5.0, 1);
      expect(res.nodeVoltages["2"]).toBeCloseTo(5.0, 1); // DC steady state: capacitor open
    }
  });
});
