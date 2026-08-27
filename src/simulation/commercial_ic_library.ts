// ==========================================================================
// COMMERCIAL IC LIBRARY — Modelos SPICE pre-calibrados de fabricantes
// ==========================================================================

import type { ParsedSubcircuit } from "./spice_library_parser";
import { transpileSpiceSubcircuitToComponent, type TranspiledComponentSpec } from "./spice_to_component_transpiler";

export const COMMERCIAL_SUBCIRCUITS: readonly ParsedSubcircuit[] = [
  // ─── 1. TEMPORIZADOR NE555 (Texas Instruments DIP-8) ───────────────────
  {
    name: "NE555",
    pinNames: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRESH", "DISCH", "VCC"],
    pinCount: 8,
    pinLabels: {
      0: "GND",
      1: "TRIG",
      2: "OUT",
      3: "RESET",
      4: "CTRL",
      5: "THRESH",
      6: "DISCH",
      7: "VCC",
    },
    description: "Temporizador y oscilador de precisión estándar de la industria (DIP-8).",
    category: "Temporizadores",
    suggestedType: "timer",
    defaultParams: {},
    rawNetlist: `* Macromodelo Texas Instruments NE555 Timer
.SUBCKT NE555 GND TRIG OUT RESET CTRL THRESH DISCH VCC
R1 VCC CTRL 5K
R2 CTRL _INT_REF2 5K
R3 _INT_REF2 GND 5K
C_CTRL CTRL GND 10n
* Comparador de Umbral (Threshold)
E_COMP_TH _TH_OUT 0 THRESH CTRL 1000
* Comparador de Disparo (Trigger)
E_COMP_TR _TR_OUT 0 _INT_REF2 TRIG 1000
* Etapa de Salida y Descarga
R_OUT _TH_OUT OUT 10
R_DISCH DISCH GND 10MEG
.ENDS NE555`,
  },

  // ─── 2. REGULADOR LINEAL +5V LM7805 (STMicroelectronics TO-220) ───────
  {
    name: "LM7805",
    pinNames: ["IN", "GND", "OUT"],
    pinCount: 3,
    pinLabels: {
      0: "IN",
      1: "GND",
      2: "OUT",
    },
    description: "Regulador de tensión positiva fija +5V 1.5A con protección térmica (TO-220).",
    category: "Reguladores",
    suggestedType: "regulator",
    defaultParams: {},
    rawNetlist: `* STMicroelectronics LM7805 Voltage Regulator
.SUBCKT LM7805 IN GND OUT
V_REF _INT_REF GND DC 5.0
E_REG OUT GND _INT_REF GND 1.0
R_DROPOUT IN OUT 2.0
R_OUT OUT GND 100K
.ENDS LM7805`,
  },

  // ─── 3. REGULADOR LINEAL +12V LM7812 (STMicroelectronics TO-220) ──────
  {
    name: "LM7812",
    pinNames: ["IN", "GND", "OUT"],
    pinCount: 3,
    pinLabels: {
      0: "IN",
      1: "GND",
      2: "OUT",
    },
    description: "Regulador de tensión positiva fija +12V 1.5A (TO-220).",
    category: "Reguladores",
    suggestedType: "regulator",
    defaultParams: {},
    rawNetlist: `* STMicroelectronics LM7812 Voltage Regulator
.SUBCKT LM7812 IN GND OUT
V_REF _INT_REF GND DC 12.0
E_REG OUT GND _INT_REF GND 1.0
R_DROPOUT IN OUT 2.0
R_OUT OUT GND 100K
.ENDS LM7812`,
  },

  // ─── 4. REGULADOR AJUSTABLE LM317 (ON Semiconductor TO-220) ────────────
  {
    name: "LM317",
    pinNames: ["IN", "ADJ", "OUT"],
    pinCount: 3,
    pinLabels: {
      0: "IN",
      1: "ADJ",
      2: "OUT",
    },
    description: "Regulador de tensión positivo ajustable de 1.25V a 37V 1.5A (TO-220).",
    category: "Reguladores",
    suggestedType: "regulator",
    defaultParams: {},
    rawNetlist: `* ON Semiconductor LM317 Adjustable Regulator
.SUBCKT LM317 IN ADJ OUT
V_REF _INT_REF ADJ DC 1.25
E_REG OUT ADJ _INT_REF ADJ 1.0
R_DROPOUT IN OUT 2.5
I_ADJ ADJ GND DC 50u
.ENDS LM317`,
  },

  // ─── 5. COMPARADOR DOBLE DE TENSIÓN LM393 (Texas Instruments DIP-8) ───
  {
    name: "LM393",
    pinNames: ["1OUT", "1IN-", "1IN+", "GND", "2IN+", "2IN-", "2OUT", "VCC"],
    pinCount: 8,
    pinLabels: {
      0: "1OUT",
      1: "1IN-",
      2: "1IN+",
      3: "GND",
      4: "2IN+",
      5: "2IN-",
      6: "2OUT",
      7: "VCC",
    },
    description: "Comparador de tensión doble de precisión con salida en colector abierto (DIP-8).",
    category: "Comparadores",
    suggestedType: "comparator",
    defaultParams: {},
    rawNetlist: `* Texas Instruments LM393 Dual Comparator
.SUBCKT LM393 1OUT 1IN- 1IN+ GND 2IN+ 2IN- 2OUT VCC
E_COMP1 1OUT GND 1IN+ 1IN- 10000
E_COMP2 2OUT GND 2IN+ 2IN- 10000
R_IN1 1IN+ 1IN- 10MEG
R_IN2 2IN+ 2IN- 10MEG
.ENDS LM393`,
  },

  // ─── 6. OP-AMP JFET DE BAJO RUIDO TL072 (Texas Instruments DIP-8) ─────
  {
    name: "TL072",
    pinNames: ["1OUT", "1IN-", "1IN+", "VEE", "2IN+", "2IN-", "2OUT", "VCC"],
    pinCount: 8,
    pinLabels: {
      0: "1OUT",
      1: "1IN-",
      2: "1IN+",
      3: "VEE",
      4: "2IN+",
      5: "2IN-",
      6: "2OUT",
      7: "VCC",
    },
    description: "Amplificador operacional doble con entrada JFET de alta fidelidad y bajo ruido (DIP-8).",
    category: "Amplificadores",
    suggestedType: "opamp",
    defaultParams: {},
    rawNetlist: `* Texas Instruments TL072 Dual Low-Noise Op-Amp
.SUBCKT TL072 1OUT 1IN- 1IN+ VEE 2IN+ 2IN- 2OUT VCC
R_IN1 1IN+ 1IN- 1E12
E_GAIN1 1OUT GND 1IN+ 1IN- 200000
R_OUT1 1OUT GND 100
R_IN2 2IN+ 2IN- 1E12
E_GAIN2 2OUT GND 2IN+ 2IN- 200000
R_OUT2 2OUT GND 100
.ENDS TL072`,
  },

  // ─── 7. OP-AMP GENERAL LM741 (National Semiconductor 5-Pines) ─────────
  {
    name: "LM741",
    pinNames: ["IN+", "IN-", "V+", "V-", "OUT"],
    pinCount: 5,
    pinLabels: {
      0: "IN+",
      1: "IN-",
      2: "V+",
      3: "V-",
      4: "OUT",
    },
    description: "Amplificador operacional clásico de propósito general compensado internamente.",
    category: "Amplificadores",
    suggestedType: "opamp",
    defaultParams: {},
    rawNetlist: `* National Semiconductor LM741 Op-Amp
.SUBCKT LM741 IN+ IN- V+ V- OUT
R_IN IN+ IN- 2MEG
E_OP OUT 0 IN+ IN- 200000
R_OUT OUT 0 75
.ENDS LM741`,
  },

  // ─── 8. CONTROLADOR DE MOTOR EN PUENTE H L293D (ST DIP-16) ────────────
  {
    name: "L293D",
    pinNames: [
      "1,2EN", "1A", "1Y", "GND1", "GND2", "2Y", "2A", "VCC2",
      "3,4EN", "3A", "3Y", "GND3", "GND4", "4Y", "4A", "VCC1",
    ],
    pinCount: 16,
    pinLabels: {
      0: "1,2EN",
      1: "1A",
      2: "1Y",
      3: "GND",
      4: "GND",
      5: "2Y",
      6: "2A",
      7: "VCC2",
      8: "3,4EN",
      9: "3A",
      10: "3Y",
      11: "GND",
      12: "GND",
      13: "4Y",
      14: "4A",
      15: "VCC1",
    },
    description: "Controlador cuádruple en medio puente H con diodos flyback integrados para motores (DIP-16).",
    category: "Controladores de Potencia",
    suggestedType: "motor_driver",
    defaultParams: {},
    rawNetlist: `* STMicroelectronics L293D Quad Half-H Driver
.SUBCKT L293D 1_2EN 1A 1Y GND1 GND2 2Y 2A VCC2 3_4EN 3A 3Y GND3 GND4 4Y 4A VCC1
R_IN1 1A GND1 100K
R_IN2 2A GND1 100K
E_OUT1 1Y GND1 1A GND1 1.0
E_OUT2 2Y GND1 2A GND1 1.0
.ENDS L293D`,
  },

  // ─── 9. OP-AMP DUAL DE BAJO CONSUMO LM358 (Texas Instruments DIP-8) ────
  {
    name: "LM358",
    pinNames: ["1OUT", "1IN-", "1IN+", "GND", "2IN+", "2IN-", "2OUT", "VCC"],
    pinCount: 8,
    pinLabels: {
      0: "1OUT",
      1: "1IN-",
      2: "1IN+",
      3: "GND",
      4: "2IN+",
      5: "2IN-",
      6: "2OUT",
      7: "VCC",
    },
    description: "Amplificador operacional dual de bajo consumo y alimentación simple (DIP-8).",
    category: "Amplificadores",
    suggestedType: "opamp",
    defaultParams: {},
    rawNetlist: `* Texas Instruments LM358 Dual Operational Amplifier
.SUBCKT LM358 1OUT 1IN- 1IN+ GND 2IN+ 2IN- 2OUT VCC
R_IN1 1IN+ 1IN- 10MEG
E_GAIN1 1OUT GND 1IN+ 1IN- 100000
R_OUT1 1OUT GND 50
R_IN2 2IN+ 2IN- 10MEG
E_GAIN2 2OUT GND 2IN+ 2IN- 100000
R_OUT2 2OUT GND 50
.ENDS LM358`,
  },

  // ─── 10. OP-AMP CUÁDRUPLE LM324 (Texas Instruments DIP-14) ────────────
  {
    name: "LM324",
    pinNames: [
      "1OUT", "1IN-", "1IN+", "VCC", "2IN+", "2IN-", "2OUT",
      "3OUT", "3IN-", "3IN+", "GND", "4IN+", "4IN-", "4OUT",
    ],
    pinCount: 14,
    pinLabels: {
      0: "1OUT",
      1: "1IN-",
      2: "1IN+",
      3: "VCC",
      4: "2IN+",
      5: "2IN-",
      6: "2OUT",
      7: "3OUT",
      8: "3IN-",
      9: "3IN+",
      10: "GND",
      11: "4IN+",
      12: "4IN-",
      13: "4OUT",
    },
    description: "Amplificador operacional cuádruple de propósito general para alimentación simple o dual (DIP-14).",
    category: "Amplificadores",
    suggestedType: "opamp",
    defaultParams: {},
    rawNetlist: `* Texas Instruments LM324 Quad Operational Amplifier
.SUBCKT LM324 1OUT 1IN- 1IN+ VCC 2IN+ 2IN- 2OUT 3OUT 3IN- 3IN+ GND 4IN+ 4IN- 4OUT
R_IN1 1IN+ 1IN- 10MEG
E_GAIN1 1OUT GND 1IN+ 1IN- 100000
R_OUT1 1OUT GND 50
R_IN2 2IN+ 2IN- 10MEG
E_GAIN2 2OUT GND 2IN+ 2IN- 100000
R_OUT2 2OUT GND 50
R_IN3 3IN+ 3IN- 10MEG
E_GAIN3 3OUT GND 3IN+ 3IN- 100000
R_OUT3 3OUT GND 50
R_IN4 4IN+ 4IN- 10MEG
E_GAIN4 4OUT GND 4IN+ 4IN- 100000
R_OUT4 4OUT GND 50
.ENDS LM324`,
  },

  // ─── 11. AMPLIFICADOR DE AUDIO LM386 (Texas Instruments DIP-8) ────────
  {
    name: "LM386",
    pinNames: ["GAIN1", "IN-", "IN+", "GND", "VOUT", "VS", "BYPASS", "GAIN2"],
    pinCount: 8,
    pinLabels: {
      0: "GAIN1",
      1: "IN-",
      2: "IN+",
      3: "GND",
      4: "VOUT",
      5: "VS",
      6: "BYPASS",
      7: "GAIN2",
    },
    description: "Amplificador de potencia de audio de bajo voltaje para altavoces y auriculares (DIP-8).",
    category: "Amplificadores",
    suggestedType: "opamp",
    defaultParams: {},
    rawNetlist: `* Texas Instruments LM386 Low Voltage Audio Power Amplifier
.SUBCKT LM386 GAIN1 IN- IN+ GND VOUT VS BYPASS GAIN2
R_IN IN+ IN- 50K
E_AMP VOUT GND IN+ IN- 20
R_OUT VOUT GND 0.5
R_BYPASS BYPASS GND 15K
.ENDS LM386`,
  },

  // ─── 12. REFERENCIA DE PRECISIÓN TL431 (Texas Instruments TO-220) ──────
  {
    name: "TL431",
    pinNames: ["CATHODE", "ANODE", "REF"],
    pinCount: 3,
    pinLabels: {
      0: "CATHODE",
      1: "ANODE",
      2: "REF",
    },
    description: "Referencia de tensión de precisión programable de 2.495V a 36V (TO-220 / TO-92).",
    category: "Reguladores",
    suggestedType: "regulator",
    defaultParams: {},
    rawNetlist: `* Texas Instruments TL431 Adjustable Precision Shunt Regulator
.SUBCKT TL431 CATHODE ANODE REF
V_REF _INT_REF ANODE DC 2.495
E_AMP _CTRL ANODE REF _INT_REF 1000
G_SINK CATHODE ANODE _CTRL ANODE 1.0
R_LEAK CATHODE ANODE 100MEG
.ENDS TL431`,
  },

  // ─── 13. OPTOACOPLADOR PC817 (Sharp DIP-4) ────────────────────────────
  {
    name: "PC817",
    pinNames: ["ANODE", "CATHODE", "EMITTER", "COLLECTOR"],
    pinCount: 4,
    pinLabels: {
      0: "A",
      1: "K",
      2: "E",
      3: "C",
    },
    description: "Optoacoplador con fototransistor de aislamiento galvánico de alta inmunidad (DIP-4).",
    category: "Optoelectrónica",
    suggestedType: "optocoupler",
    defaultParams: {},
    rawNetlist: `* Sharp PC817 Phototransistor Optocoupler
.SUBCKT PC817 ANODE CATHODE EMITTER COLLECTOR
R_LED ANODE _INT_LED 50
D_LED _INT_LED CATHODE D_OPTO
.MODEL D_OPTO D (IS=1E-14 N=1.5 RS=1.2)
G_PHOTO COLLECTOR EMITTER _INT_LED CATHODE 0.02
R_LEAK COLLECTOR EMITTER 100MEG
.ENDS PC817`,
  },

  // ─── 14. REGULADOR LINEAL NEGATIVO -5V LM7905 (ST TO-220) ─────────────
  {
    name: "LM7905",
    pinNames: ["GND", "IN", "OUT"],
    pinCount: 3,
    pinLabels: {
      0: "GND",
      1: "IN",
      2: "OUT",
    },
    description: "Regulador de tensión negativa fija -5V 1.5A con protección térmica (TO-220).",
    category: "Reguladores",
    suggestedType: "regulator",
    defaultParams: {},
    rawNetlist: `* STMicroelectronics LM7905 -5V Negative Voltage Regulator
.SUBCKT LM7905 GND IN OUT
V_REF _INT_REF GND DC -5.0
E_REG OUT GND _INT_REF GND 1.0
R_DROPOUT IN OUT 2.0
R_OUT OUT GND 100K
.ENDS LM7905`,
  },

  // ─── 15. REGULADOR LINEAL NEGATIVO -12V LM7912 (ST TO-220) ────────────
  {
    name: "LM7912",
    pinNames: ["GND", "IN", "OUT"],
    pinCount: 3,
    pinLabels: {
      0: "GND",
      1: "IN",
      2: "OUT",
    },
    description: "Regulador de tensión negativa fija -12V 1.5A (TO-220).",
    category: "Reguladores",
    suggestedType: "regulator",
    defaultParams: {},
    rawNetlist: `* STMicroelectronics LM7912 -12V Negative Voltage Regulator
.SUBCKT LM7912 GND IN OUT
V_REF _INT_REF GND DC -12.0
E_REG OUT GND _INT_REF GND 1.0
R_DROPOUT IN OUT 2.0
R_OUT OUT GND 100K
.ENDS LM7912`,
  },

  // ─── 16. ARREGLO DARLINGTON ULN2003A (Texas Instruments DIP-16) ───────
  {
    name: "ULN2003A",
    pinNames: [
      "1B", "2B", "3B", "4B", "5B", "6B", "7B", "GND",
      "COM", "7C", "6C", "5C", "4C", "3C", "2C", "1C",
    ],
    pinCount: 16,
    pinLabels: {
      0: "1B",
      1: "2B",
      2: "3B",
      3: "4B",
      4: "5B",
      5: "6B",
      6: "7B",
      7: "GND",
      8: "COM",
      9: "7C",
      10: "6C",
      11: "5C",
      12: "4C",
      13: "3C",
      14: "2C",
      15: "1C",
    },
    description: "Matriz de 7 transistores Darlington de 500mA con diodos supresores para relés y motores (DIP-16).",
    category: "Controladores de Potencia",
    suggestedType: "motor_driver",
    defaultParams: {},
    rawNetlist: `* Texas Instruments ULN2003A 7-Channel Darlington Array
.SUBCKT ULN2003A 1B 2B 3B 4B 5B 6B 7B GND COM 7C 6C 5C 4C 3C 2C 1C
R_IN1 1B GND 2.7K
E_OUT1 1C GND 1B GND -100
R_IN2 2B GND 2.7K
E_OUT2 2C GND 2B GND -100
R_IN3 3B GND 2.7K
E_OUT3 3C GND 3B GND -100
R_IN4 4B GND 2.7K
E_OUT4 4C GND 4B GND -100
R_IN5 5B GND 2.7K
E_OUT5 5C GND 5B GND -100
R_IN6 6B GND 2.7K
E_OUT6 6C GND 6B GND -100
R_IN7 7B GND 2.7K
E_OUT7 7C GND 7B GND -100
.ENDS ULN2003A`,
  },

  // ─── 17. AMP DE INSTRUMENTACIÓN AD620 (Analog Devices DIP-8) ──────────
  {
    name: "AD620",
    pinNames: ["RG1", "IN-", "IN+", "-VS", "REF", "OUT", "+VS", "RG2"],
    pinCount: 8,
    pinLabels: {
      0: "RG1",
      1: "IN-",
      2: "IN+",
      3: "-VS",
      4: "REF",
      5: "OUT",
      6: "+VS",
      7: "RG2",
    },
    description: "Amplificador de instrumentación de precisión de bajo coste y ganancia ajustable (DIP-8).",
    category: "Amplificadores",
    suggestedType: "opamp",
    defaultParams: {},
    rawNetlist: `* Analog Devices AD620 Low Power Instrumentation Amplifier
.SUBCKT AD620 RG1 IN- IN+ VEE REF OUT VCC RG2
R_IN IN+ IN- 100MEG
E_AMP OUT REF IN+ IN- 1000
R_OUT OUT REF 0.1
.ENDS AD620`,
  },

  // ─── 18. CUÁDRUPLE COMPUERTA NAND 74HC00 (Nexperia DIP-14) ────────────
  {
    name: "74HC00",
    pinNames: [
      "1A", "1B", "1Y", "2A", "2B", "2Y", "GND",
      "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC",
    ],
    pinCount: 14,
    pinLabels: {
      0: "1A",
      1: "1B",
      2: "1Y",
      3: "2A",
      4: "2B",
      5: "2Y",
      6: "GND",
      7: "3Y",
      8: "3A",
      9: "3B",
      10: "4Y",
      11: "4A",
      12: "4B",
      13: "VCC",
    },
    description: "Cuádruple compuerta NAND CMOS de 2 entradas de alta velocidad (DIP-14).",
    category: "Lógica Digital",
    suggestedType: "logic_ic",
    defaultParams: {},
    rawNetlist: `* Nexperia 74HC00 Quad 2-Input NAND Gate
.SUBCKT 74HC00 1A 1B 1Y 2A 2B 2Y GND 3Y 3A 3B 4Y 4A 4B VCC
R_IN1A 1A GND 10MEG
R_IN1B 1B GND 10MEG
R_OUT1 1Y GND 50
R_IN2A 2A GND 10MEG
R_IN2B 2B GND 10MEG
R_OUT2 2Y GND 50
R_IN3A 3A GND 10MEG
R_IN3B 3B GND 10MEG
R_OUT3 3Y GND 50
R_IN4A 4A GND 10MEG
R_IN4B 4B GND 10MEG
R_OUT4 4Y GND 50
.ENDS 74HC00`,
  },

  // ─── 19. SÉXTUPLE INVERSOR 74HC04 (Nexperia DIP-14) ───────────────────
  {
    name: "74HC04",
    pinNames: [
      "1A", "1Y", "2A", "2Y", "3A", "3Y", "GND",
      "4Y", "4A", "5Y", "5A", "6Y", "6A", "VCC",
    ],
    pinCount: 14,
    pinLabels: {
      0: "1A",
      1: "1Y",
      2: "2A",
      3: "2Y",
      4: "3A",
      5: "3Y",
      6: "GND",
      7: "4Y",
      8: "4A",
      9: "5Y",
      10: "5A",
      11: "6Y",
      12: "6A",
      13: "VCC",
    },
    description: "Séxtuple inversor lógico NOT CMOS de alta velocidad (DIP-14).",
    category: "Lógica Digital",
    suggestedType: "logic_ic",
    defaultParams: {},
    rawNetlist: `* Nexperia 74HC04 Hex Inverter Gate
.SUBCKT 74HC04 1A 1Y 2A 2Y 3A 3Y GND 4Y 4A 5Y 5A 6Y 6A VCC
R_IN1 1A GND 10MEG
R_OUT1 1Y GND 50
R_IN2 2A GND 10MEG
R_OUT2 2Y GND 50
R_IN3 3A GND 10MEG
R_OUT3 3Y GND 50
R_IN4 4A GND 10MEG
R_OUT4 4Y GND 50
R_IN5 5A GND 10MEG
R_OUT5 5Y GND 50
R_IN6 6A GND 10MEG
R_OUT6 6Y GND 50
.ENDS 74HC04`,
  },

  // ─── 20. CONTADOR DECÁDICO CD4017 (Texas Instruments DIP-16) ──────────
  {
    name: "CD4017",
    pinNames: [
      "Q5", "Q1", "Q0", "Q2", "Q6", "Q7", "Q3", "GND",
      "Q4", "Q8", "Q9", "COUT", "RST", "CLK", "EN", "VDD",
    ],
    pinCount: 16,
    pinLabels: {
      0: "Q5",
      1: "Q1",
      2: "Q0",
      3: "Q2",
      4: "Q6",
      5: "Q7",
      6: "Q3",
      7: "GND",
      8: "Q4",
      9: "Q8",
      10: "Q9",
      11: "COUT",
      12: "RST",
      13: "CLK",
      14: "EN",
      15: "VDD",
    },
    description: "Contador Johnson / divisor por 10 con 10 salidas decodificadas (DIP-16).",
    category: "Lógica Digital",
    suggestedType: "logic_ic",
    defaultParams: {},
    rawNetlist: `* Texas Instruments CD4017 Decade Counter / Divider
.SUBCKT CD4017 Q5 Q1 Q0 Q2 Q6 Q7 Q3 GND Q4 Q8 Q9 COUT RST CLK EN VDD
R_CLK CLK GND 10MEG
R_RST RST GND 10MEG
R_EN EN GND 10MEG
.ENDS CD4017`,
  },

  // ─── 21. TRANSFORMADOR REDUCTOR 220V A 12V 50Hz (10VA) ────────────────
  {
    name: "TRAFO_220V_12V",
    pinNames: ["PRI1", "PRI2", "SEC1", "SEC2"],
    pinCount: 4,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SEC1",
      3: "SEC2",
    },
    description: "Transformador de red reductor 220V a 12V RMS 50Hz con resistencias parásitas de cobre (10VA).",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 220V to 12V 50Hz Step-Down Power Transformer
.SUBCKT TRAFO_220V_12V PRI1 PRI2 SEC1 SEC2
R_PRI PRI1 _P1 18.0
L_PRI _P1 PRI2 10.0H
R_SEC SEC1 _S1 0.12
L_SEC _S1 SEC2 29.75mH
K12 L_PRI L_SEC 0.998
.ENDS TRAFO_220V_12V`,
  },

  // ─── 22. TRANSFORMADOR REDUCTOR 120V A 12V 60Hz (10:1) ────────────────
  {
    name: "TRAFO_120V_12V",
    pinNames: ["PRI1", "PRI2", "SEC1", "SEC2"],
    pinCount: 4,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SEC1",
      3: "SEC2",
    },
    description: "Transformador de red reductor 120V a 12V RMS 60Hz (relación 10:1).",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 120V to 12V 60Hz Step-Down Power Transformer
.SUBCKT TRAFO_120V_12V PRI1 PRI2 SEC1 SEC2
R_PRI PRI1 _P1 8.5
L_PRI _P1 PRI2 4.0H
R_SEC SEC1 _S1 0.12
L_SEC _S1 SEC2 40.0mH
K12 L_PRI L_SEC 0.998
.ENDS TRAFO_120V_12V`,
  },

  // ─── 23. TRANSFORMADOR REDUCTOR INDUSTRIAL 220V A 24V (25VA) ──────────
  {
    name: "TRAFO_220V_24V",
    pinNames: ["PRI1", "PRI2", "SEC1", "SEC2"],
    pinCount: 4,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SEC1",
      3: "SEC2",
    },
    description: "Transformador reductor industrial 220V a 24V RMS 50Hz (25VA).",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 220V to 24V 50Hz Power Transformer
