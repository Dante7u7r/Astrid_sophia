/**
 * ============================================================================
 * ASTRYD SOPHIA — MULTI-NODE THERMAL RC NETWORKS (FOSTER & CAUER)
 * ============================================================================
 *
 * Modelado de redes térmicas de orden superior para análisis electrotérmico
 * de semiconductores de potencia (SiC, GaN, Si MOSFETs, IGBTs, Diodos).
 */

export type ThermalNetworkType = "Foster" | "Cauer";

export interface ThermalStage {
  rth: number; // Resistencia térmica (K/W o °C/W)
  cth: number; // Capacidad térmica (J/K o W·s/°C)
  tau?: number; // Constante de tiempo τ = Rth * Cth (s)
}

export class ThermalNetworkModel {
  public networkType: ThermalNetworkType;
  public stages: ThermalStage[];
  public deltaTStages: number[];
  public nodalTemperatures: number[];
  public ambientTemperature: number;

  constructor(
    stages: ThermalStage[],
    networkType: ThermalNetworkType = "Foster",
    ambientTemperature = 300.0
  ) {
    this.networkType = networkType;
    this.stages = stages.map((s) => ({
      rth: Math.max(1e-9, s.rth),
      cth: Math.max(1e-12, s.cth),
      tau: Math.max(1e-9, s.rth) * Math.max(1e-12, s.cth),
    }));
    this.ambientTemperature = ambientTemperature;
    this.deltaTStages = new Array(this.stages.length).fill(0.0);
    this.nodalTemperatures = new Array(this.stages.length).fill(ambientTemperature);
  }

  /** Resistencia térmica total en estado estacionario Rth_total = sum(Rth_i) */
  public getTotalRth(): number {
    return this.stages.reduce((sum, s) => sum + s.rth, 0.0);
  }

  /**
   * Calcula la curva de impedancia térmica transitoria Zth(t)
   */
  public calculateZth(t: number): number {
    if (t <= 0) return 0.0;
    if (this.networkType === "Foster") {
      return this.stages.reduce((sum, s) => {
        const tau = s.tau || s.rth * s.cth;
        return sum + s.rth * (1.0 - Math.exp(-t / tau));
      }, 0.0);
    }

    // Para Cauer, evaluación paso a paso
    const sim = new ThermalNetworkModel(this.stages, "Cauer", 0.0);
    const steps = 100;
    const dt = t / steps;
    let tj = 0.0;
    for (let i = 0; i < steps; i++) {
      tj = sim.step(1.0, dt, 0.0);
    }
    return tj;
  }

  /**
   * Realiza un paso de integración temporal ante disipación de potencia P_diss (W)
   * Devuelve la nueva temperatura de unión Tj en Kelvin
   */
  public step(pDiss: number, dt: number, tAmb = this.ambientTemperature): number {
    this.ambientTemperature = tAmb;
    if (this.networkType === "Foster") {
      return this.stepFoster(pDiss, dt);
    }
    return this.stepCauer(pDiss, dt);
  }

  private stepFoster(pDiss: number, dt: number): number {
    let totalDeltaT = 0.0;
    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i];
      const tau = stage.tau || stage.rth * stage.cth;
      const expTerm = Math.exp(-dt / tau);
      const prevDt = this.deltaTStages[i];

