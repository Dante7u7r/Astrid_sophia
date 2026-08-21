import { describe, expect, it } from "vitest";
import { WasmPluginHost } from "./wasm_plugin_host";
import type { AstrydPlugin, CustomDeviceModel } from "./wasm_plugin_api";

describe("WASM & Extensible Plugin API", () => {
  describe("1. Plugin Host & Registry Lifecycle", () => {
    it("inicializa plugins de referencia integrados (Memristor, Power THD, VCD, MATLAB)", () => {
      const host = new WasmPluginHost(true);
      const allPlugins = host.getAllPlugins();

      expect(allPlugins.length).toBe(4);
      expect(host.getDeviceModel("memristor_hp")).toBeDefined();
      expect(host.getPostProcessor("org.astryd.postproc.power-thd")).toBeDefined();
      expect(host.getExportFormat("org.astryd.export.vcd")).toBeDefined();
      expect(host.getExportFormat("org.astryd.export.matlab")).toBeDefined();
    });

    it("permite registrar y desregistrar plugins dinámicamente", () => {
      const host = new WasmPluginHost(false);
      expect(host.getAllPlugins().length).toBe(0);

      const customPlugin: AstrydPlugin = {
        manifest: {
          id: "custom.sensor.photodiode",
          name: "Photodiode Optical Sensor",
          version: "1.0.0",
          author: "Researcher",
          description: "Modelo de fotodiodo con corriente fotogenerada I_ph(Lux)",
          type: "custom-device",
        },
        deviceModel: {
          deviceType: "photodiode",
          displayName: "Fotodiodo",
          pinCount: 2,
          pinNames: ["A", "K"],
          stateSize: 1,
          defaultParams: { lux: 1000 },
          initState: () => new Float64Array([1000]),
          evaluate: (v, s) => ({
            currents: new Float64Array([0.001 * s[0], -0.001 * s[0]]),
            conductanceMatrix: new Float64Array([1e-6, -1e-6, -1e-6, 1e-6]),
          }),
        },
      };

      host.registerPlugin(customPlugin);
      expect(host.getAllPlugins().length).toBe(1);
      expect(host.getDeviceModel("photodiode")).toBeDefined();

      const unregistered = host.unregisterPlugin("custom.sensor.photodiode");
      expect(unregistered).toBe(true);
      expect(host.getAllPlugins().length).toBe(0);
      expect(host.getDeviceModel("photodiode")).toBeUndefined();
    });
  });

  describe("2. Custom Device Model (HP Memristor)", () => {
    it("evalúa dinámica de estado y matriz Jacobiana del memristor", () => {
      const host = new WasmPluginHost(true);
      const memModel = host.getDeviceModel("memristor_hp");
      expect(memModel).toBeDefined();

      const initialStates = memModel!.initState({});
      expect(initialStates[0]).toBeCloseTo(0.1, 4);

      // Aplicar 1V positivo durante 1ms -> debe aumentar x (más conductor)
      const voltages = new Float64Array([1.0, 0.0]); // 1V
      const dt = 1e-4; // 0.1 ms
      const evalRes = host.evaluateDevice("memristor_hp", voltages, initialStates, dt, 0.001, 25, {});

      expect(evalRes).not.toBeNull();
      expect(evalRes!.currents.length).toBe(2);
      // Ley de Corrientes de Kirchhoff (KCL)
      expect(evalRes!.currents[0] + evalRes!.currents[1]).toBeCloseTo(0.0, 8);
      expect(evalRes!.currents[0]).toBeGreaterThan(0); // Corriente positiva entra por terminal +

      // Matriz Jacobiana 2x2 simétrica
      const gMat = evalRes!.conductanceMatrix;
      expect(gMat[0]).toBeGreaterThan(0); // G_00
      expect(gMat[0]).toBeCloseTo(-gMat[1], 8); // G_01 = -G_00
      expect(gMat[3]).toBeCloseTo(gMat[0], 8); // G_11 = G_00

      // El estado interno debe evolucionar
      expect(evalRes!.nextStates![0]).toBeGreaterThanOrEqual(initialStates[0]);
    });
  });

  describe("3. Analysis Post-Processing (Power & THD Analyzer)", () => {
    it("calcula potencia instantánea, activa, reactiva, factor de potencia y THD", () => {
      const host = new WasmPluginHost(true);
      const postProc = host.getPostProcessor("org.astryd.postproc.power-thd");
      expect(postProc).toBeDefined();

      const n = 100;
      const times = new Float64Array(n);
      const vSignals = new Float64Array(n);
      const iSignals = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        const t = (i / n) * 0.02; // 20 ms (50 Hz)
        times[i] = t;
        vSignals[i] = 230.0 * Math.sqrt(2) * Math.sin(2 * Math.PI * 50 * t);
        // Carga resistiva pura -> en fase
        iSignals[i] = 10.0 * Math.sqrt(2) * Math.sin(2 * Math.PI * 50 * t);
      }

      const output = host.executePostProcessor("org.astryd.postproc.power-thd", {
        mode: "TRAN",
        time: times,
        nodeVoltages: { "1": vSignals },
        branchCurrents: { V1: iSignals },
      });

      expect(output).not.toBeNull();
      expect(output!.metrics.active_power).toBeDefined();
      expect(output!.metrics.active_power.value).toBeCloseTo(2300.0, -1); // ~2300 W
      expect(output!.metrics.power_factor.value).toBeCloseTo(1.0, 2); // Factor de potencia unitario
      expect(output!.metrics.power_factor.pass).toBe(true);
      expect(output!.series.instantaneous_power).toBeDefined();
      expect(output!.series.instantaneous_power.y.length).toBe(n);
    });
  });

  describe("4. Custom Export Formats (VCD & MATLAB)", () => {
    const mockNetlist = {
      components: [
        { id: "V1", type: "vsource", value: 5.0, pins: ["1", "0"] },
        { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
      ],
    };

    const mockTransientResults = [
      { time: 0.0, nodeVoltages: { "1": 5.0, "2": 0.0 }, branchCurrents: { V1: -0.005 } },
      { time: 1e-4, nodeVoltages: { "1": 5.0, "2": 2.5 }, branchCurrents: { V1: -0.0025 } },
      { time: 2e-4, nodeVoltages: { "1": 5.0, "2": 4.0 }, branchCurrents: { V1: -0.001 } },
    ];

    it("exporta señales al formato estándar IEEE 1364 VCD para GTKWave", async () => {
      const host = new WasmPluginHost(true);
      const res = await host.executeExport("org.astryd.export.vcd", {
        netlist: mockNetlist,
        transientResults: mockTransientResults,
      });

      expect(res).not.toBeNull();
      expect(res!.filename).toBe("simulation_output.vcd");
      expect(res!.mimeType).toBe("text/plain");
      const content = String(res!.content);
      expect(content).toContain("$date");
      expect(content).toContain("$timescale 1ns $end");
      expect(content).toContain("$var real 64");
      expect(content).toContain("$dumpvars");
      expect(content).toContain("#100000"); // 1e-4 s = 100,000 ns
    });

    it("exporta script ejecutable de MATLAB / Octave (.m)", async () => {
      const host = new WasmPluginHost(true);
      const res = await host.executeExport("org.astryd.export.matlab", {
        netlist: mockNetlist,
        transientResults: mockTransientResults,
      });

      expect(res).not.toBeNull();
      expect(res!.filename).toBe("circuit_simulation.m");
      expect(res!.mimeType).toBe("text/x-matlab");
      const content = String(res!.content);
      expect(content).toContain("t = [0.00000000, 0.00010000, 0.00020000];");
      expect(content).toContain("V_1 = [5.000000, 5.000000, 5.000000];");
      expect(content).toContain("plot(t * 1e3, V_1");
      expect(content).toContain("legend('show'");
    });
  });

  describe("5. WebAssembly (WASM) Binary Module Instantiation", () => {
    it("instancia módulo WASM binario y expone modelo de dispositivo", async () => {
      // Bytecode binario de un módulo WASM mínimo válido que exporta una función 'evaluate_device'
      // (module (func (export "evaluate_device") (param f64 f64 f64 f64) (result f64) local.get 0))
      const wasmBytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, // \0asm (magic)
        0x01, 0x00, 0x00, 0x00, // version 1
        // Type section (1)
        0x01, 0x09, 0x01, 0x60, 0x04, 0x7c, 0x7c, 0x7c, 0x7c, 0x01, 0x7c,
        // Function section (3)
        0x03, 0x02, 0x01, 0x00,
        // Export section (7)
        0x07, 0x13, 0x01, 0x0f, 0x65, 0x76, 0x61, 0x6c, 0x75, 0x61, 0x74, 0x65, 0x5f, 0x64, 0x65, 0x76, 0x69, 0x63, 0x65, 0x00, 0x00,
        // Code section (10)
        0x0a, 0x06, 0x01, 0x04, 0x00, 0x20, 0x00, 0x0b,
      ]);

      const host = new WasmPluginHost(false);
      const plugin = await host.loadWasmPlugin(wasmBytes, {
        id: "org.astryd.wasm.custom-tunnel-diode",
        name: "WASM Tunnel Diode",
        version: "1.0.0",
        author: "WASM Physicist",
        description: "Modelo de diodo túnel implementado en WebAssembly nativo.",
        type: "custom-device",
        wasmSupported: true,
      });

      expect(plugin).toBeDefined();
      expect(plugin.wasmInstance).toBeDefined();
      expect(plugin.deviceModel).toBeDefined();

      const evalRes = host.evaluateDevice(
        "org.astryd.wasm.custom-tunnel-diode",
        new Float64Array([0.5, 0.0]),
        new Float64Array([0]),
        1e-5,
        0.001,
        25,
        {}
      );

      expect(evalRes).not.toBeNull();
      expect(evalRes!.currents[0]).toBeCloseTo(0.5, 4);
    });
  });
});
