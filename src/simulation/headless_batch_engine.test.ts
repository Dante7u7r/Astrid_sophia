import { describe, expect, it } from "vitest";
import {
  parseCliArgs,
  loadCircuitAndExtractNetlist,
  runHeadlessSimulation,
  exportResultsToCsv,
  exportResultsToJson,
  formatHeadlessSummary,
} from "./headless_batch_engine";
import { serializeCircuitFile, createEmptyCircuitSnapshot } from "../persistence/circuit_file";

describe("Headless Batch Simulation Mode (CLI)", () => {
  describe("1. CLI Arguments Parser", () => {
    it("parsea argumentos por defecto y banderas personalizadas", () => {
      const args = [
        "--run", "circuits/rc_filter.astryd",
        "--mode", "TRAN",
        "--output", "results/output.csv",
        "--dt", "1e-6",
        "--tmax", "0.005",
        "--verbose",
      ];

      const opts = parseCliArgs(args);
      expect(opts.circuitPath).toBe("circuits/rc_filter.astryd");
      expect(opts.mode).toBe("TRAN");
      expect(opts.outputPath).toBe("results/output.csv");
      expect(opts.outputFormat).toBe("csv");
      expect(opts.dt).toBe(1e-6);
      expect(opts.tMax).toBe(0.005);
      expect(opts.verbose).toBe(true);
      expect(opts.disablePacing).toBe(true);
    });

    it("detecta formato JSON según extensión del archivo de salida", () => {
      const args = ["-r", "test.astryd", "-o", "data.json", "-m", "DC"];
      const opts = parseCliArgs(args);
      expect(opts.outputFormat).toBe("json");
      expect(opts.mode).toBe("DC");
    });
  });

  describe("2. Circuit Loading and Netlist Extraction", () => {
    it("carga esquema válido y extrae netlist eléctrico", () => {
      const circuitJson = JSON.stringify({
        version: "3.0",
        components: [
          {
            id: "V1",
            type: "vsource",
            x: 100,
            y: 100,
            rotation: 0,
            value: 5.0,
            label: "V1",
            pins: [{ id: "0", name: "+", type: "passive", direction: "up", x: 100, y: 80 }, { id: "1", name: "-", type: "passive", direction: "down", x: 100, y: 120 }],
          },
          {
            id: "R1",
            type: "resistor",
            x: 200,
            y: 100,
            rotation: 0,
            value: 1000,
            label: "R1",
            pins: [{ id: "0", name: "1", type: "passive", direction: "left", x: 180, y: 100 }, { id: "1", name: "2", type: "passive", direction: "right", x: 220, y: 100 }],
          },
          {
            id: "GND1",
            type: "ground",
            x: 100,
            y: 200,
            rotation: 0,
            value: 0,
            label: "GND",
            pins: [{ id: "0", name: "GND", type: "passive", direction: "up", x: 100, y: 180 }],
          },
        ],
        wires: [
          {
            id: "W1",
            from: { componentId: "V1", pinIndex: 0 },
            to: { componentId: "R1", pinIndex: 0 },
            points: [],
          },
          {
            id: "W2",
            from: { componentId: "R1", pinIndex: 1 },
            to: { componentId: "GND1", pinIndex: 0 },
            points: [],
          },
          {
            id: "W3",
            from: { componentId: "V1", pinIndex: 1 },
            to: { componentId: "GND1", pinIndex: 0 },
            points: [],
          },
        ],
      });

      const res = loadCircuitAndExtractNetlist(circuitJson);

      expect(res.error).toBeUndefined();
      expect(res.netlist).toBeDefined();
      expect(res.netlist!.components.length).toBe(3);
    });

    it("reporta error en archivo corrupto o vacío", () => {
      const res = loadCircuitAndExtractNetlist("{ invalid json");
      expect(res.error).toBeDefined();
    });
  });

  describe("3. Simulation Execution and Results Export", () => {
    it("ejecuta simulación TRAN headless a máxima velocidad con disablePacing", async () => {
      const netlist = {
        components: [
          { id: "V1", type: "vsource", value: 5.0, pins: ["1", "0"] },
          { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
          { id: "C1", type: "capacitor", value: 1e-6, pins: ["2", "0"] },
        ],
      };

      const opts = parseCliArgs(["--mode", "TRAN", "--dt", "1e-5", "--tmax", "0.001"]);
      const res = await runHeadlessSimulation(opts, netlist);

      expect(res.success).toBe(true);
      expect(res.totalPoints).toBeGreaterThan(50);
      expect(res.pointsPerSecond).toBeGreaterThan(0);
      expect(res.nodeNames).toContain("1");
      expect(res.nodeNames).toContain("2");

      const csv = exportResultsToCsv(res);
      expect(csv).toContain("time,V(1),V(2)");
      expect(csv.split("\n").length).toBeGreaterThan(50);

      const json = exportResultsToJson(res);
      expect(json).toContain('"success": true');

      const summary = formatHeadlessSummary(res);
      expect(summary).toContain("HEADLESS BATCH SIMULATION REPORT");
      expect(summary).toContain("CONVERGIDO");
    });

    it("ejecuta análisis DC de punto de operación", async () => {
      const netlist = {
        components: [
          { id: "V1", type: "vsource", value: 10.0, pins: ["1", "0"] },
          { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
          { id: "R2", type: "resistor", value: 1000, pins: ["2", "0"] },
        ],
      };

      const opts = parseCliArgs(["--mode", "DC"]);
      const res = await runHeadlessSimulation(opts, netlist);

      expect(res.success).toBe(true);
      expect(res.dcResults?.nodeVoltages["1"]).toBeCloseTo(10.0, 4);
      expect(res.dcResults?.nodeVoltages["2"]).toBeCloseTo(5.0, 4);

      const csv = exportResultsToCsv(res);
      expect(csv).toContain("V(1),10.000000,V");
      expect(csv).toContain("V(2),5.000000,V");
    });

    it("ejecuta barrido de frecuencia AC", async () => {
      const netlist = {
        components: [
          { id: "V1", type: "vsource", value: 1.0, pins: ["1", "0"] },
          { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
        ],
      };

      const opts = parseCliArgs(["--mode", "AC"]);
      const res = await runHeadlessSimulation(opts, netlist);

      expect(res.success).toBe(true);
      expect(res.acResults?.frequencies.length).toBe(50);

      const csv = exportResultsToCsv(res);
      expect(csv).toContain("frequency_hz,magnitude_db,phase_deg");
    });
  });
});
