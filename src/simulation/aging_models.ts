/**
 * ============================================================================
 * ASTRYD SOPHIA — SEMICONDUCTOR AGING & RELIABILITY MODELS (NBTI, PBTI, HCI)
 * ============================================================================
 *
 * Modelado físico de degradación y estimación de vida útil (Lifetime / TTF)
 * en circuitos integrados y transistores discretos de potencia / señal.
 */

export const KB_EV = 8.617333262145e-5; // Constante de Boltzmann en eV/K

export type AgingMechanism = "NBTI" | "PBTI" | "HCI" | "Combined";

export type ProcessTechnologyNode =
  | "180nm_Planar"
  | "65nm_Bulk"
  | "28nm_HKMG"
  | "16nm_FinFET"
  | "7nm_FinFET";

export interface AgingModelParameters {
  // NBTI (pMOS)
  aNbti: number;
  gammaNbti: number;
  eaNbti: number;
  nNbti: number;
  // PBTI (nMOS High-κ)
  aPbti: number;
  gammaPbti: number;
  eaPbti: number;
  nPbti: number;
  // HCI (nMOS / pMOS Hot Carriers)
  aHci: number;
  gammaHci: number;
  eaHci: number;
  nHci: number;
  // Físicos
  toxNm: number;
  muDegCoeff: number;
}

export interface AgingStressProfile {
  vgsStress: number; // Tensión compuerta-fuente de estrés (V)
  vdsStress: number; // Tensión drenador-fuente de estrés (V)
  temperatureK: number; // Temperatura de unión (K)
  dutyCycle: number; // Ciclo de trabajo de estrés AC α (0.0 a 1.0)
  isPmos: boolean; // true para pMOS, false para nMOS
}

export interface AgingDegradationResult {
  timeSeconds: number;
  timeYears: number;
  deltaVthNbti: number; // Corrimiento de Vth por NBTI (V)
  deltaVthPbti: number; // Corrimiento de Vth por PBTI (V)
  deltaVthHci: number; // Corrimiento de Vth por HCI (V)
  deltaVthTotal: number; // Corrimiento acumulado de Vth (V)
  deltaIdsPercent: number; // Pérdida de corriente de saturación (%)
  deltaGmPercent: number; // Pérdida de transconductancia (%)
}

export interface LifetimeEstimationResult {
  timeToFailureSeconds: number;
  timeToFailureYears: number;
  dominantMechanism: AgingMechanism;
  passed10YearTarget: boolean;
  degradationAt10Years: AgingDegradationResult;
}

/** Presets tecnológicos calibrados para nodos estándar */
export const TECHNOLOGY_NODE_PRESETS: Record<ProcessTechnologyNode, AgingModelParameters> = {
  "180nm_Planar": {
    aNbti: 8.0e-5,
    gammaNbti: 1.8,
    eaNbti: 0.18,
    nNbti: 0.25,
    aPbti: 1.0e-6,
    gammaPbti: 1.5,
    eaPbti: 0.10,
    nPbti: 0.15,
    aHci: 8.0e-7,
    gammaHci: 2.2,
    eaHci: -0.04,
    nHci: 0.50,
    toxNm: 4.0,
    muDegCoeff: 0.65,
  },
  "65nm_Bulk": {
    aNbti: 1.2e-4,
    gammaNbti: 2.0,
    eaNbti: 0.15,
    nNbti: 0.22,
    aPbti: 1.5e-5,
    gammaPbti: 1.6,
    eaPbti: 0.10,
    nPbti: 0.16,
    aHci: 1.2e-6,
    gammaHci: 2.4,
    eaHci: -0.03,
    nHci: 0.50,
    toxNm: 1.8,
    muDegCoeff: 0.80,
  },
  "28nm_HKMG": {
    aNbti: 1.8e-4,
    gammaNbti: 2.2,
    eaNbti: 0.14,
    nNbti: 0.19,
    aPbti: 6.0e-5,
    gammaPbti: 2.0,
    eaPbti: 0.12,
    nPbti: 0.18,
    aHci: 1.6e-6,
    gammaHci: 2.6,
    eaHci: -0.02,
    nHci: 0.52,
    toxNm: 1.2,
    muDegCoeff: 1.00,
  },
  "16nm_FinFET": {
    aNbti: 2.4e-4,
    gammaNbti: 2.4,
    eaNbti: 0.13,
    nNbti: 0.18,
    aPbti: 1.0e-4,
    gammaPbti: 2.2,
    eaPbti: 0.11,
    nPbti: 0.17,
    aHci: 2.2e-6,
    gammaHci: 2.8,
    eaHci: -0.01,
    nHci: 0.54,
    toxNm: 1.0,
    muDegCoeff: 1.20,
  },
  "7nm_FinFET": {
    aNbti: 3.2e-4,
    gammaNbti: 2.5,
    eaNbti: 0.12,
    nNbti: 0.17,
    aPbti: 1.5e-4,
    gammaPbti: 2.4,
    eaPbti: 0.10,
    nPbti: 0.16,
    aHci: 3.0e-6,
    gammaHci: 3.0,
    eaHci: -0.01,
    nHci: 0.55,
    toxNm: 0.85,
    muDegCoeff: 1.40,
  },
};