.SUBCKT TRAFO_220V_24V PRI1 PRI2 SEC1 SEC2
R_PRI PRI1 _P1 14.0
L_PRI _P1 PRI2 10.0H
R_SEC SEC1 _S1 0.35
L_SEC _S1 SEC2 0.119H
K12 L_PRI L_SEC 0.998
.ENDS TRAFO_220V_24V`,
  },

  // ─── 24. TRANSFORMADOR TOMA CENTRAL 220V A 12V-0-12V (Center Tap) ─────
  {
    name: "TRAFO_CT_12V",
    pinNames: ["PRI1", "PRI2", "SEC_A", "CT", "SEC_B"],
    pinCount: 5,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SEC_A",
      3: "CT",
      4: "SEC_B",
    },
    description: "Transformador con toma central 220V a 12V-0-12V RMS para fuentes simétricas bipolares.",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 220V to 12V-0-12V Center-Tapped Transformer
.SUBCKT TRAFO_CT_12V PRI1 PRI2 SEC_A CT SEC_B
R_PRI PRI1 _P1 15.0
L_PRI _P1 PRI2 10.0H
R_SEC1 SEC_A _S1 0.12
L_SEC1 _S1 CT 29.75mH
R_SEC2 CT _S2 0.12
L_SEC2 _S2 SEC_B 29.75mH
K1 L_PRI L_SEC1 0.998
K2 L_PRI L_SEC2 0.998
K3 L_SEC1 L_SEC2 0.998
.ENDS TRAFO_CT_12V`,
  },

  // ─── 25. TRANSFORMADOR TOMA CENTRAL 220V A 24V-0-24V (48V CT) ─────────
  {
    name: "TRAFO_CT_24V",
    pinNames: ["PRI1", "PRI2", "SEC_A", "CT", "SEC_B"],
    pinCount: 5,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SEC_A",
      3: "CT",
      4: "SEC_B",
    },
    description: "Transformador con toma central 220V a 24V-0-24V RMS (48V con derivación central).",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 220V to 24V-0-24V Center-Tapped Transformer
