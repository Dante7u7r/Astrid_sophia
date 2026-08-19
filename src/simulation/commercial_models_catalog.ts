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
  readonly forwardVoltage?: number; // Tensión directa típica (V)
}

export interface BjtCommercialModel {
  readonly name: string;
  readonly polarity: "npn" | "pnp";
  readonly description: string;
  readonly is: number;       // Corriente de saturación (A)
  readonly bf: number;       // Ganancia beta directa (Hfe)
  readonly vaf?: number;     // Tensión de Early directa (V)
  readonly rb?: number;      // Resistencia parásita de base (Ohm)
  readonly rc?: number;      // Resistencia parásita de colector (Ohm)
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
  readonly cgs?: number;     // Capacidad Gate-Source (F)
  readonly cgd?: number;     // Capacidad Gate-Drain (F)
}

export interface JfetCommercialModel {
  readonly name: string;
  readonly polarity: "njf" | "pjf";
  readonly description: string;
  readonly vto: number;      // Tensión de estrangulamiento / Pinch-off Vp (V)
  readonly beta: number;     // Parámetro de transconductancia (A/V^2)
  readonly lambda?: number;  // Modulación de canal (1/V)
  readonly cgs?: number;     // Capacidad G-S (F)
  readonly cgd?: number;     // Capacidad G-D (F)
}

export interface OpampCommercialModel {
  readonly name: string;
  readonly description: string;
  readonly aol: number;      // Ganancia de lazo abierto (V/V)
  readonly gbwHz: number;    // Ancho de banda de ganancia unitaria (Hz)
  readonly slewRateVUs: number; // Velocidad de subida (V/us)
  readonly rin: number;      // Resistencia de entrada diferencial (Ohm)
  readonly rout: number;     // Resistencia de salida (Ohm)
  readonly vos: number;      // Tensión de offset típica (V)
  readonly ib?: number;      // Corriente de polarización de entrada típica (A)
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
    forwardVoltage: 0.72,
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
    forwardVoltage: 0.75,
  },
  "1N4001": {
    name: "1N4001",
    description: "Diodo rectificador de propósito general (50V, 1A)",
    is: 5.0e-9,
    rs: 0.035,
    n: 1.750,
    cjo: 15.0e-12,
    tt: 5.0e-6,
    bv: 50.0,
    ibv: 5e-5,
    forwardVoltage: 0.73,
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
    forwardVoltage: 0.36,
  },
  "BZX55C5V1": {
    name: "BZX55C5V1",
    description: "Diodo Zener regulador de tensión (5.1V, 500mW)",
    is: 1.0e-12,
    rs: 0.5,
    n: 1.1,
    bv: 5.1,
    ibv: 5e-3,
    forwardVoltage: 0.70,
  },
  "BZX55C12": {
    name: "BZX55C12",
    description: "Diodo Zener regulador de tensión (12V, 500mW)",
    is: 1.0e-12,
    rs: 1.2,
    n: 1.1,
    bv: 12.0,
    ibv: 5e-3,
    forwardVoltage: 0.70,
  },
  "LED_RED": {
    name: "LED_RED",
    description: "Diodo Emisor de Luz Rojo (λ=630nm, VF=1.8V, 20mA)",
    is: 1.0e-18,
    rs: 2.2,
    n: 1.9,
    forwardVoltage: 1.85,
  },
  "LED_GREEN": {
    name: "LED_GREEN",
    description: "Diodo Emisor de Luz Verde (λ=525nm, VF=2.2V, 20mA)",
    is: 1.0e-19,
    rs: 3.0,
    n: 2.1,
    forwardVoltage: 2.20,
  },
  "LED_BLUE": {
    name: "LED_BLUE",
    description: "Diodo Emisor de Luz Azul (λ=470nm, VF=3.2V, 20mA)",
    is: 1.0e-21,
    rs: 4.5,
    n: 2.5,
    forwardVoltage: 3.20,
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
    rb: 10.0,
    rc: 1.0,
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
    rb: 15.0,
    rc: 1.5,
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
    rb: 20.0,
    rc: 2.0,
    cje: 11.0e-12,
    cjc: 4.5e-12,
  },
  "BD139": {
    name: "BD139",
    polarity: "npn",
    description: "Transistor NPN Driver de potencia media (80V, 1.5A)",
    is: 2.2e-13,
    bf: 120.0,
    vaf: 100.0,
    rb: 3.0,
    rc: 0.3,
  },
  "TIP120": {
    name: "TIP120",
    polarity: "npn",
    description: "Transistor Darlington NPN de potencia (60V, 5A, Beta 1000)",
    is: 1.0e-12,
    bf: 1000.0,
    vaf: 50.0,
    rb: 50.0,
    rc: 0.2,
  },
  "2N3906": {
    name: "2N3906",
    polarity: "pnp",
    description: "Transistor PNP complementario de 2N3904",
    is: 1.41e-15,
    bf: 180.7,
    vaf: 18.7,
    rb: 15.0,
    rc: 1.5,
    cje: 4.5e-12,
    cjc: 3.6e-12,
  },
  "BC557": {
    name: "BC557",
    polarity: "pnp",
    description: "Transistor PNP complementario de BC547",
    is: 1.8e-15,
    bf: 250.0,
    vaf: 70.0,
    rb: 20.0,
    rc: 2.0,
  },
  "BD140": {
    name: "BD140",
    polarity: "pnp",
    description: "Transistor PNP Driver complementario de BD139",
    is: 2.2e-13,
    bf: 120.0,
    vaf: 100.0,
    rb: 3.0,
    rc: 0.3,
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
    cgs: 1.2e-9,
    cgd: 150e-12,
  },
  "IRFZ44N": {
    name: "IRFZ44N",
    polarity: "nmos",
    description: "MOSFET de potencia Canal N estándar (55V, 49A, RDSon 17.5mΩ)",
    vth: 3.0,
    ron: 0.0175,
    wOverL: 1500.0,
    cgs: 1.7e-9,
    cgd: 200e-12,
  },
  "2N7000": {
    name: "2N7000",
    polarity: "nmos",
    description: "MOSFET Canal N de señal pequeña (60V, 200mA, RDSon 5Ω)",
    vth: 2.1,
    ron: 5.0,
    wOverL: 100.0,
    cgs: 60e-12,
    cgd: 15e-12,
  },
  "BS170": {
    name: "BS170",
    polarity: "nmos",
    description: "MOSFET Canal N de conmutación rápida (60V, 500mA)",
    vth: 2.0,
    ron: 2.5,
    wOverL: 150.0,
    cgs: 40e-12,
    cgd: 10e-12,
  },
  "IRF9540": {
    name: "IRF9540",
    polarity: "pmos",
    description: "MOSFET de potencia Canal P (-100V, -23A, RDSon 117mΩ)",
    vth: -3.5,
    ron: 0.117,
    wOverL: 1000.0,
    cgs: 1.4e-9,
    cgd: 250e-12,
  },
};

