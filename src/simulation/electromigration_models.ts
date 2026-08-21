/**
 * ============================================================================
 * ASTRYD SOPHIA — ELECTROMIGRATION (EM) & IR DROP ANALYSIS ENGINE
 * ============================================================================
 *
 * Modelado de integridad de potencia (PI) y fiabilidad de interconexiones en
 * circuitos integrados VLSI y pistas de PCB:
 * 1. Mapeo de Caída de Tensión IR (IR Drop).
 * 2. Densidad de Corriente J (MA/cm² o A/mm²).
 * 3. Ecuación de Black para Tiempo Medio hasta el Fallo (MTTF).
 * 4. Efecto Blech de Pista Corta (Inmortalidad por Gradiente Mecánico).
 */

export const KB_EV = 8.617333262145e-5; // Constante de Boltzmann en eV/K

export type InterconnectMaterial =
  | "Copper_Cu"
  | "Aluminum_Al"
  | "Tungsten_W"
  | "Gold_Au"
  | "PCB_Copper_1oz"
  | "PCB_Copper_2oz";

export interface MaterialProperties {
  resistivityOhmM: number;
  activationEnergyEv: number;
  blechProductCritAPerCm: number;
  jMaxRefMaPerCm2: number;
}

export const MATERIAL_PROPERTIES: Record<InterconnectMaterial, MaterialProperties> = {
  Copper_Cu: {
    resistivityOhmM: 1.72e-8,
    activationEnergyEv: 0.90,
    blechProductCritAPerCm: 2500.0,
    jMaxRefMaPerCm2: 1.5,
  },
  Aluminum_Al: {
    resistivityOhmM: 2.82e-8,
    activationEnergyEv: 0.65,
    blechProductCritAPerCm: 1500.0,
    jMaxRefMaPerCm2: 0.5,
  },
  Tungsten_W: {
    resistivityOhmM: 5.60e-8,
    activationEnergyEv: 0.85,
    blechProductCritAPerCm: 4000.0,
    jMaxRefMaPerCm2: 2.5,
  },
  Gold_Au: {
    resistivityOhmM: 2.44e-8,
    activationEnergyEv: 0.80,
    blechProductCritAPerCm: 2000.0,
    jMaxRefMaPerCm2: 1.0,
  },
  PCB_Copper_1oz: {
    resistivityOhmM: 1.72e-8,
    activationEnergyEv: 0.95,
    blechProductCritAPerCm: 50000.0,
    jMaxRefMaPerCm2: 0.05,
  },
  PCB_Copper_2oz: {
    resistivityOhmM: 1.72e-8,
    activationEnergyEv: 0.95,
    blechProductCritAPerCm: 50000.0,
    jMaxRefMaPerCm2: 0.05,
  },
};

export interface InterconnectSegmentSpec {
  segmentId: string;
  sourceNode: string;
  targetNode: string;
  lengthUm: number;
  widthUm: number;
  thicknessNm: number;
  material: InterconnectMaterial;
  currentA: number;
  temperatureK: number;
}

export interface SegmentEmAnalysisResult {
  currentDensityMaPerCm2: number;
  blechProductAPerCm: number;
  isBlechImmortal: boolean;
  mttfHours: number;
  mttfYears: number;
  emViolation: boolean;
  maxAllowedDensityMaPerCm2: number;
}

export interface SegmentIrDropResult {
  resistanceOhms: number;
  voltageDropV: number;
  voltageDropPercent: number;
  isIrDropViolation: boolean;
}

export interface InterconnectHealthResult {
  segmentId: string;
  em: SegmentEmAnalysisResult;
  ir: SegmentIrDropResult;
  hasAnyViolation: boolean;
}

export interface PdnMapSummary {
  totalSegments: number;
  maxCurrentDensityMaPerCm2: number;
  maxVoltageDropV: number;
  maxVoltageDropPercent: number;
  totalEmViolations: number;
  totalIrDropViolations: number;
  segments: InterconnectHealthResult[];
}

export class ElectromigrationEngine {
  /**
   * Calcula la resistencia de una pista metálica
   */
  public static calculateTraceResistance(
    lengthUm: number,
    widthUm: number,
    thicknessNm: number,
    material: InterconnectMaterial,
    temperatureK = 300.0
  ): number {
    const lM = lengthUm * 1.0e-6;
    const wM = widthUm * 1.0e-6;
    const tM = thicknessNm * 1.0e-9;
    const areaM2 = Math.max(1.0e-20, wM * tM);

    const props = MATERIAL_PROPERTIES[material];
    const tempCoeff = 0.00393;
    const rhoT = Math.max(
      0.1 * props.resistivityOhmM,
      props.resistivityOhmM * (1.0 + tempCoeff * (temperatureK - 300.0))
    );

    return (rhoT * lM) / areaM2;
  }

