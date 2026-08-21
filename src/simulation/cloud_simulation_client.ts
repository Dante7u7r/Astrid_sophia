/**
 * Astryd Sophia — Cliente de Simulación Remota en la Nube (gRPC / Streaming)
 *
 * Permite descargar el cómputo de netlists grandes o análisis intensivos
 * (Monte Carlo masivo, PSS, RF multi-puerto, matrices dispersas gigantescas)
 * hacia un backend remoto de alto rendimiento en Rust, recibiendo los
 * resultados en streaming continuo en tiempo real.
 */

import type { CircuitNetlist } from "./netlist_extractor";

export type CloudAnalysisMode =
  | "TRAN"
  | "DC"
  | "AC"
  | "MONTE_CARLO"
  | "PSS"
  | "SENSITIVITY"
  | "NOISE";

export interface CloudSimulationRequest {
  readonly circuitId: string;
  readonly netlist: CircuitNetlist;
  readonly spiceNetlist?: string;
  readonly mode: CloudAnalysisMode;
  readonly dt: number;
  readonly tMax: number;
  readonly tolerance: number;
  readonly maxIterations: number;
  readonly monteCarloRuns?: number;
  readonly frequencies?: number[];
  readonly parameters?: Record<string, number>;
  readonly disablePacing?: boolean;
  readonly authToken?: string;
}

export interface CloudServerTelemetry {
  readonly pointsPerSecond: number;
  readonly solverIterations: number;
  readonly memoryUsageMb: number;
  readonly computeTimeMs: number;
  readonly workerThreads: number;
}

export interface CloudSimulationFrame {
  readonly runId: number;
  readonly frameIndex: number;
  readonly time: number;
  readonly progressPercent: number;
  readonly nodeVoltages: Readonly<Record<string, number>>;
  readonly branchCurrents: Readonly<Record<string, number>>;
  readonly isFinal: boolean;
  readonly errorMessage?: string;
  readonly telemetry?: CloudServerTelemetry;
}

export interface CloudStreamCallbacks {
  readonly onFrame: (frame: CloudSimulationFrame) => void;
  readonly onProgress?: (percent: number, pointsPerSec: number) => void;
  readonly onComplete?: (totalPoints: number, elapsedMs: number) => void;
  readonly onError?: (error: string) => void;
}

export interface CloudSimulationHandle {
  readonly runId: number;
  readonly abort: () => void;
  readonly isRunning: () => boolean;
}

export interface CloudHealthStatus {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly activeWorkers: number;
  readonly cpuLoadPercent: number;
  readonly serverVersion: string;
  readonly message?: string;
}

export interface CloudClientConfig {
  readonly endpointUrl?: string;
  readonly authToken?: string;
  readonly timeoutMs?: number;
  readonly enableAutoOffload?: boolean;
  readonly offloadComplexityThreshold?: number; // Component count threshold
}

export class CloudSimulationClient {
  private endpointUrl: string;
  private authToken: string;
  private timeoutMs: number;
  private enableAutoOffload: boolean;
  private complexityThreshold: number;

  private activeStreams = new Map<number, AbortController>();
  private nextRunId = 1000;

  // Mock transport handler para pruebas unitarias e integración en entornos sin gRPC nativo
  private customTransport?: (
    request: CloudSimulationRequest,
    callbacks: CloudStreamCallbacks,
    signal: AbortSignal,
  ) => Promise<void>;

  constructor(config: CloudClientConfig = {}) {
    this.endpointUrl = config.endpointUrl || "https://sim.astryd.cloud:50051";
    this.authToken = config.authToken || "";
    this.timeoutMs = config.timeoutMs || 30000;
    this.enableAutoOffload = config.enableAutoOffload ?? true;
    this.complexityThreshold = config.offloadComplexityThreshold || 50;
  }