export const COMMERCIAL_JFETS: Record<string, JfetCommercialModel> = {
  "2N5457": {
    name: "2N5457",
    polarity: "njf",
    description: "JFET Canal N de uso general en audio y amplificación (Vp=-2.5V, Idss=3mA)",
    vto: -2.5,
    beta: 0.0012,
    lambda: 0.01,
    cgs: 4.5e-12,
    cgd: 1.5e-12,
  },
  "BF245A": {
    name: "BF245A",
    polarity: "njf",
    description: "JFET Canal N para amplificadores de RF/VHF (Vp=-1.5V, Idss=4mA)",
    vto: -1.5,
    beta: 0.0018,
    lambda: 0.015,
    cgs: 4.0e-12,
    cgd: 1.0e-12,
  },
  "J310": {
    name: "J310",
    polarity: "njf",
    description: "JFET Canal N de alta transconductancia para VHF/UHF (Idss=40mA)",
    vto: -3.5,
    beta: 0.008,
    lambda: 0.02,
    cgs: 5.0e-12,
    cgd: 2.0e-12,
  },
  "2N5460": {
    name: "2N5460",
    polarity: "pjf",
    description: "JFET Canal P para etapas de bajo ruido (Vp=2.5V, Idss=-3mA)",
    vto: 2.5,
    beta: 0.0012,
    lambda: 0.01,
    cgs: 4.5e-12,
    cgd: 1.5e-12,
  },
};

export const COMMERCIAL_OPAMPS: Record<string, OpampCommercialModel> = {
  "LM741": {
    name: "LM741",
    description: "Amplificador Operacional Estándar de la Industria (Aol=200k, GBW=1MHz, SR=0.5V/μs)",
    aol: 200000.0,
    gbwHz: 1.0e6,
    slewRateVUs: 0.5,
    rin: 2.0e6,
    rout: 75.0,
    vos: 0.001,
    ib: 80e-9,
  },
  "TL072": {
    name: "TL072",
    description: "Amplificador Operacional BiFET de bajo ruido JFET (Aol=200k, GBW=3MHz, SR=13V/μs)",
    aol: 200000.0,
    gbwHz: 3.0e6,
    slewRateVUs: 13.0,
    rin: 1.0e12,
    rout: 50.0,
    vos: 0.003,
    ib: 5e-12,
  },
  "NE5532": {
    name: "NE5532",
    description: "Amplificador Operacional Dual de Audio de Ultra-Bajo Ruido (GBW=10MHz, SR=9V/μs)",
    aol: 100000.0,
    gbwHz: 10.0e6,
    slewRateVUs: 9.0,
    rin: 300000.0,
    rout: 0.3,
    vos: 0.0005,
    ib: 200e-9,
  },
  "LM358": {
    name: "LM358",
    description: "Amplificador Operacional de Fuente Simple y Bajo Consumo (GBW=1MHz, SR=0.6V/μs)",
    aol: 100000.0,
    gbwHz: 1.0e6,
    slewRateVUs: 0.6,
    rin: 2.0e6,
    rout: 50.0,
    vos: 0.002,
    ib: 45e-9,
  },
  "OPA2134": {
    name: "OPA2134",
    description: "SoundPlus™ OpAmp de Audio de Alta Fidelidad Burr-Brown (GBW=8MHz, SR=20V/μs)",
    aol: 1200000.0,
    gbwHz: 8.0e6,
    slewRateVUs: 20.0,
    rin: 1.0e13,
    rout: 10.0,
    vos: 0.0005,
    ib: 5e-12,
  },
};