  /**
   * Evalúa la electromigración (Black/Blech) en un segmento
   */
  public static evaluateSegmentEm(
    spec: InterconnectSegmentSpec,
    aEmConstant = 1.0e14
  ): SegmentEmAnalysisResult {
    const wCm = spec.widthUm * 1.0e-4;
    const tCm = spec.thicknessNm * 1.0e-7;
    const areaCm2 = Math.max(1.0e-15, wCm * tCm);

    const currentAbsA = Math.abs(spec.currentA);
    const jAPerCm2 = currentAbsA / areaCm2;
    const jMaPerCm2 = jAPerCm2 * 1.0e-6;

    const lCm = spec.lengthUm * 1.0e-4;
    const blechProductAPerCm = jAPerCm2 * lCm;
    const props = MATERIAL_PROPERTIES[spec.material];
    const isBlechImmortal = blechProductAPerCm < props.blechProductCritAPerCm;

    const tRefK = 378.15; // 105 °C
    const ea = props.activationEnergyEv;
    const tempRatio = Math.exp((-ea / KB_EV) * (1.0 / spec.temperatureK - 1.0 / tRefK));
    const maxAllowedDensityMaPerCm2 = props.jMaxRefMaPerCm2 * tempRatio;

    let mttfHours = Number.POSITIVE_INFINITY;
    if (jAPerCm2 > 0) {
      if (isBlechImmortal) {
        mttfHours = Number.POSITIVE_INFINITY;
      } else {
        const thermalFactor = Math.exp(ea / (KB_EV * spec.temperatureK));
        const blackTerm = aEmConstant / Math.pow(jAPerCm2, 2.0);
        mttfHours = Math.min(1.0e12, blackTerm * thermalFactor);
      }
    }

    const mttfYears = mttfHours / 8766.0;
    const emViolation =
      !isBlechImmortal &&
      (jMaPerCm2 > maxAllowedDensityMaPerCm2 || mttfYears < 10.0);

    return {
      currentDensityMaPerCm2: jMaPerCm2,
      blechProductAPerCm,
      isBlechImmortal,
      mttfHours,
      mttfYears,
      emViolation,
      maxAllowedDensityMaPerCm2,
    };
  }

  /**
   * Evalúa la caída de tensión IR
   */
  public static evaluateSegmentIrDrop(
    spec: InterconnectSegmentSpec,
    vNominal: number,
    maxDropBudgetPercent = 3.0
  ): SegmentIrDropResult {
    const resistanceOhms = this.calculateTraceResistance(
      spec.lengthUm,
      spec.widthUm,
      spec.thicknessNm,
      spec.material,
      spec.temperatureK
    );

    const voltageDropV = Math.abs(spec.currentA) * resistanceOhms;
    const voltageDropPercent =
      vNominal > 0 ? (voltageDropV / vNominal) * 100.0 : 0.0;
    const isIrDropViolation = voltageDropPercent > maxDropBudgetPercent;

    return {
      resistanceOhms,
      voltageDropV,
      voltageDropPercent,
      isIrDropViolation,
    };
  }

  /**
   * Analiza la salud completa de un segmento
   */
  public static analyzeSegment(
    spec: InterconnectSegmentSpec,
    vNominal: number,
    maxDropBudgetPercent = 3.0,
    aEmConstant = 1.0e14
  ): InterconnectHealthResult {
    const em = this.evaluateSegmentEm(spec, aEmConstant);
    const ir = this.evaluateSegmentIrDrop(spec, vNominal, maxDropBudgetPercent);
    const hasAnyViolation = em.emViolation || ir.isIrDropViolation;

    return {
      segmentId: spec.segmentId,
      em,
      ir,
      hasAnyViolation,
    };
  }

  /**
   * Analiza una red PDN completa
   */
  public static analyzePdnNetwork(
    segments: InterconnectSegmentSpec[],
    vNominal: number,
    maxDropBudgetPercent = 3.0,
    aEmConstant = 1.0e14
  ): PdnMapSummary {
    const results = segments.map((seg) =>
      this.analyzeSegment(seg, vNominal, maxDropBudgetPercent, aEmConstant)
    );

    let maxCurrentDensityMaPerCm2 = 0;
    let maxVoltageDropV = 0;
    let maxVoltageDropPercent = 0;
    let totalEmViolations = 0;
    let totalIrDropViolations = 0;

    for (const r of results) {
      if (r.em.currentDensityMaPerCm2 > maxCurrentDensityMaPerCm2) {
        maxCurrentDensityMaPerCm2 = r.em.currentDensityMaPerCm2;
      }
      if (r.ir.voltageDropV > maxVoltageDropV) {
        maxVoltageDropV = r.ir.voltageDropV;
        maxVoltageDropPercent = r.ir.voltageDropPercent;
      }
      if (r.em.emViolation) totalEmViolations++;
      if (r.ir.isIrDropViolation) totalIrDropViolations++;
    }

    return {
      totalSegments: segments.length,
      maxCurrentDensityMaPerCm2,
      maxVoltageDropV,
      maxVoltageDropPercent,
      totalEmViolations,
      totalIrDropViolations,
      segments: results,
    };
  }
}
