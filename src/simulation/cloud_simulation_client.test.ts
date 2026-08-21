import { describe, expect, it } from "vitest";
import {
  CloudSimulationClient,
  type CloudSimulationRequest,
  type CloudSimulationFrame,
} from "./cloud_simulation_client";

describe("Cloud Simulation Offload (gRPC / Streaming)", () => {
  const mockNetlist = {
    components: [
      { id: "V1", type: "vsource", value: 5.0, pins: ["1", "0"] },
      { id: "R1", type: "resistor", value: 1000, pins: ["1", "2"] },
      { id: "C1", type: "capacitor", value: 1e-6, pins: ["2", "0"] },
    ],
  };

  describe("1. Health Check and Remote Latency", () => {
    it("verifica disponibilidad, trabajadores activos y latencia del cluster remoto", async () => {
      const client = new CloudSimulationClient();

      client.setCustomTransport(async () => {});

      const health = await client.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.activeWorkers).toBeGreaterThan(0);
      expect(health.serverVersion).toContain("rust");
    });
  });

  describe("2. Complexity Heuristics for Auto-Offload", () => {
    it("descarga a la nube si el número de componentes excede el umbral", () => {
      const client = new CloudSimulationClient({ offloadComplexityThreshold: 10 });
      const smallNetlist = { components: Array.from({ length: 5 }, (_, i) => ({ id: `R${i}`, type: "resistor", value: 1000, pins: ["1", "0"] })) };
      const largeNetlist = { components: Array.from({ length: 15 }, (_, i) => ({ id: `R${i}`, type: "resistor", value: 1000, pins: ["1", "0"] })) };

      expect(client.shouldOffload(smallNetlist as any, "TRAN")).toBe(false);
      expect(client.shouldOffload(largeNetlist as any, "TRAN")).toBe(true);
    });

    it("descarga análisis masivos de Monte Carlo o modos analíticos intensivos (PSS, SENSITIVITY)", () => {
      const client = new CloudSimulationClient();
      expect(client.shouldOffload(mockNetlist as any, "MONTE_CARLO", { monteCarloRuns: 500 })).toBe(true);
      expect(client.shouldOffload(mockNetlist as any, "PSS")).toBe(true);
      expect(client.shouldOffload(mockNetlist as any, "SENSITIVITY")).toBe(true);
      expect(client.shouldOffload(mockNetlist as any, "TRAN", { tMax: 1.0, dt: 1e-6 })).toBe(true); // 1,000,000 pasos
    });
  });

  describe("3. Streaming Simulation Execution", () => {
    it("transmite cuadros de resultados en tiempo real y calcula telemetría de throughput", async () => {
      const client = new CloudSimulationClient();

      // Configurar transporte simulado de streaming gRPC
      client.setCustomTransport(async (req, callbacks, signal) => {
        const totalSteps = 10;
        for (let i = 0; i <= totalSteps; i++) {
          if (signal.aborted) break;

          const t = i * req.dt;
          const isFinal = i === totalSteps;
          const progress = (i / totalSteps) * 100;

          const frame: CloudSimulationFrame = {
            runId: 1001,
            frameIndex: i,
            time: t,
            progressPercent: progress,
            nodeVoltages: { "1": 5.0, "2": 5.0 * (1 - Math.exp(-t / 0.001)) },
            branchCurrents: { V1: -0.005 },
            isFinal,
            telemetry: {
              pointsPerSecond: 150000,
              solverIterations: 1,
              memoryUsageMb: 8.5,
              computeTimeMs: 2.3,
              workerThreads: 16,
            },
          };

          callbacks.onFrame(frame);
          callbacks.onProgress?.(progress, 150000);

          if (isFinal) {
            callbacks.onComplete?.(totalSteps + 1, 2.3);
          }
        }
      });

      const framesReceived: CloudSimulationFrame[] = [];
      let completedPoints = 0;
      let lastProgress = 0;

      const request: CloudSimulationRequest = {
        circuitId: "test_rc",
        netlist: mockNetlist as any,
        mode: "TRAN",
        dt: 1e-4,
        tMax: 1e-3,
        tolerance: 1e-6,
        maxIterations: 100,
      };

      const handle = await client.startRemoteStream(request, {
        onFrame: (f) => framesReceived.push(f),
        onProgress: (p) => { lastProgress = p; },
        onComplete: (total) => { completedPoints = total; },
      });

      expect(handle.runId).toBeGreaterThanOrEqual(1000);
      expect(framesReceived.length).toBe(11);
      expect(framesReceived[0].time).toBe(0.0);
      expect(framesReceived[10].isFinal).toBe(true);
      expect(lastProgress).toBe(100);
      expect(completedPoints).toBe(11);
    });

    it("soporta cancelación inmediata de la transmisión de simulación", async () => {
      const client = new CloudSimulationClient();

      client.setCustomTransport(async (_req, callbacks, signal) => {
        for (let i = 0; i < 100; i++) {
          if (signal.aborted) return;
          callbacks.onFrame({
            runId: 1002,
            frameIndex: i,
            time: i * 1e-5,
            progressPercent: i,
            nodeVoltages: { "1": 5.0 },
            branchCurrents: {},
            isFinal: false,
          });
        }
      });

      const received: CloudSimulationFrame[] = [];
      const handle = await client.startRemoteStream(
        {
          circuitId: "long_run",
          netlist: mockNetlist as any,
          mode: "TRAN",
          dt: 1e-5,
          tMax: 1.0,
          tolerance: 1e-6,
          maxIterations: 100,
        },
        {
          onFrame: (f) => {
            received.push(f);
            if (received.length === 5) {
              handle.abort();
            }
          },
        }
      );

      expect(handle.isRunning()).toBe(false);
      expect(received.length).toBe(5);
    });
  });
});