export class AgingEngine {
  /**
   * Evalúa la degradación de Vth por NBTI (Negative Bias Temperature Instability)
   */
  public static evaluateNbti(
    stress: AgingStressProfile,
    params: AgingModelParameters,
    timeSeconds: number
  ): number {
    if (timeSeconds <= 0 || !stress.isPmos) return 0.0;
    const vEff = Math.abs(stress.vgsStress);
    const eField = vEff / (params.toxNm * 0.1); // MV/cm
    const thermalFactor = Math.exp(-params.eaNbti / (KB_EV * stress.temperatureK));
    const acRecoveryFactor = Math.pow(Math.max(0.01, stress.dutyCycle), params.nNbti);

    const deltaVthDc =
      params.aNbti *
      Math.pow(eField, params.gammaNbti) *
      thermalFactor *
      Math.pow(timeSeconds, params.nNbti);

    return deltaVthDc * acRecoveryFactor;
  }

  /**
   * Evalúa la degradación de Vth por PBTI (Positive Bias Temperature Instability)
   */
  public static evaluatePbti(
    stress: AgingStressProfile,
    params: AgingModelParameters,
    timeSeconds: number
  ): number {
    if (timeSeconds <= 0 || stress.isPmos) return 0.0;
    const vEff = Math.abs(stress.vgsStress);
    const eField = vEff / (params.toxNm * 0.1); // MV/cm
    const thermalFactor = Math.exp(-params.eaPbti / (KB_EV * stress.temperatureK));
    const acRecoveryFactor = Math.pow(Math.max(0.01, stress.dutyCycle), params.nPbti);

    const deltaVthDc =
      params.aPbti *
      Math.pow(eField, params.gammaPbti) *
      thermalFactor *
      Math.pow(timeSeconds, params.nPbti);

    return deltaVthDc * acRecoveryFactor;
  }

  /**
   * Evalúa la degradación por Hot Carrier Injection (HCI)
   */
  public static evaluateHci(
    stress: AgingStressProfile,
    params: AgingModelParameters,
    timeSeconds: number
  ): number {
    if (timeSeconds <= 0) return 0.0;
    const vdsEff = Math.abs(stress.vdsStress);
    const vgsEff = Math.abs(stress.vgsStress);

    const vgsFactor = vdsEff > 0 ? Math.max(0.2, Math.min(1.0, vgsEff / vdsEff)) : 0.0;
    const pmosFactor = stress.isPmos ? 0.1 : 1.0;
    const thermalFactor = Math.exp(-params.eaHci / (KB_EV * stress.temperatureK));
    const dutyFactor = Math.pow(Math.max(0.01, stress.dutyCycle), params.nHci);

    return (
      params.aHci *
      pmosFactor *
      Math.pow(vdsEff * vgsFactor, params.gammaHci) *
      thermalFactor *
      dutyFactor *
      Math.pow(timeSeconds, params.nHci)
    );
  }

  /**
   * Calcula la degradación electrotérmica acumulada total
   */
  public static calculateCumulativeAging(
    stress: AgingStressProfile,
    params: AgingModelParameters,
    timeSeconds: number
  ): AgingDegradationResult {
    const deltaVthNbti = this.evaluateNbti(stress, params, timeSeconds);
    const deltaVthPbti = this.evaluatePbti(stress, params, timeSeconds);
    const deltaVthHci = this.evaluateHci(stress, params, timeSeconds);

    const deltaVthTotal = deltaVthNbti + deltaVthPbti + deltaVthHci;

    const vgsOverdrive = Math.max(0.1, Math.abs(stress.vgsStress) - 0.4);
    const vthImpactRatio = deltaVthTotal / vgsOverdrive;
    const mobilityFactor = 1.0 + 0.3 * params.muDegCoeff;

    const deltaIdsPercent = Math.min(90.0, vthImpactRatio * mobilityFactor * 100.0);
    const deltaGmPercent = Math.min(
      90.0,
      vthImpactRatio * (0.8 + 0.2 * params.muDegCoeff) * 100.0
    );

    return {
      timeSeconds,
      timeYears: timeSeconds / (365.25 * 86400.0),
      deltaVthNbti,
      deltaVthPbti,
      deltaVthHci,
      deltaVthTotal,
      deltaIdsPercent,
      deltaGmPercent,
    };
  }

  /**
   * Estima la vida útil (Time-To-Failure) del dispositivo
   */
  public static estimateLifetime(
    stress: AgingStressProfile,
    params: AgingModelParameters,
    maxDeltaVth = 0.050, // 50 mV
    maxDeltaIdsPct = 10.0 // 10%
  ): LifetimeEstimationResult {
    const tenYearsS = 10.0 * 365.25 * 86400.0;
    const deg10y = this.calculateCumulativeAging(stress, params, tenYearsS);

    let tLow = 1.0;
    let tHigh = 100.0 * 365.25 * 86400.0; // 100 años

    for (let i = 0; i < 40; i++) {
      const tMid = Math.sqrt(tLow * tHigh);
      const res = this.calculateCumulativeAging(stress, params, tMid);

      if (res.deltaVthTotal >= maxDeltaVth || res.deltaIdsPercent >= maxDeltaIdsPct) {
        tHigh = tMid;
      } else {
        tLow = tMid;
      }
    }

    const ttfS = Math.sqrt(tLow * tHigh);
    const ttfYears = ttfS / (365.25 * 86400.0);

    let dominantMechanism: AgingMechanism = "HCI";
    if (deg10y.deltaVthNbti > deg10y.deltaVthPbti && deg10y.deltaVthNbti > deg10y.deltaVthHci) {
      dominantMechanism = "NBTI";
    } else if (deg10y.deltaVthPbti > deg10y.deltaVthHci) {
      dominantMechanism = "PBTI";
    }

    return {
      timeToFailureSeconds: ttfS,
      timeToFailureYears: ttfYears,
      dominantMechanism,
      passed10YearTarget: ttfYears >= 10.0,
      degradationAt10Years: deg10y,
    };
  }
}