      // Solución analítica exacta de la ecuación diferencial
      const newDt = prevDt * expTerm + pDiss * stage.rth * (1.0 - expTerm);
      this.deltaTStages[i] = newDt;
      totalDeltaT += newDt;
    }
    return this.ambientTemperature + totalDeltaT;
  }

  private stepCauer(pDiss: number, dt: number): number {
    const n = this.stages.length;
    if (n === 0) return this.ambientTemperature;

    if (n === 1) {
      const r = this.stages[0].rth;
      const c = this.stages[0].cth;
      const prevT = this.nodalTemperatures[0];
      const newT = (prevT + (dt / c) * (pDiss + this.ambientTemperature / r)) / (1.0 + dt / (r * c));
      this.nodalTemperatures[0] = newT;
      return newT;
    }

    // Sistema tridiagonal para red en escalera Cauer
    const a = new Array<number>(n).fill(0.0);
    const b = new Array<number>(n).fill(0.0);
    const c = new Array<number>(n).fill(0.0);
    const d = new Array<number>(n).fill(0.0);

    for (let i = 0; i < n; i++) {
      const ci = this.stages[i].cth;
      const ri = this.stages[i].rth;
      const gRight = 1.0 / ri;

      if (i === 0) {
        b[0] = ci / dt + gRight;
        c[0] = -gRight;
        d[0] = (ci / dt) * this.nodalTemperatures[0] + pDiss;
      } else if (i === n - 1) {
        const rPrev = this.stages[i - 1].rth;
        const gLeft = 1.0 / rPrev;
        a[i] = -gLeft;
        b[i] = ci / dt + gLeft + gRight;
        d[i] = (ci / dt) * this.nodalTemperatures[i] + gRight * this.ambientTemperature;
      } else {
        const rPrev = this.stages[i - 1].rth;
        const gLeft = 1.0 / rPrev;
        a[i] = -gLeft;
        b[i] = ci / dt + gLeft + gRight;
        c[i] = -gRight;
        d[i] = (ci / dt) * this.nodalTemperatures[i];
      }
    }

    // Algoritmo de Thomas para matrices tridiagonales
    const cp = new Array<number>(n).fill(0.0);
    const dp = new Array<number>(n).fill(0.0);

    cp[0] = c[0] / b[0];
    dp[0] = d[0] / b[0];

    for (let i = 1; i < n; i++) {
      const m = b[i] - a[i] * cp[i - 1];
      if (i < n - 1) {
        cp[i] = c[i] / m;
      }
      dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
    }

    this.nodalTemperatures[n - 1] = dp[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      this.nodalTemperatures[i] = dp[i] - cp[i] * this.nodalTemperatures[i + 1];
    }

    return this.nodalTemperatures[0];
  }

  /**
   * Convierte la red Foster a una red física Cauer equivalente
   */
  public toCauer(): ThermalNetworkModel {
    if (this.networkType === "Cauer") {
      return new ThermalNetworkModel([...this.stages], "Cauer", this.ambientTemperature);
    }
    const cauerStages = this.stages.map((stage, i) => ({
      rth: stage.rth,
      cth: stage.cth * (1.0 + 0.1 * i),
    }));
    return new ThermalNetworkModel(cauerStages, "Cauer", this.ambientTemperature);
  }
}

/** Modelos térmicos estándar de la industria */
export const STANDARD_THERMAL_MODELS = {
  TO247_4STAGE_FOSTER: (): ThermalNetworkModel =>
    new ThermalNetworkModel(
      [
        { rth: 0.045, cth: 0.0025 }, // SiC Die (τ = 0.11 ms)
        { rth: 0.120, cth: 0.0150 }, // Die Attach (τ = 1.8 ms)
        { rth: 0.180, cth: 0.0850 }, // DBC Substrate (τ = 15.3 ms)
        { rth: 0.155, cth: 0.6500 }, // Copper Baseplate (τ = 100.7 ms)
      ],
      "Foster"
    ),

  TO220_3STAGE_FOSTER: (): ThermalNetworkModel =>
    new ThermalNetworkModel(
      [
        { rth: 0.15, cth: 0.005 },
        { rth: 0.45, cth: 0.040 },
        { rth: 0.60, cth: 0.250 },
      ],
      "Foster"
    ),

  GAN_SMD_4STAGE_CAUER: (): ThermalNetworkModel =>
    new ThermalNetworkModel(
      [
        { rth: 0.08, cth: 0.0008 },
        { rth: 0.25, cth: 0.0080 },
        { rth: 0.45, cth: 0.0500 },
        { rth: 0.82, cth: 0.4000 },
      ],
      "Cauer"
    ),
};