  setEndpoint(url: string): void {
    this.endpointUrl = url;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  setCustomTransport(
    fn?: (
      request: CloudSimulationRequest,
      callbacks: CloudStreamCallbacks,
      signal: AbortSignal,
    ) => Promise<void>,
  ): void {
    this.customTransport = fn;
  }

  /**
   * Evalúa si un circuito amerita ser descargado a la nube según su complejidad computacional.
   */
  shouldOffload(
    netlist: CircuitNetlist,
    mode: string,
    options: { monteCarloRuns?: number; tMax?: number; dt?: number } = {},
  ): boolean {
    if (!this.enableAutoOffload) return false;

    // 1. Número de componentes superior al umbral
    const compCount = netlist.components.length;
    if (compCount >= this.complexityThreshold) return true;

    // 2. Análisis masivo de Monte Carlo (> 100 ejecuciones)
    if (mode === "MONTE_CARLO" || (options.monteCarloRuns && options.monteCarloRuns > 100)) {
      return true;
    }

    // 3. Modos analíticos de alto costo computacional (PSS, STB, SENSITIVITY)
    if (mode === "PSS" || mode === "SENSITIVITY" || mode === "NOISE") {
      return true;
    }

    // 4. Cantidad masiva de pasos temporales transitorios (> 200,000 pasos)
    if (options.tMax && options.dt && options.dt > 0) {
      const stepCount = options.tMax / options.dt;
      if (stepCount > 200000) return true;
    }

    return false;
  }

  /**
   * Verifica la latencia y disponibilidad del servidor gRPC remoto.
   */
  async checkHealth(): Promise<CloudHealthStatus> {
    const startTime = performance.now();

    try {
      if (this.customTransport) {
        // En entorno mock/test
        const latency = Math.max(1, performance.now() - startTime);
        return {
          healthy: true,
          latencyMs: latency,
          activeWorkers: 16,
          cpuLoadPercent: 24.5,
          serverVersion: "1.0.0-rust-tonic",
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs || 3000);

      const response = await fetch(`${this.endpointUrl}/health`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.authToken}`,
        },
      });

      clearTimeout(timeoutId);
      const latencyMs = performance.now() - startTime;

      if (!response.ok) {
        return {
          healthy: false,
          latencyMs,
          activeWorkers: 0,
          cpuLoadPercent: 0,
          serverVersion: "unknown",
          message: `Servidor respondió con código HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        healthy: data.status === "HEALTHY" || response.ok,
        latencyMs,
        activeWorkers: data.activeWorkers || 8,
        cpuLoadPercent: data.cpuLoadPercent || 10,
        serverVersion: data.serverVersion || "1.0.0-rust-tonic",
      };
    } catch (err: any) {
      const latencyMs = performance.now() - startTime;
      return {
        healthy: false,
        latencyMs,
        activeWorkers: 0,
        cpuLoadPercent: 0,
        serverVersion: "unreachable",
        message: err.message || "No se pudo conectar al endpoint remoto.",
      };
    }
  }

  /**
   * Inicia el streaming gRPC de simulación remota.
   */
  async startRemoteStream(
    request: CloudSimulationRequest,
    callbacks: CloudStreamCallbacks,
  ): Promise<CloudSimulationHandle> {
    const runId = ++this.nextRunId;
    const controller = new AbortController();
    this.activeStreams.set(runId, controller);

    let isRunning = true;

    const handle: CloudSimulationHandle = {
      runId,
      abort: () => {
        if (isRunning) {
          controller.abort();
          isRunning = false;
          this.activeStreams.delete(runId);
        }
      },
      isRunning: () => isRunning,
    };

    // Despachar en segundo plano
    (async () => {
      try {
        if (this.customTransport) {
          await this.customTransport(request, callbacks, controller.signal);
          isRunning = false;
          this.activeStreams.delete(runId);
          return;
        }

        // Transporte real HTTP/2 Streaming o gRPC-Web
        const response = await fetch(`${this.endpointUrl}/simulation/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.authToken || request.authToken || ""}`,
            "X-Astryd-Run-Id": String(runId),
          },
          body: JSON.stringify({
            ...request,
            runId,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Error en servidor de simulación: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let totalPointsReceived = 0;
        const simStartTime = performance.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const frame: CloudSimulationFrame = JSON.parse(trimmed);
              callbacks.onFrame(frame);
              totalPointsReceived++;

              if (callbacks.onProgress && frame.progressPercent !== undefined) {
                callbacks.onProgress(
                  frame.progressPercent,
                  frame.telemetry?.pointsPerSecond || 0,
                );
              }

              if (frame.isFinal) {
                const elapsed = performance.now() - simStartTime;
                callbacks.onComplete?.(totalPointsReceived, elapsed);
                break;
              }
            } catch (jsonErr) {
              // Ignorar fragmentos no JSON
            }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          // Cancelado deliberadamente por el usuario
          return;
        }
        callbacks.onError?.(err.message || "Fallo en la comunicación con el servidor remoto.");
      } finally {
        isRunning = false;
        this.activeStreams.delete(runId);
      }
    })();

    return handle;
  }

  /**
   * Cancela una simulación activa en el backend.
   */
  async cancelStream(runId: number): Promise<boolean> {
    const controller = this.activeStreams.get(runId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(runId);
      return true;
    }
    return false;
  }
}

export const globalCloudSimulationClient = new CloudSimulationClient();
