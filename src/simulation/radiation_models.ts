/**
 * ============================================================================
 * ASTRYD SOPHIA — RADIATION EFFECTS & HARDENING MODELS (TID & SEE)
 * ============================================================================
 *
 * Modelado físico de efectos de radiación para aplicaciones aeroespaciales,
 * satélites (LEO/GEO/Deep Space) y electrónica de defensa:
 * 1. TID (Total Ionizing Dose): Atrapamiento Not/Nit, fuga lateral STI y degradación de pendiente subumbral.
 * 2. SEE (Single-Event Effects): Inyección de pulsos SET por ionización pesada (LET).
 * 3. SEU (Single-Event Upset): Carga crítica Qcrit y márgenes de inmunidad.
 */

export const LET_TO_CHARGE_PC_PER_UM = 0.01036; // pC/(MeV·cm²/mg·µm)

export type SpaceMissionProfile =
  | "LEO_LowAltitude"
  | "LEO_PolarSat"
  | "GEO_15Year"
  | "DeepSpace_Europa"
  | "MilStd883_RadHard"
  | "Commercial_COTS";

export type RadiationHardeningLevel =
  | "Unmitigated_COTS"
  | "Enclosed_Shielding"
  | "Rad_Tolerant"
  | "RadHard_RHBD";

export interface TidTechnologyParameters {
  aNot: number;
  alphaNot: number;
  aNit: number;
  alphaNit: number;
  stiLeakSat: number;
  dCritStiKrad: number;
  sDegradationFactor: number;
}

export interface SingleEventTransientSpec {
  strikeTimeSeconds: number; // Instante del impacto (s)
  letMevCm2Mg: number; // LET de la partícula incidente (MeV·cm²/mg)
  collectionDepthUm: number; // Profundidad de colección / embudo (µm)
  tauRiseSeconds: number; // Tiempo de subida (~10 ps)
  tauFallSeconds: number; // Tiempo de bajada (~200 ps)
}

export interface TidDegradationResult {
  totalDoseKrad: number;
  deltaVthNmos: number;
  deltaVthPmos: number;
  deltaVthNot: number;
  deltaVthNit: number;
  stiLeakageCurrentA: number;
  subthresholdSwingMvDec: number;
  functionalStatusOk: boolean;
}

export interface SeuVulnerabilityResult {
  criticalChargeFc: number;
  collectedChargeFc: number;
  upsetOccurred: boolean;
  safetyMargin: number;
}

export const HARDENING_LEVEL_PRESETS: Record<RadiationHardeningLevel, TidTechnologyParameters> = {
  Unmitigated_COTS: {
    aNot: 1.5e-3,
    alphaNot: 0.85,
    aNit: 4.0e-4,
    alphaNit: 0.65,
    stiLeakSat: 1.0e-6,
    dCritStiKrad: 25.0,
    sDegradationFactor: 0.25,
  },
  Enclosed_Shielding: {
    aNot: 8.0e-4,
    alphaNot: 0.80,
    aNit: 2.0e-4,
    alphaNit: 0.60,
    stiLeakSat: 2.0e-7,
    dCritStiKrad: 50.0,
    sDegradationFactor: 0.15,
  },
  Rad_Tolerant: {
    aNot: 3.0e-4,
    alphaNot: 0.75,
    aNit: 8.0e-5,
    alphaNit: 0.55,
    stiLeakSat: 1.0e-8,
    dCritStiKrad: 100.0,
    sDegradationFactor: 0.08,
  },
  RadHard_RHBD: {
    aNot: 5.0e-5,
    alphaNot: 0.65,
    aNit: 1.5e-5,
    alphaNit: 0.50,
    stiLeakSat: 1.0e-11,
    dCritStiKrad: 500.0,
    sDegradationFactor: 0.01,
  },
};

export class RadiationEngine {
  /**
   * Evalúa la degradación de parámetros por Dosis Ionizante Total (TID)
   */
  public static evaluateTidDegradation(
    doseKrad: number,
    params: TidTechnologyParameters,
    nominalSubthresholdSwing = 70.0
  ): TidDegradationResult {
    if (doseKrad <= 0) {
      return {
        totalDoseKrad: 0,
        deltaVthNmos: 0,
        deltaVthPmos: 0,
        deltaVthNot: 0,
        deltaVthNit: 0,
        stiLeakageCurrentA: 0,
        subthresholdSwingMvDec: nominalSubthresholdSwing,
        functionalStatusOk: true,
      };
    }

    const deltaVthNot = -params.aNot * Math.pow(doseKrad, params.alphaNot);
    const deltaVthNit = params.aNit * Math.pow(doseKrad, params.alphaNit);

    const deltaVthNmos = deltaVthNot + deltaVthNit;
    const deltaVthPmos = deltaVthNot - deltaVthNit;

    const stiLeakageCurrentA =
      params.stiLeakSat * (1.0 - Math.exp(-doseKrad / params.dCritStiKrad));
    const subthresholdSwingMvDec =
      nominalSubthresholdSwing + params.sDegradationFactor * doseKrad;

    const functionalStatusOk =
      Math.abs(deltaVthNmos) < 0.25 &&
      Math.abs(deltaVthPmos) < 0.25 &&
      stiLeakageCurrentA < 1.0e-7;

    return {
      totalDoseKrad: doseKrad,
      deltaVthNmos,
      deltaVthPmos,
      deltaVthNot,
      deltaVthNit,
      stiLeakageCurrentA,
      subthresholdSwingMvDec,
      functionalStatusOk,
    };
  }

  /**
   * Genera la forma de onda del pulso de corriente SET (Messenger double-exponential)
   */
  public static calculateSetCurrentInstant(
    spec: SingleEventTransientSpec,
    timeSeconds: number
  ): number {
    if (timeSeconds < spec.strikeTimeSeconds) {
      return 0.0;
    }

    const dt = timeSeconds - spec.strikeTimeSeconds;
    const qTotalC =
      spec.letMevCm2Mg * spec.collectionDepthUm * LET_TO_CHARGE_PC_PER_UM * 1.0e-12;

    const deltaTau = Math.max(1.0e-15, spec.tauFallSeconds - spec.tauRiseSeconds);
    const i0 = qTotalC / deltaTau;

    const expFall = Math.exp(-dt / spec.tauFallSeconds);
    const expRise = Math.exp(-dt / spec.tauRiseSeconds);

    return Math.max(0.0, i0 * (expFall - expRise));
  }

  /**
   * Evalúa la vulnerabilidad a SEU para un nodo capacitivo dado su LET incidente
   */
  public static evaluateSeuVulnerability(
    nodeCapacitanceFarads: number,
    voltageSwingVolts: number,
    spec: SingleEventTransientSpec
  ): SeuVulnerabilityResult {
    const qCritC = nodeCapacitanceFarads * (voltageSwingVolts * 0.5);
    const qCritFc = qCritC * 1.0e15;

    const qCollC =
      spec.letMevCm2Mg * spec.collectionDepthUm * LET_TO_CHARGE_PC_PER_UM * 1.0e-12;
    const qCollFc = qCollC * 1.0e15;

    const upsetOccurred = qCollFc >= qCritFc;
    const safetyMargin = qCollFc > 0 ? qCritFc / qCollFc : Number.POSITIVE_INFINITY;

    return {
      criticalChargeFc: qCritFc,
      collectedChargeFc: qCollFc,
      upsetOccurred,
      safetyMargin,
    };
  }
}
