/**
 * Catálogo de Modelos Comerciales Predefinidos para SPICE / MNA.
 * Proporciona parámetros físicos rigurosos para componentes discretos estándar.
 */

export interface DiodeCommercialModel {
  readonly name: string;
  readonly description: string;
  readonly is: number;       // Corriente de saturación (A)
  readonly rs: number;       // Resistencia serie (Ohm)
  readonly n: number;        // Factor de idealidad
  readonly cjo?: number;     // Capacidad de unión a cero polarización (F)
  readonly tt?: number;      // Tiempo de tránsito (s)
  readonly bv?: number;      // Tensión de ruptura inversa / Zener (V)
  readonly ibv?: number;     // Corriente en ruptura (A)
}

export interface BjtCommercialModel {
  readonly name: string;
  readonly polarity: "npn" | "pnp";
  readonly description: string;
  readonly is: number;       // Corriente de saturación (A)
  readonly bf: number;       // Ganancia beta directa (Hfe)
  readonly vaf?: number;     // Tensión de Early directa (V)
  readonly cje?: number;     // Capacidad B-E (F)
  readonly cjc?: number;     // Capacidad B-C (F)
}

export interface MosfetCommercialModel {
  readonly name: string;
  readonly polarity: "nmos" | "pmos";
  readonly description: string;
  readonly vth: number;      // Tensión de umbral Vth (V)
  readonly ron: number;      // Resistencia de conducción RDS(on) (Ohm)
  readonly wOverL?: number;  // Relación de aspecto W/L
}

export const COMMERCIAL_DIODES: Record<string, DiodeCommercialModel> = {
  "1N4148": {
    name: "1N4148",
    description: "Diodo de conmutación ultra-rápida (100V, 200mA, 4ns)",
    is: 2.52e-9,
    rs: 0.568,
    n: 1.752,
    cjo: 4.0e-12,
    tt: 5.7e-9,
    bv: 100.0,
    ibv: 1e-4,
  },
  "1N4007": {
    name: "1N4007",
    description: "Diodo rectificador de potencia estándar (1000V, 1A)",
    is: 7.02e-9,
    rs: 0.034,
    n: 1.800,
    cjo: 15.0e-12,
    tt: 5.0e-6,
    bv: 1000.0,
    ibv: 5e-5,
  },
  "1N5819": {
    name: "1N5819",
    description: "Diodo Schottky de baja caída directa (40V, 1A, VF~0.35V)",
    is: 3.17e-5,
    rs: 0.051,
    n: 1.050,
    cjo: 110.0e-12,
    tt: 1.0e-9,
    bv: 40.0,
    ibv: 1e-3,
  },
  "BZX55C5V1": {
    name: "BZX55C5V1",
    description: "Diodo Zener regulador (5.1V, 500mW)",
    is: 1.0e-12,
    rs: 0.5,
    n: 1.1,
    bv: 5.1,
    ibv: 5e-3,
  },
};

export const COMMERCIAL_BJTS: Record<string, BjtCommercialModel> = {
  "2N2222": {
    name: "2N2222",
    polarity: "npn",
    description: "Transistor NPN de propósito general y conmutación rápida",
    is: 1.434e-14,
    bf: 255.9,
    vaf: 74.03,
    cje: 22.0e-12,
    cjc: 7.3e-12,
  },
  "2N3904": {
    name: "2N3904",
    polarity: "npn",
    description: "Transistor NPN de pequeña señal y bajo ruido",
    is: 6.734e-15,
    bf: 416.4,
    vaf: 74.03,
    cje: 4.5e-12,
    cjc: 3.6e-12,
  },
  "BC547": {
    name: "BC547",
    polarity: "npn",
    description: "Transistor NPN estándar europeo para preamplificación",
    is: 1.8e-15,
    bf: 300.0,
    vaf: 90.0,
  },
  "2N3906": {
    name: "2N3906",
    polarity: "pnp",
    description: "Transistor PNP complementario de 2N3904",
    is: 1.41e-15,
    bf: 180.7,
    vaf: 18.7,
  },
  "BC557": {
    name: "BC557",
    polarity: "pnp",
    description: "Transistor PNP complementario de BC547",
    is: 1.8e-15,
    bf: 250.0,
    vaf: 70.0,
  },
};

export const COMMERCIAL_MOSFETS: Record<string, MosfetCommercialModel> = {
  "IRF540N": {
    name: "IRF540N",
    polarity: "nmos",
    description: "MOSFET de potencia Canal N (100V, 33A, RDSon 44mΩ)",
    vth: 3.5,
    ron: 0.044,
    wOverL: 1000.0,
  },
  "2N7000": {
    name: "2N7000",
    polarity: "nmos",
    description: "MOSFET Canal N de señal pequeña (60V, 200mA)",
    vth: 2.1,
    ron: 5.0,
    wOverL: 100.0,
  },
  "IRF9540": {
    name: "IRF9540",
    polarity: "pmos",
    description: "MOSFET de potencia Canal P (-100V, -23A, RDSon 117mΩ)",
    vth: -3.5,
    ron: 0.117,
    wOverL: 1000.0,
  },
};
