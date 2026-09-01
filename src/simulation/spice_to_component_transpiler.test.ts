import { describe, expect, it, vi } from "vitest";
import {
  detectSubcircuitLayoutStyle,
  drawTranspiledSubcircuit,
  generateTranspiledPins,
  transpileSpiceModelToComponent,
  transpileSpiceSubcircuitToComponent,
  resolveCanonicalPinNames,
  evaluateTranspiledBehavior,
} from "./spice_to_component_transpiler";
import {
  COMMERCIAL_SUBCIRCUITS,
  getCommercialPreloadedComponents,
} from "./commercial_ic_library";
import type { ParsedSpiceModel, ParsedSubcircuit } from "./spice_library_parser";

describe("SPICE to Component Transpiler & Commercial IC Engine", () => {
  it("Detecta inteligentemente el estilo de encapsulado (TO-220, Op-Amp 5P, DIP, Transformer CT)", () => {
    // 1. Reguladores TO-220
    expect(detectSubcircuitLayoutStyle("LM7805", ["IN", "GND", "OUT"])).toBe("to220");
    expect(detectSubcircuitLayoutStyle("LM317", ["IN", "ADJ", "OUT"])).toBe("to220");
    expect(detectSubcircuitLayoutStyle("LM7812", ["VI", "GND", "VO"])).toBe("to220");
    expect(detectSubcircuitLayoutStyle("LM7905", ["GND", "IN", "OUT"])).toBe("to220");
    expect(detectSubcircuitLayoutStyle("LM7912", ["GND", "IN", "OUT"])).toBe("to220");
    expect(detectSubcircuitLayoutStyle("TL431", ["CATHODE", "ANODE", "REF"])).toBe("to220");

    // 2. Op-Amps 5P
    expect(detectSubcircuitLayoutStyle("LM741", ["IN+", "IN-", "V+", "V-", "OUT"])).toBe("opamp_5p");
    expect(detectSubcircuitLayoutStyle("OPA134", ["NON_INV", "INV", "VCC", "VEE", "OUT"])).toBe("opamp_5p");

    // 3. Transformadores con toma central (5 pines)
    expect(detectSubcircuitLayoutStyle("TRAFO_CT_12V", ["PRI1", "PRI2", "SEC_A", "CT", "SEC_B"])).toBe("transformer_ct");
    expect(detectSubcircuitLayoutStyle("TRAFO_CT_24V", ["PRI1", "PRI2", "SEC_A", "CT", "SEC_B"])).toBe("transformer_ct");

    // 4. DIP-4, DIP-8, DIP-14, DIP-16 y Transformadores 4P
    expect(detectSubcircuitLayoutStyle("PC817", ["ANODE", "CATHODE", "EMITTER", "COLLECTOR"])).toBe("dip");
    expect(detectSubcircuitLayoutStyle("TRAFO_220V_12V", ["PRI1", "PRI2", "SEC1", "SEC2"])).toBe("dip");
    expect(detectSubcircuitLayoutStyle("NE555", ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRESH", "DISCH", "VCC"])).toBe("dip");
    expect(detectSubcircuitLayoutStyle("LM358", ["1OUT", "1IN-", "1IN+", "GND", "2IN+", "2IN-", "2OUT", "VCC"])).toBe("dip");
    expect(detectSubcircuitLayoutStyle("LM386", ["GAIN1", "IN-", "IN+", "GND", "VOUT", "VS", "BYPASS", "GAIN2"])).toBe("dip");
    expect(detectSubcircuitLayoutStyle("AD620", ["RG1", "IN-", "IN+", "-VS", "REF", "OUT", "+VS", "RG2"])).toBe("dip");
    expect(detectSubcircuitLayoutStyle("LM393", ["1OUT", "1IN-", "1IN+", "GND", "2IN+", "2IN-", "2OUT", "VCC"])).toBe("dip");
    expect(detectSubcircuitLayoutStyle("LM324", new Array(14).fill("P"))).toBe("dip");
    expect(detectSubcircuitLayoutStyle("74HC00", new Array(14).fill("P"))).toBe("dip");
    expect(detectSubcircuitLayoutStyle("74HC04", new Array(14).fill("P"))).toBe("dip");
    expect(detectSubcircuitLayoutStyle("L293D", new Array(16).fill("P"))).toBe("dip");
    expect(detectSubcircuitLayoutStyle("ULN2003A", new Array(16).fill("P"))).toBe("dip");
    expect(detectSubcircuitLayoutStyle("CD4017", new Array(16).fill("P"))).toBe("dip");
  });

  it("Garantiza alineación matemática estricta a la cuadrícula EDA de 20px", () => {
    const testCases = [
      { name: "LM7805", pins: ["IN", "GND", "OUT"] },
      { name: "LM7905", pins: ["GND", "IN", "OUT"] },
      { name: "TL431", pins: ["CATHODE", "ANODE", "REF"] },
      { name: "LM741", pins: ["IN+", "IN-", "V+", "V-", "OUT"] },
      { name: "TRAFO_CT_12V", pins: ["PRI1", "PRI2", "SEC_A", "CT", "SEC_B"] },
      { name: "TRAFO_220V_12V", pins: ["PRI1", "PRI2", "SEC1", "SEC2"] },
      { name: "PC817", pins: ["ANODE", "CATHODE", "EMITTER", "COLLECTOR"] },
      { name: "NE555", pins: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRESH", "DISCH", "VCC"] },
      { name: "LM358", pins: ["1OUT", "1IN-", "1IN+", "GND", "2IN+", "2IN-", "2OUT", "VCC"] },
      { name: "LM386", pins: ["GAIN1", "IN-", "IN+", "GND", "VOUT", "VS", "BYPASS", "GAIN2"] },
      { name: "AD620", pins: ["RG1", "IN-", "IN+", "-VS", "REF", "OUT", "+VS", "RG2"] },
      { name: "LM324", pins: new Array(14).fill("P").map((_, i) => `P${i}`) },
      { name: "74HC00", pins: new Array(14).fill("P").map((_, i) => `P${i}`) },
      { name: "74HC04", pins: new Array(14).fill("P").map((_, i) => `P${i}`) },
      { name: "ULN2003A", pins: new Array(16).fill("P").map((_, i) => `P${i}`) },
      { name: "CD4017", pins: new Array(16).fill("P").map((_, i) => `Q${i}`) },
    ];

    for (const tc of testCases) {
      const style = detectSubcircuitLayoutStyle(tc.name, tc.pins);
      const { pins } = generateTranspiledPins(style, tc.pins);

      expect(pins.length).toBe(tc.pins.length);
      for (const pin of pins) {
        expect(Math.abs(pin.x % 20)).toBe(0);
        expect(Math.abs(pin.y % 20)).toBe(0);
      }
    }
  });

  it("Aplica geometría específica para Transformadores con Toma Central (transformer_ct)", () => {
    const pinNames = ["PRI1", "PRI2", "SEC_A", "CT", "SEC_B"];
    const { pins } = generateTranspiledPins("transformer_ct", pinNames);

    expect(pins).toHaveLength(5);
    // Primario: 2 pines a la izquierda (x = -40)
    expect(pins[0].x).toBe(-40);
    expect(pins[0].y).toBe(-20);
    expect(pins[1].x).toBe(-40);
    expect(pins[1].y).toBe(20);

    // Secundario con toma central: 3 pines a la derecha (x = 40)
    expect(pins[2].x).toBe(40);
    expect(pins[2].y).toBe(-20); // SEC+
    expect(pins[3].x).toBe(40);
    expect(pins[3].y).toBe(0);   // CT
    expect(pins[4].x).toBe(40);
    expect(pins[4].y).toBe(20);  // SEC-
  });

  it("Aplica numeración DIP en U (Counter-Clockwise) estándar de la industria", () => {
    // Caso 1: DIP-8
    const pinNames8 = ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRESH", "DISCH", "VCC"];
    const { pins: pins8 } = generateTranspiledPins("dip", pinNames8);

    expect(pins8).toHaveLength(8);

    // Pines 0 a 3 (Lado izquierdo, de arriba hacia abajo: x = -40)
    for (let i = 0; i < 4; i++) {
      expect(pins8[i].x).toBe(-40);
    }
    expect(pins8[0].y).toBeLessThan(pins8[1].y);
    expect(pins8[1].y).toBeLessThan(pins8[2].y);
    expect(pins8[2].y).toBeLessThan(pins8[3].y);

    // Pines 4 a 7 (Lado derecho, de abajo hacia arriba en U: x = 40)
    for (let i = 4; i < 8; i++) {
      expect(pins8[i].x).toBe(40);
    }
    expect(pins8[4].y).toBeGreaterThan(pins8[5].y);
    expect(pins8[5].y).toBeGreaterThan(pins8[6].y);
    expect(pins8[6].y).toBeGreaterThan(pins8[7].y);

    // Caso 2: DIP-4 (Optoacoplador PC817)
    const pinNames4 = ["A", "K", "E", "C"];
    const { pins: pins4 } = generateTranspiledPins("dip", pinNames4);
    expect(pins4).toHaveLength(4);
    expect(pins4[0].x).toBe(-40);
    expect(pins4[1].x).toBe(-40);
    expect(pins4[2].x).toBe(40);
    expect(pins4[3].x).toBe(40);
    expect(pins4[0].y).toBeLessThan(pins4[1].y);
    expect(pins4[2].y).toBeGreaterThan(pins4[3].y);
  });

  it("Transpila subcircuitos a especificaciones completas de componentes y catálogo", () => {
    const subckt: ParsedSubcircuit = {
      name: "NE555",
      pinNames: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRESH", "DISCH", "VCC"],
      pinCount: 8,
      pinLabels: { 0: "GND", 1: "TRIG", 2: "OUT", 3: "RESET", 4: "CTRL", 5: "THRESH", 6: "DISCH", 7: "VCC" },
      description: "Temporizador de precisión DIP-8",
      category: "Temporizadores",
      suggestedType: "timer",
      defaultParams: {},
      rawNetlist: ".SUBCKT NE555 ... .ENDS",
    };

    const transpiled = transpileSpiceSubcircuitToComponent(subckt);
    expect(transpiled.modelName).toBe("NE555");
    expect(transpiled.layoutStyle).toBe("dip");
    expect(transpiled.catalogItem.id).toBe("spice-ne555");
    expect(transpiled.catalogItem.category).toBe("macromodelos");
    expect(transpiled.catalogItem.tags).toContain("ne555");
    expect(transpiled.catalogItem.svgIconIeee).toContain("NE555");
  });

  it("escapa nombres de subcircuito antes de incorporarlos al SVG de la paleta", () => {
    const hostileName = "<img/onerror=alert(1)>";
    const subckt: ParsedSubcircuit = {
      name: hostileName,
      pinNames: ["IN", "OUT"],
      pinCount: 2,
      pinLabels: { 0: "IN", 1: "OUT" },
      description: "Modelo hostil de prueba",
      category: "Macromodelos",
      suggestedType: "subcircuit",
      defaultParams: {},
      rawNetlist: `.SUBCKT ${hostileName} IN OUT\n.ENDS ${hostileName}`,
    };

    const icon = transpileSpiceSubcircuitToComponent(subckt).catalogItem.svgIconIeee;
    expect(icon).toContain("&lt;img");
    expect(icon).not.toContain("<img");
    expect(icon).not.toContain("onerror=");
  });

  it("Valida la biblioteca comercial pre-cargada oficial (29 componentes comerciales estándar)", () => {
    const preloaded = getCommercialPreloadedComponents();
    expect(preloaded.length).toBe(COMMERCIAL_SUBCIRCUITS.length);
    expect(preloaded.length).toBe(29);

    const names = preloaded.map((p) => p.modelName);
    // Originales
    expect(names).toContain("NE555");
    expect(names).toContain("LM7805");
    expect(names).toContain("LM7812");
    expect(names).toContain("LM317");
    expect(names).toContain("LM393");
    expect(names).toContain("TL072");
    expect(names).toContain("LM741");
    expect(names).toContain("L293D");

    // Lote 2
    expect(names).toContain("LM358");
    expect(names).toContain("LM324");
    expect(names).toContain("LM386");
    expect(names).toContain("TL431");
    expect(names).toContain("PC817");
    expect(names).toContain("LM7905");
    expect(names).toContain("LM7912");
    expect(names).toContain("ULN2003A");
    expect(names).toContain("AD620");
    expect(names).toContain("74HC00");
    expect(names).toContain("74HC04");
    expect(names).toContain("CD4017");

    // Transformadores AC
    expect(names).toContain("TRAFO_220V_12V");
    expect(names).toContain("TRAFO_120V_12V");
    expect(names).toContain("TRAFO_220V_24V");
    expect(names).toContain("TRAFO_CT_12V");
    expect(names).toContain("TRAFO_CT_24V");
    expect(names).toContain("TRAFO_ISOLATION_1TO1");
    expect(names).toContain("TRAFO_AUDIO_600R");
    expect(names).toContain("TRAFO_AUDIO_10K_8R");
    expect(names).toContain("TRAFO_FLYBACK_HF");

    // Verificar que todos los netlists sean válidos y tengan .SUBCKT y .ENDS
    for (const sub of COMMERCIAL_SUBCIRCUITS) {
      expect(sub.rawNetlist).toContain(`.SUBCKT ${sub.name}`);
      expect(sub.rawNetlist).toContain(".ENDS");
    }
  });

  it("Renderiza vectorialmente en Canvas 2D los distintos encapsulados (TO-220, Op-Amp, DIP)", () => {
    const createMockCtx = () => ({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "middle",
    }) as unknown as CanvasRenderingContext2D;

    // 1. TO-220
    const ctx1 = createMockCtx();
    const compTo220 = {
      id: "X1",
      type: "x" as const,
      x: 0,
      y: 0,
      rotation: 0,
      value: "LM7805",
      modelName: "LM7805",
      terminalType: "to220" as const,
      pinCount: 3,
      pinLabels: { 0: "IN", 1: "GND", 2: "OUT" },
    };
    drawTranspiledSubcircuit(ctx1, compTo220, "#38BDF8");
    expect(ctx1.fillRect).toHaveBeenCalled();
    expect(ctx1.strokeRect).toHaveBeenCalled();

    // 2. Op-Amp 5P
    const ctx2 = createMockCtx();
    const compOpamp = {
      id: "X2",
      type: "x" as const,
      x: 0,
      y: 0,
      rotation: 0,
      value: "LM741",
      modelName: "LM741",
      terminalType: "opamp_5p" as const,
      pinCount: 5,
      pinLabels: { 0: "+", 1: "-", 2: "V+", 3: "V-", 4: "OUT" },
    };
    drawTranspiledSubcircuit(ctx2, compOpamp, "#38BDF8");
    expect(ctx2.fill).toHaveBeenCalled();

    // 3. DIP-8
    const ctx3 = createMockCtx();
    const compDip = {
      id: "X3",
      type: "x" as const,
      x: 0,
      y: 0,
      rotation: 0,
      value: "NE555",
      modelName: "NE555",
      terminalType: "dip" as const,
      pinCount: 8,
      pinLabels: { 0: "GND", 1: "TRIG", 2: "OUT", 3: "RESET", 4: "CTRL", 5: "THRESH", 6: "DISCH", 7: "VCC" },
    };
    drawTranspiledSubcircuit(ctx3, compDip, "#38BDF8");
    expect(ctx3.strokeRect).toHaveBeenCalled();
  });

  it("Transpila directivas .MODEL (Diodo, BJT NPN, MOSFET NMOS) a especificaciones nativas de componentes", () => {
    // 1. Diodo
    const diodeModel: ParsedSpiceModel = {
      name: "1N4007",
      type: "d",
      rawDefinition: ".MODEL 1N4007 D(IS=7.02n RS=0.034 N=1.8)",
      category: "Diodos",
      description: "Diodo rectificador 1000V 1A",
      parameters: { IS: 7.02e-9, RS: 0.034, N: 1.8 },
    };
    const diodeSpec = transpileSpiceModelToComponent(diodeModel);
    expect(diodeSpec.modelName).toBe("1N4007");
    expect(diodeSpec.catalogItem.type).toBe("diode");
    expect(diodeSpec.catalogItem.category).toBe("semiconductores");
    expect(diodeSpec.pins).toHaveLength(2);
    expect(diodeSpec.pins[0].label).toBe("A");
    expect(diodeSpec.pins[1].label).toBe("K");

    // 2. BJT NPN
    const bjtModel: ParsedSpiceModel = {
      name: "2N2222",
      type: "npn",
      rawDefinition: ".MODEL 2N2222 NPN(IS=14.34f BF=255.9)",
      category: "Transistores",
      description: "Transistor NPN 40V 800mA",
      parameters: { IS: 14.34e-15, BF: 255.9 },
    };
    const bjtSpec = transpileSpiceModelToComponent(bjtModel);
    expect(bjtSpec.modelName).toBe("2N2222");
    expect(bjtSpec.catalogItem.type).toBe("npn");
    expect(bjtSpec.catalogItem.category).toBe("semiconductores");
    expect(bjtSpec.pins).toHaveLength(3);
    expect(bjtSpec.pins.map((p) => p.label)).toEqual(["B", "C", "E"]);

    // 3. MOSFET NMOS
    const mosModel: ParsedSpiceModel = {
      name: "IRF540",
      type: "nmos",
      rawDefinition: ".MODEL IRF540 NMOS(VTO=3.5 RD=0.044)",
      category: "Transistores",
      parameters: { VTO: 3.5, RD: 0.044 },
    };
    const mosSpec = transpileSpiceModelToComponent(mosModel);
    expect(mosSpec.modelName).toBe("IRF540");
    expect(mosSpec.catalogItem.type).toBe("nmos");
    expect(mosSpec.catalogItem.category).toBe("semiconductores");
    expect(mosSpec.pins).toHaveLength(3);
    expect(mosSpec.pins.map((p) => p.label)).toEqual(["G", "D", "S"]);
  });

  it("Resuelve automáticamente nombres semánticos de pines a partir de la base de huellas canónicas", () => {
    // Op-Amp Dual LM358 con pines puramente numéricos
    const lm358Pins = resolveCanonicalPinNames("LM358", ["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(lm358Pins).toEqual(["1OUT", "1IN-", "1IN+", "V-", "2IN+", "2IN-", "2OUT", "V+"]);

    // Op-Amp Single LM741 (5 pines)
    const lm741Pins = resolveCanonicalPinNames("LM741", ["1", "2", "3", "4", "5"]);
    expect(lm741Pins).toEqual(["IN+", "IN-", "V+", "V-", "OUT"]);

    // Temporizador NE555
    const ne555Pins = resolveCanonicalPinNames("NE555", ["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(ne555Pins).toEqual(["GND", "TRIG", "OUT", "RESET", "CTRL", "THRESH", "DISCH", "VCC"]);

    // Regulador LM7805
    const lm7805Pins = resolveCanonicalPinNames("LM7805", ["1", "2", "3"]);
    expect(lm7805Pins).toEqual(["IN", "GND", "OUT"]);

    // Transformador con toma central
    const trafoPins = resolveCanonicalPinNames("TRAFO_CT_12V", ["1", "2", "3", "4", "5"]);
    expect(trafoPins).toEqual(["PRI1", "PRI2", "SEC1", "CT", "SEC2"]);
  });

  it("Evalúa telemetría dinámica en macromodelos (potencia disipada, temperatura y clipping de Op-Amp)", () => {
    // 1. Regulador TO-220: Disipación térmica
    const compReg = {
      id: "X_REG",
      type: "x" as const,
      x: 0,
      y: 0,
      rotation: 0,
      value: "LM7805",
      modelName: "LM7805",
      terminalType: "to220" as const,
    };
    // Vin = 12V, GND = 0V, Vout = 5V -> Vdiff = 7V, I = 5V/50R = 0.1A -> P = 0.7W
    const regTelemetry = evaluateTranspiledBehavior([12, 0, 5], compReg);
    expect(regTelemetry.glowLevel).toBeGreaterThan(0.1);
    expect(regTelemetry.temperatureCelsius).toBeGreaterThan(30);

    // 2. Op-Amp 5P: Detección de clipping / saturación
    const compOpamp = {
      id: "X_OPAMP",
      type: "x" as const,
      x: 0,
      y: 0,
      rotation: 0,
      value: "LM741",
      modelName: "LM741",
      terminalType: "opamp_5p" as const,
    };
    // IN+ = 2V, IN- = 0V, V+ = 15V, V- = -15V, VOUT = 14.8V (Saturado en riel positivo)
    const opampSat = evaluateTranspiledBehavior([2, 0, 15, -15, 14.8], compOpamp);
    expect(opampSat.buzzerLevel).toBe(1.0);
    expect(compOpamp.buzzerActive).toBe(true);

    // VOUT = 0V (Rango lineal)
    const opampLinear = evaluateTranspiledBehavior([2, 2, 15, -15, 0], compOpamp);
    expect(opampLinear.buzzerLevel ?? 0).toBe(0.0);
    expect(compOpamp.buzzerActive).toBe(false);
  });
});
