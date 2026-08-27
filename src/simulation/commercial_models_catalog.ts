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
  readonly ios?: number;     // Corriente de offset de entrada (A)
  readonly iq?: number;      // Corriente de alimentación en reposo (A)
  readonly isc?: number;     // Límite de corriente de cortocircuito (A)
  readonly vdrop?: number;   // Caída de tensión a riel de alimentación (V)
  readonly cmrr?: number;    // Rechazo de modo común CMRR (dB)
  readonly psrr?: number;    // Rechazo de rizado de fuente PSRR (dB)
  readonly en?: number;      // Densidad espectral de ruido de tensión (V/sqrt(Hz))
  readonly in?: number;      // Densidad espectral de ruido de corriente (A/sqrt(Hz))
  readonly fc?: number;      // Frecuencia de esquina de ruido 1/f (Hz)
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
  "1N5817": {
    name: "1N5817",
    description: "Diodo Schottky de ultra-baja caída directa (20V, 1A, VF~0.32V)",
    is: 4.5e-5,
    rs: 0.045,
    n: 1.040,
    cjo: 125.0e-12,
    tt: 1.0e-9,
    bv: 20.0,
    ibv: 1e-3,
    forwardVoltage: 0.32,
  },
  "BAT54": {
    name: "BAT54",
    description: "Diodo Schottky SMD de conmutación ultra-rápida (30V, 200mA, trr<5ns)",
    is: 2.1e-7,
    rs: 1.2,
    n: 1.08,
    cjo: 10.0e-12,
    tt: 5.0e-9,
    bv: 30.0,
    ibv: 1e-4,
    forwardVoltage: 0.32,
  },
  "BZX55C3V3": {
    name: "BZX55C3V3",
    description: "Diodo Zener regulador de tensión (3.3V, 500mW)",
    is: 1.0e-12,
    rs: 2.0,
    n: 1.15,
    bv: 3.3,
    ibv: 5e-3,
    forwardVoltage: 0.70,
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
  "1N4728A": {
    name: "1N4728A",
    description: "Diodo Zener de potencia 1W (3.3V, 1W)",
    is: 1.0e-11,
    rs: 1.0,
    n: 1.2,
    bv: 3.3,
    ibv: 10e-3,
    forwardVoltage: 0.75,
  },
  "1N4733A": {
    name: "1N4733A",
    description: "Diodo Zener de potencia 1W (5.1V, 1W)",
    is: 1.0e-11,
    rs: 0.4,
    n: 1.15,
    bv: 5.1,
    ibv: 10e-3,
    forwardVoltage: 0.75,
  },
  "1N4742A": {
    name: "1N4742A",
    description: "Diodo Zener de potencia 1W (12V, 1W)",
    is: 1.0e-11,
    rs: 0.8,
    n: 1.15,
    bv: 12.0,
    ibv: 10e-3,
    forwardVoltage: 0.75,
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
  "LED_YELLOW": {
    name: "LED_YELLOW",
    description: "Diodo Emisor de Luz Amarillo (λ=590nm, VF=2.1V, 20mA)",
    is: 5.0e-19,
    rs: 2.8,
    n: 2.0,
    forwardVoltage: 2.10,
  },
  "LED_WHITE": {
    name: "LED_WHITE",
    description: "Diodo Emisor de Luz Blanco (Fósforo, VF=3.0V, 20mA)",
    is: 1.0e-21,
    rs: 4.0,
    n: 2.4,
    forwardVoltage: 3.00,
  },
  "LED_UV": {
    name: "LED_UV",
    description: "Diodo Emisor de Luz Ultravioleta (λ=395nm, VF=3.5V, 20mA)",
    is: 1.0e-23,
    rs: 5.0,
    n: 2.8,
    forwardVoltage: 3.50,
  },
  "LED_IR": {
    name: "LED_IR",
    description: "Diodo Emisor Infrarrojo (λ=940nm, VF=1.2V, 50mA)",
    is: 1.0e-15,
    rs: 1.5,
    n: 1.5,
    forwardVoltage: 1.25,
  },
};

export const COMMERCIAL_BJTS: Record<string, BjtCommercialModel> = {
  "2N2222": {
    name: "2N2222",
    polarity: "npn",
    description: "Transistor NPN de propósito general y conmutación rápida (40V, 800mA)",
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
    description: "Transistor NPN de pequeña señal y bajo ruido (40V, 200mA)",
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
    description: "Transistor NPN estándar europeo para preamplificación (45V, 100mA)",
    is: 1.8e-15,
    bf: 300.0,
    vaf: 90.0,
    rb: 20.0,
    rc: 2.0,
    cje: 11.0e-12,
    cjc: 4.5e-12,
  },
  "BC548": {
    name: "BC548",
    polarity: "npn",
    description: "Transistor NPN de audio y propósito general (30V, 100mA)",
    is: 1.8e-15,
    bf: 280.0,
    vaf: 80.0,
    rb: 20.0,
    rc: 2.0,
    cje: 11.0e-12,
    cjc: 4.5e-12,
  },
  "BC549": {
    name: "BC549",
    polarity: "npn",
    description: "Transistor NPN de ultra-bajo ruido para preamplificadores (30V, 100mA)",
    is: 1.8e-15,
    bf: 450.0,
    vaf: 90.0,
    rb: 15.0,
    rc: 1.5,
    cje: 11.0e-12,
    cjc: 4.5e-12,
  },
  "BD139": {
    name: "BD139",
    polarity: "npn",
    description: "Transistor NPN Driver de potencia media (80V, 1.5A, 12.5W)",
    is: 2.2e-13,
    bf: 120.0,
    vaf: 100.0,
    rb: 3.0,
    rc: 0.3,
  },
  "TIP31C": {
    name: "TIP31C",
    polarity: "npn",
    description: "Transistor NPN de potencia para fuentes y amplificadores (100V, 3A, 40W)",
    is: 1.5e-12,
    bf: 50.0,
    vaf: 100.0,
    rb: 2.0,
    rc: 0.15,
    cje: 120e-12,
    cjc: 60e-12,
  },
  "TIP120": {
    name: "TIP120",
    polarity: "npn",
    description: "Transistor Darlington NPN de potencia (60V, 5A, Beta 1000, 65W)",
    is: 1.0e-12,
    bf: 1000.0,
    vaf: 50.0,
    rb: 50.0,
    rc: 0.2,
  },
  "2N3055": {
    name: "2N3055",
    polarity: "npn",
    description: "Transistor NPN de alta potencia clásico en TO-3 (60V, 15A, 115W)",
    is: 5.0e-11,
    bf: 40.0,
    vaf: 70.0,
    rb: 0.8,
    rc: 0.05,
    cje: 450e-12,
    cjc: 220e-12,
  },
  "2N3906": {
    name: "2N3906",
    polarity: "pnp",
    description: "Transistor PNP complementario de 2N3904 (-40V, -200mA)",
    is: 1.41e-15,
    bf: 180.7,
    vaf: 18.7,
    rb: 15.0,
    rc: 1.5,
    cje: 4.5e-12,
    cjc: 3.6e-12,
  },
  "2N2907": {
    name: "2N2907",
    polarity: "pnp",
    description: "Transistor PNP complementario de 2N2222 (-60V, -600mA)",
    is: 1.434e-14,
    bf: 200.0,
    vaf: 60.0,
    rb: 10.0,
    rc: 1.0,
    cje: 25.0e-12,
    cjc: 8.0e-12,
  },
  "BC557": {
    name: "BC557",
    polarity: "pnp",
    description: "Transistor PNP complementario de BC547 (-45V, -100mA)",
    is: 1.8e-15,
    bf: 250.0,
    vaf: 70.0,
    rb: 20.0,
    rc: 2.0,
  },
  "BC558": {
    name: "BC558",
    polarity: "pnp",
    description: "Transistor PNP complementario de BC548 (-30V, -100mA)",
    is: 1.8e-15,
    bf: 220.0,
    vaf: 60.0,
    rb: 20.0,
    rc: 2.0,
  },
  "BD140": {
    name: "BD140",
    polarity: "pnp",
    description: "Transistor PNP Driver complementario de BD139 (-80V, -1.5A)",
    is: 2.2e-13,
    bf: 120.0,
    vaf: 100.0,
    rb: 3.0,
    rc: 0.3,
  },
  "TIP32C": {
    name: "TIP32C",
    polarity: "pnp",
    description: "Transistor PNP de potencia complementario de TIP31C (-100V, -3A)",
    is: 1.5e-12,
    bf: 50.0,
    vaf: 100.0,
    rb: 2.0,
    rc: 0.15,
    cje: 130e-12,
    cjc: 70e-12,
  },
};

export const COMMERCIAL_MOSFETS: Record<string, MosfetCommercialModel> = {
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
    description: "MOSFET Canal N de conmutación rápida (60V, 500mA, RDSon 2.5Ω)",
    vth: 2.0,
    ron: 2.5,
    wOverL: 150.0,
    cgs: 40e-12,
    cgd: 10e-12,
  },
  "BSS138": {
    name: "BSS138",
    polarity: "nmos",
    description: "MOSFET Canal N SMD de nivel lógico 3.3V/5V (50V, 220mA, RDSon 3.5Ω)",
    vth: 1.3,
    ron: 3.5,
    wOverL: 120.0,
    cgs: 35e-12,
    cgd: 8e-12,
  },
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
  "FQP30N06L": {
    name: "FQP30N06L",
    polarity: "nmos",
    description: "MOSFET de potencia Nivel Lógico (60V, 32A, Vth=1.5V, RDSon 35mΩ)",
    vth: 1.5,
    ron: 0.035,
    wOverL: 1200.0,
    cgs: 1.0e-9,
    cgd: 120e-12,
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
  "BSS84": {
    name: "BSS84",
    polarity: "pmos",
    description: "MOSFET Canal P SMD de nivel lógico (-50V, -130mA, RDSon 8Ω)",
    vth: -1.4,
    ron: 8.0,
    wOverL: 80.0,
    cgs: 30e-12,
    cgd: 10e-12,
  },
  "BS250": {
    name: "BS250",
    polarity: "pmos",
    description: "MOSFET Canal P de conmutación (-45V, -180mA, RDSon 9Ω)",
    vth: -2.0,
    ron: 9.0,
    wOverL: 70.0,
    cgs: 25e-12,
    cgd: 8e-12,
  },
  // Semiconductores de Banda Ancha WBG (SiC & GaN)
  "C3M0065090D": {
    name: "C3M0065090D",
    polarity: "nmos",
    description: "SiC MOSFET Wolfspeed (900V, 36A, RDSon 65mΩ, Body Diode 3.2V, 3rd Quadrant)",
    vth: 3.0,
    ron: 0.065,
    wOverL: 2000.0,
    cgs: 1.1e-9,
    cgd: 15e-12,
  },
  "NVH4L020N120SC1": {
    name: "NVH4L020N120SC1",
    polarity: "nmos",
    description: "SiC MOSFET onsemi EliteSiC (1200V, 103A, RDSon 20mΩ, Alta Temperatura)",
    vth: 2.7,
    ron: 0.020,
    wOverL: 5000.0,
    cgs: 3.2e-9,
    cgd: 25e-12,
  },
  "GS66508T": {
    name: "GS66508T",
    polarity: "nmos",
    description: "GaN E-HEMT GaN Systems (650V, 30A, RDSon 50mΩ, 2DEG Qrr=0, 3rd Quadrant)",
    vth: 1.4,
    ron: 0.050,
    wOverL: 3000.0,
    cgs: 260e-12,
    cgd: 6e-12,
  },
  "EPC2001C": {
    name: "EPC2001C",
    polarity: "nmos",
    description: "GaN FET EPC (100V, 36A, RDSon 5.6mΩ, Alta Frecuencia MHz, Qrr=0)",
    vth: 1.4,
    ron: 0.0056,
    wOverL: 8000.0,
    cgs: 420e-12,
    cgd: 12e-12,
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
  "J111": {
    name: "J111",
    polarity: "njf",
    description: "JFET Canal N para conmutación analógica rápida (Vp=-3.0V, RDSon<30Ω)",
    vto: -3.0,
    beta: 0.006,
    lambda: 0.02,
    cgs: 6.0e-12,
    cgd: 3.0e-12,
  },
  "J112": {
    name: "J112",
    polarity: "njf",
    description: "JFET Canal N para conmutadores y choppers (Vp=-2.0V, RDSon<50Ω)",
    vto: -2.0,
    beta: 0.004,
    lambda: 0.015,
    cgs: 5.0e-12,
    cgd: 2.5e-12,
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
  "J175": {
    name: "J175",
    polarity: "pjf",
    description: "JFET Canal P para conmutación analógica (Vp=4.0V, RDSon<150Ω)",
    vto: 4.0,
    beta: 0.0025,
    lambda: 0.02,
    cgs: 6.0e-12,
    cgd: 3.0e-12,
  },
  "J176": {
    name: "J176",
    polarity: "pjf",
    description: "JFET Canal P para preamplificadores y conmutadores (Vp=2.5V, RDSon<250Ω)",
    vto: 2.5,
    beta: 0.0015,
    lambda: 0.015,
    cgs: 5.0e-12,
    cgd: 2.5e-12,
  },
};

export const COMMERCIAL_OPAMPS: Record<string, OpampCommercialModel> = {
  "LM741": {
    name: "LM741",
    description: "Amplificador Operacional Estándar BJT (Aol=200k, GBW=1MHz, SR=0.5V/μs, Isc=25mA)",
    aol: 200000.0,
    gbwHz: 1.0e6,
    slewRateVUs: 0.5,
    rin: 2.0e6,
    rout: 75.0,
    vos: 0.001,
    ib: 80e-9,
    ios: 20e-9,
    iq: 0.0017,
    isc: 0.025,
    vdrop: 1.5,
    cmrr: 90.0,
    psrr: 90.0,
    en: 20e-9,
    in: 0.5e-12,
    fc: 100.0,
  },
  "TL072": {
    name: "TL072",
    description: "Amplificador Operacional BiFET JFET de bajo ruido (Aol=200k, GBW=3MHz, SR=13V/μs)",
    aol: 200000.0,
    gbwHz: 3.0e6,
    slewRateVUs: 13.0,
    rin: 1.0e12,
    rout: 50.0,
    vos: 0.003,
    ib: 30e-12,
    ios: 5e-12,
    iq: 0.0014,
    isc: 0.040,
    vdrop: 1.5,
    cmrr: 100.0,
    psrr: 100.0,
    en: 18e-9,
    in: 0.01e-12,
    fc: 1000.0,
  },
  "NE5532": {
    name: "NE5532",
    description: "Amplificador Operacional Dual de Audio de Ultra-Bajo Ruido (GBW=10MHz, SR=9V/μs, en=5nV)",
    aol: 100000.0,
    gbwHz: 10.0e6,
    slewRateVUs: 9.0,
    rin: 300000.0,
    rout: 0.3,
    vos: 0.0005,
    ib: 200e-9,
    ios: 10e-9,
    iq: 0.008,
    isc: 0.038,
    vdrop: 1.5,
    cmrr: 100.0,
    psrr: 100.0,
    en: 5e-9,
    in: 0.7e-12,
    fc: 100.0,
  },
  "LM358": {
    name: "LM358",
    description: "Amplificador Operacional de Fuente Simple y Bajo Consumo (GBW=1MHz, SR=0.6V/μs, Iq=0.5mA)",
    aol: 100000.0,
    gbwHz: 1.0e6,
    slewRateVUs: 0.6,
    rin: 2.0e6,
    rout: 50.0,
    vos: 0.002,
    ib: 45e-9,
    ios: 5e-9,
    iq: 0.0005,
    isc: 0.020,
    vdrop: 1.2,
    cmrr: 80.0,
    psrr: 80.0,
    en: 40e-9,
    in: 0.1e-12,
    fc: 100.0,
  },
  "OPA2134": {
    name: "OPA2134",
    description: "SoundPlus™ OpAmp Audio Hi-Fi Burr-Brown (GBW=8MHz, SR=20V/μs, THD+N=0.00008%)",
    aol: 1200000.0,
    gbwHz: 8.0e6,
    slewRateVUs: 20.0,
    rin: 1.0e13,
    rout: 10.0,
    vos: 0.0005,
    ib: 5e-12,
    ios: 2e-12,
    iq: 0.004,
    isc: 0.035,
    vdrop: 1.2,
    cmrr: 100.0,
    psrr: 100.0,
    en: 8e-9,
    in: 0.003e-12,
    fc: 500.0,
  },
  "MCP6002": {
    name: "MCP6002",
    description: "OpAmp CMOS Rail-to-Rail I/O 1.8V-6V (GBW=1MHz, SR=0.6V/μs, Iq=100μA, Vdrop=25mV)",
    aol: 100000.0,
    gbwHz: 1.0e6,
    slewRateVUs: 0.6,
    rin: 1.0e13,
    rout: 30.0,
    vos: 0.0045,
    ib: 1e-12,
    ios: 1e-12,
    iq: 0.0001,
    isc: 0.023,
    vdrop: 0.025,
    cmrr: 76.0,
    psrr: 86.0,
    en: 28e-9,
    in: 0.001e-12,
    fc: 1000.0,
  },
  "OP07": {
    name: "OP07",
    description: "OpAmp de Ultra-Bajo Offset y Alta Precisión (Vos=75μV, CMRR=110dB, PSRR=106dB)",
    aol: 400000.0,
    gbwHz: 0.6e6,
    slewRateVUs: 0.3,
    rin: 33.0e6,
    rout: 60.0,
    vos: 0.000075,
    ib: 1.8e-9,
    ios: 1.3e-9,
    iq: 0.002,
    isc: 0.025,
    vdrop: 1.5,
    cmrr: 110.0,
    psrr: 106.0,
    en: 10e-9,
    in: 0.2e-12,
    fc: 10.0,
  },
};

/**
 * Registra o actualiza dinámicamente un modelo de diodo comercial.
 */
export function registerCustomDiodeModel(model: DiodeCommercialModel): void {
  COMMERCIAL_DIODES[model.name] = model;
}

/**
 * Registra o actualiza dinámicamente un modelo de transistor BJT comercial.
 */
export function registerCustomBjtModel(model: BjtCommercialModel): void {
  COMMERCIAL_BJTS[model.name] = model;
}

/**
 * Registra o actualiza dinámicamente un modelo de MOSFET comercial.
 */
export function registerCustomMosfetModel(model: MosfetCommercialModel): void {
  COMMERCIAL_MOSFETS[model.name] = model;
}

/**
 * Registra o actualiza dinámicamente un modelo de JFET comercial.
 */
export function registerCustomJfetModel(model: JfetCommercialModel): void {
  COMMERCIAL_JFETS[model.name] = model;
}

/**
 * Registra automáticamente un ParsedSpiceModel en el catálogo comercial según su tipo físico.
 */
export function registerParsedSpiceModel(model: import("./spice_library_parser").ParsedSpiceModel): void {
  const t = model.type.toLowerCase();
  const p = model.parameters || {};
  const name = model.name;
  const desc = model.description || `Modelo SPICE ${name}`;

  if (t === "d") {
    registerCustomDiodeModel({
      name,
      description: desc,
      is: p["IS"] ?? 1e-14,
      rs: p["RS"] ?? 0.01,
      n: p["N"] ?? 1.0,
      cjo: p["CJO"],
      tt: p["TT"],
      bv: p["BV"],
      ibv: p["IBV"],
      forwardVoltage: p["VJ"] ?? 0.7,
    });
  } else if (t === "npn" || t === "pnp") {
    registerCustomBjtModel({
      name,
      polarity: t,
      description: desc,
      is: p["IS"] ?? 1e-14,
      bf: p["BF"] ?? 100.0,
      vaf: p["VAF"],
      rb: p["RB"],
      rc: p["RC"],
      cje: p["CJE"],
      cjc: p["CJC"],
    });
  } else if (t === "nmos" || t === "pmos") {
    registerCustomMosfetModel({
      name,
      polarity: t,
      description: desc,
      vth: p["VTO"] ?? p["VTH"] ?? (t === "nmos" ? 2.0 : -2.0),
      ron: p["RD"] ?? p["RON"] ?? 0.05,
      cgs: p["CGS"],
      cgd: p["CGD"],
    });
  } else if (t === "njf" || t === "pjf") {
    registerCustomJfetModel({
      name,
      polarity: t,
      description: desc,
      vto: p["VTO"] ?? (t === "njf" ? -2.0 : 2.0),
      beta: p["BETA"] ?? 1e-3,
      lambda: p["LAMBDA"],
      cgs: p["CGS"],
      cgd: p["CGD"],
    });
  }
}