.SUBCKT TRAFO_CT_24V PRI1 PRI2 SEC_A CT SEC_B
R_PRI PRI1 _P1 12.0
L_PRI _P1 PRI2 10.0H
R_SEC1 SEC_A _S1 0.35
L_SEC1 _S1 CT 0.119H
R_SEC2 CT _S2 0.35
L_SEC2 _S2 SEC_B 0.119H
K1 L_PRI L_SEC1 0.998
K2 L_PRI L_SEC2 0.998
K3 L_SEC1 L_SEC2 0.998
.ENDS TRAFO_CT_24V`,
  },

  // ─── 26. TRANSFORMADOR DE AISLAMIENTO GALVÁNICO 1:1 ────────────────────
  {
    name: "TRAFO_ISOLATION_1TO1",
    pinNames: ["PRI1", "PRI2", "SEC1", "SEC2"],
    pinCount: 4,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SEC1",
      3: "SEC2",
    },
    description: "Transformador de aislamiento galvánico de seguridad 1:1 para rechazo de ruidos y seguridad eléctrica.",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 1:1 Galvanic Isolation Transformer
.SUBCKT TRAFO_ISOLATION_1TO1 PRI1 PRI2 SEC1 SEC2
R_PRI PRI1 _P1 4.5
L_PRI _P1 PRI2 5.0H
R_SEC SEC1 _S1 4.5
L_SEC _S1 SEC2 5.0H
K12 L_PRI L_SEC 0.999
.ENDS TRAFO_ISOLATION_1TO1`,
  },

  // ─── 27. TRANSFORMADOR DE AUDIO 600:600 OHM (Línea Balanceada) ────────
  {
    name: "TRAFO_AUDIO_600R",
    pinNames: ["IN+", "IN-", "OUT+", "OUT-"],
    pinCount: 4,
    pinLabels: {
      0: "IN+",
      1: "IN-",
      2: "OUT+",
      3: "OUT-",
    },
    description: "Transformador de audio balanceado 600Ω:600Ω para eliminación de bucles de tierra (20Hz - 20kHz).",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 600 Ohm to 600 Ohm Balanced Audio Isolation Transformer
.SUBCKT TRAFO_AUDIO_600R INP INM OUTP OUTM
R_PRI INP _P1 42.0
L_PRI _P1 INM 1.5H
R_SEC OUTP _S1 42.0
L_SEC _S1 OUTM 1.5H
K12 L_PRI L_SEC 0.996
.ENDS TRAFO_AUDIO_600R`,
  },

  // ─── 28. TRANSFORMADOR DE SALIDA DE AUDIO 10k:8 OHM (Altavoz) ─────────
  {
    name: "TRAFO_AUDIO_10K_8R",
    pinNames: ["PRI1", "PRI2", "SPK+", "SPK-"],
    pinCount: 4,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SPK+",
      3: "SPK-",
    },
    description: "Transformador de adaptación de impedancia de audio 10kΩ a 8Ω para etapas de amplificación.",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 10k to 8 Ohm Audio Output Transformer
.SUBCKT TRAFO_AUDIO_10K_8R PRI1 PRI2 SPKP SPKM
R_PRI PRI1 _P1 380.0
L_PRI _P1 PRI2 15.0H
R_SEC SPKP _S1 0.65
L_SEC _S1 SPKM 12.0mH
K12 L_PRI L_SEC 0.994
.ENDS TRAFO_AUDIO_10K_8R`,
  },

  // ─── 29. TRANSFORMADOR FLYBACK DE ALTA FRECUENCIA 100kHz (Ferrita) ────
  {
    name: "TRAFO_FLYBACK_HF",
    pinNames: ["PRI1", "PRI2", "SEC1", "SEC2"],
    pinCount: 4,
    pinLabels: {
      0: "PRI1",
      1: "PRI2",
      2: "SEC1",
      3: "SEC2",
    },
    description: "Transformador de ferrita de alta frecuencia (100kHz) para fuentes de alimentación conmutadas Flyback.",
    category: "Transformadores",
    suggestedType: "transformer",
    defaultParams: {},
    rawNetlist: `* 100kHz High-Frequency Ferrite Flyback Transformer
.SUBCKT TRAFO_FLYBACK_HF PRI1 PRI2 SEC1 SEC2
R_PRI PRI1 _P1 0.04
L_PRI _P1 PRI2 120uH
R_SEC SEC1 _S1 0.008
L_SEC _S1 SEC2 12uH
K12 L_PRI L_SEC 0.995
.ENDS TRAFO_FLYBACK_HF`,
  },
];

/**
 * Retorna todos los componentes comerciales transpilados listos para integrarse en la paleta.
 */
export function getCommercialPreloadedComponents(): TranspiledComponentSpec[] {
  return COMMERCIAL_SUBCIRCUITS.map((subckt) =>
    transpileSpiceSubcircuitToComponent(subckt),
  );
}
