// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { OscilloscopePanel, type TimeStepResult } from "./oscilloscope_panel";

describe("OscilloscopePanel", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      scale: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      measureText: vi.fn(() => ({ width: 50 })),
      roundRect: vi.fn(),
      closePath: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    document.body.innerHTML = `
      <div id="inst-oscilloscope" class="inst-content-box" style="display: flex;">
        <button id="osc-ch1-btn" class="btn-osc-mini active ch1-badge" type="button">CH1</button>
        <button id="osc-ch2-btn" class="btn-osc-mini ch2-badge" type="button">CH2</button>
        <button id="osc-ch3-btn" class="btn-osc-mini ch3-badge" type="button">CH3</button>
        <button id="osc-ch4-btn" class="btn-osc-mini ch4-badge" type="button">CH4</button>

        <select id="osc-time-div">
          <option value="0.02" selected>20 ms/div</option>
          <option value="0.001">1 ms/div</option>
        </select>
        <button id="osc-cursors-btn">📏 Cursores: OFF</button>
        <button id="osc-math-btn">🧮 MATH</button>
        <button id="osc-snapshot-btn">📸 PNG</button>
        <button id="osc-csv-btn">💾 CSV</button>

        <select id="osc-trigger-mode"><option value="ch1">CH1</option></select>
        <select id="osc-trigger-edge"><option value="rising">Subida</option></select>
        <button id="osc-trigger-50-btn">⚡ 50%</button>
        <input id="osc-trigger-level" type="range" value="0" />
        <select id="osc-trigger-sweep-mode"><option value="auto">Auto</option></select>

        <button id="osc-mode-ty" class="active">T-Y</button>
        <button id="osc-mode-xy">X-Y</button>
        <button id="osc-mode-split">⊞ Split</button>

        <div id="osc-focused-card" class="osc-focused-card ch1">
          <span id="osc-focused-title">CANAL 1 (CH1)</span>
          <button id="osc-focused-toggle-btn" class="active">ON</button>
          <input id="osc-focused-node" value="1" />
          <div id="osc-math-presets-row" style="display: none;">
            <button id="osc-math-preset-diff">CH1-CH2</button>
            <button id="osc-math-preset-mult">CH1*CH2</button>
            <button id="osc-math-preset-deriv">d/dt</button>
            <button id="osc-math-preset-integ">∫dt</button>
          </div>
          <div id="osc-coupling-row">
            <button id="osc-focused-dc" class="active">DC</button>
            <button id="osc-focused-ac">AC</button>
            <button id="osc-focused-gnd">GND</button>
            <button id="osc-focused-inv">INV</button>
          </div>
          <select id="osc-focused-volts"><option value="1">1.0 V/div</option></select>
          <span id="osc-focused-volts-badge">1.0 V/div</span>
          <input id="osc-focused-offset" type="range" value="0" />
          <span id="osc-focused-offset-val">0.00 V</span>
          <button id="osc-focused-pick-probe-btn">🎯 Probar</button>
        </div>

        <button id="osc-tab-ch1" class="active">CH1</button>
        <button id="osc-tab-ch2">CH2</button>
        <button id="osc-tab-ch3">CH3</button>
        <button id="osc-tab-ch4">CH4</button>
        <button id="osc-tab-math">MATH</button>

        <canvas id="osc-canvas" width="800" height="400"></canvas>

        <span id="osc-hud-ch1-val">1.0 V/div</span>
        <span id="osc-hud-ch2-val">1.0 V/div</span>
        <span id="osc-hud-ch3-val">1.0 V/div</span>
        <span id="osc-hud-ch4-val">1.0 V/div</span>
        <span id="osc-hud-time-val">20 ms/div</span>
        <span id="osc-trigger-level-val">0.0 V</span>

        <div id="osc-meas-ch1"></div>
        <div id="osc-meas-ch2"></div>
        <div id="osc-meas-ch3"></div>
        <div id="osc-meas-ch4"></div>
        <div id="osc-meas-cursors" class="meas-digital-card cursors">
          <span id="osc-meas-cursor-mode-badge"></span>
          <span id="meas-cursor-dt"></span>
          <span id="meas-cursor-freq"></span>
          <span id="meas-cursor-dv"></span>
          <span id="meas-cursor-slew"></span>
          <span id="meas-cursor-t1"></span>
          <span id="meas-cursor-t2"></span>
          <span id="meas-cursor-v1v2"></span>
        </div>
      </div>
    `;
  });

  it("se inicializa con valores por defecto de fábrica", () => {
    const panel = new OscilloscopePanel();
    expect(panel.voltsPerDivCh1).toBe(1.0);
    expect(panel.timeDivValue).toBe(0.02);
    expect(panel.ch1ProbeNode).toBe("1");
    expect(panel.couplingCh1).toBe("dc");
    expect(panel.invertCh1).toBe(false);
    expect(panel.triggerChannel).toBe("ch1");
  });

  it("conmuta canales enfocados y sincroniza la tarjeta activa", () => {
    const panel = new OscilloscopePanel();
    panel.setFocusedChannel("ch2");

    const title = document.querySelector("#osc-focused-title");
    expect(title?.textContent).toBe("CANAL 2 (CH2)");

    panel.setFocusedChannel("math");
    expect(title?.textContent).toBe("MATEMÁTICAS (CH1 - CH2)");
  });

  it("activa y desactiva canales programáticamente", () => {
    const panel = new OscilloscopePanel();
    const ch2Btn = document.querySelector("#osc-ch2-btn");

    panel.setChannelActive("ch2", true);
    expect(ch2Btn?.classList.contains("active")).toBe(true);

    panel.setChannelActive("ch2", false);
    expect(ch2Btn?.classList.contains("active")).toBe(false);
  });

  it("calcula y formatea voltajes y tiempos correctamente", () => {
    const panel = new OscilloscopePanel();
    expect(panel.formatVolts(2)).toBe("2.0 V/div");
    expect(panel.formatVolts(0.05)).toBe("50 mV/div");
    expect(panel.formatTime(0.02)).toBe("20 ms/div");
    expect(panel.formatTime(0.00005)).toBe("50 µs/div");
    expect(panel.formatOffset(1.5, 2.0)).toBe("+3.00 V (+1.5 div)");
  });

  it("serializa y restaura el estado persistente completo", () => {
    const panel = new OscilloscopePanel();
    panel.voltsPerDivCh1 = 5.0;
    panel.offsetCh1 = -1.5;
    panel.timeDivValue = 0.005;
    panel.isXyMode = true;
    panel.isCursorsEnabled = true;
    panel.cursorT1 = 0.25;

    const state = panel.getPersistentState();
    expect(state.voltsPerDiv[0]).toBe(5.0);
    expect(state.offsets[0]).toBe(-1.5);
    expect(state.timeDivValue).toBe(0.005);
    expect(state.isXyMode).toBe(true);
    expect(state.isCursorsEnabled).toBe(true);
    expect(state.cursorT1).toBe(0.25);

    const newPanel = new OscilloscopePanel();
    newPanel.applyPersistentState(state);
    expect(newPanel.voltsPerDivCh1).toBe(5.0);
    expect(newPanel.offsetCh1).toBe(-1.5);
    expect(newPanel.timeDivValue).toBe(0.005);
    expect(newPanel.isXyMode).toBe(true);
    expect(newPanel.isCursorsEnabled).toBe(true);
    expect(newPanel.cursorT1).toBe(0.25);
  });

  it("ejecuta autoFit con muestras simuladas", () => {
    const panel = new OscilloscopePanel();
    const mockResults: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 0.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 3.3 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "1": 0.0 }, branchCurrents: {} },
      { time: 0.003, nodeVoltages: { "1": 3.3 }, branchCurrents: {} },
    ];
    panel.transientResults = mockResults;
    const fitted = panel.autoFit("ch1");
    expect(fitted).toBe(true);
    expect(panel.voltsPerDivCh1).toBeGreaterThan(0);
  });

  it("configura y evalúa expresiones matemáticas arbitrarias (CH1 * CH2, DERIV, FFT)", () => {
    const panel = new OscilloscopePanel();
    const mockResults: TimeStepResult[] = [
      { time: 0.0, nodeVoltages: { "1": 2.0, "2": 3.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 4.0, "2": 5.0 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "1": 6.0, "2": 2.0 }, branchCurrents: {} },
    ];
    panel.transientResults = mockResults;
    panel.isMathEnabled = true;
    panel.mathExpression = "CH1 * CH2 + DERIV(CH1)";

    panel.setFocusedChannel("math");
    const nodeInput = document.querySelector<HTMLInputElement>("#osc-focused-node");
    expect(nodeInput?.value).toBe("CH1 * CH2 + DERIV(CH1)");

    panel.draw();

    const state = panel.getPersistentState();
    expect(state.isMathEnabled).toBe(true);
    expect(state.mathExpression).toBe("CH1 * CH2 + DERIV(CH1)");

    const newPanel = new OscilloscopePanel();
    newPanel.applyPersistentState(state);
    expect(newPanel.isMathEnabled).toBe(true);
    expect(newPanel.mathExpression).toBe("CH1 * CH2 + DERIV(CH1)");
  });

  it("calcula y exporta mediciones automáticas (.meas) desde el osciloscopio", () => {
    const panel = new OscilloscopePanel();
    panel.ch1ProbeNode = "1";
    panel.setChannelActive("ch1", true);

    const mockResults: TimeStepResult[] = [];
    for (let i = 0; i < 50; i++) {
      const t = i * 0.0001;
      const v = i === 0 ? 0 : 3.3 * (1 - Math.exp(-t / 0.001));
      mockResults.push({
        time: t,
        nodeVoltages: { "1": v },
        branchCurrents: {},
      });
    }
    panel.transientResults = mockResults;

    const measurements = panel.getAutomatedMeasurements();
    expect(measurements.length).toBeGreaterThan(0);
    const riseTime = measurements.find((m) => m.id === "meas-1-risetime");
    expect(riseTime).toBeDefined();
    expect(riseTime!.value).toBeGreaterThan(0);

    // Test export helpers
    expect(() => panel.exportMeasurementsCsv("Circuito Test")).not.toThrow();
    expect(() => panel.exportMeasurementsJson("Circuito Test")).not.toThrow();
  });

  it("mantiene escala y offset independiente para canal Math", () => {
    const panel = new OscilloscopePanel();
    panel.voltsPerDivCh1 = 1.0;
    panel.offsetCh1 = 0.0;
    panel.mathVoltsPerDiv = 5.0;
    panel.mathOffset = -2.0;

    expect(panel.getVoltsPerDiv("ch1")).toBe(1.0);
    expect(panel.getVoltsPerDiv("math")).toBe(5.0);
    expect(panel.getOffsetDivs("ch1")).toBe(0.0);
    expect(panel.getOffsetDivs("math")).toBe(-2.0);

    const state = panel.getPersistentState();
    expect(state.mathVoltsPerDiv).toBe(5.0);
    expect(state.mathOffset).toBe(-2.0);

    const newPanel = new OscilloscopePanel();
    newPanel.applyPersistentState(state);
    expect(newPanel.mathVoltsPerDiv).toBe(5.0);
    expect(newPanel.mathOffset).toBe(-2.0);
  });

  it("permite seleccionar canal objetivo para cursores de voltaje (cursorTargetChannel)", () => {
    const panel = new OscilloscopePanel();
    panel.cursorTargetChannel = "ch2";
    panel.voltsPerDivCh2 = 2.0;
    panel.offsetCh2 = 1.0;

    const state = panel.getPersistentState();
    expect(state.cursorTargetChannel).toBe("ch2");

    const newPanel = new OscilloscopePanel();
    newPanel.applyPersistentState(state);
    expect(newPanel.cursorTargetChannel).toBe("ch2");
  });

  it("ejecuta autoFit para canal Math", () => {
    const panel = new OscilloscopePanel();
    panel.ch1ProbeNode = "1";
    panel.ch2ProbeNode = "2";
    panel.isMathEnabled = true;
    panel.mathExpression = "CH1 - CH2";
    panel.transientResults = [
      { time: 0.0, nodeVoltages: { "1": 10.0, "2": 0.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 0.0, "2": 10.0 }, branchCurrents: {} },
    ];

    const fitted = panel.autoFit("math");
    expect(fitted).toBe(true);
    expect(panel.mathVoltsPerDiv).toBeGreaterThan(0);
  });

  it("permite rearmar el disparo single-shot mediante rearmSingleTrigger", () => {
    const panel = new OscilloscopePanel();
    panel.triggerSweepMode = "single";
    panel.isSimulating = true;
    panel.transientResults = [
      { time: 0, nodeVoltages: { "1": 0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 2.5 }, branchCurrents: {} },
    ];
    panel.rearmSingleTrigger();
    expect(panel.isOscPaused).toBe(false);
  });

  it("ejecuta busqueda y navegacion en trazas (searchNextCrossing, searchNextPeak, jumpToTime)", () => {
    const panel = new OscilloscopePanel();
    panel.ch1ProbeNode = "1";
    panel.transientResults = [
      { time: 0.0, nodeVoltages: { "1": -1.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 1.0 }, branchCurrents: {} },
      { time: 0.002, nodeVoltages: { "1": 3.0 }, branchCurrents: {} },
      { time: 0.003, nodeVoltages: { "1": 0.5 }, branchCurrents: {} },
    ];

    const crossingIdx = panel.searchNextCrossing("ch1", 0, "rising", 0);
    expect(crossingIdx).toBe(1);

    const peakIdx = panel.searchNextPeak("ch1", "max", 0);
    expect(peakIdx).toBe(2);

    const jumped = panel.jumpToTime(0.002);
    expect(jumped).toBe(true);
  });

  it("activa y configura el histograma de onda y prueba de mascara", () => {
    const panel = new OscilloscopePanel();
    panel.setHistogramEnabled(true);
    expect(panel.isHistogramEnabled).toBe(true);

    panel.setMaskTesting(true, {
      centerPoints: [{ time: 0, voltage: 5.0 }],
      deltaV: 0.5,
    });
    expect(panel.isMaskTestingEnabled).toBe(true);
    expect(panel.activeMask).toBeDefined();
  });

  it("ajusta el nivel de disparo al 50% mediante setTriggerTo50Percent", () => {
    const panel = new OscilloscopePanel();
    panel.ch1ProbeNode = "1";
    panel.triggerChannel = "ch1";
    panel.transientResults = [
      { time: 0.0, nodeVoltages: { "1": 1.0 }, branchCurrents: {} },
      { time: 0.001, nodeVoltages: { "1": 5.0 }, branchCurrents: {} },
    ];

    panel.setTriggerTo50Percent();
    expect(panel.triggerLevel).toBe(3.0);
  });

  it("aplica presets matemáticos rápidos al hacer clic en los botones", () => {
    const panel = new OscilloscopePanel();
    panel.setFocusedChannel("math");

    const diffBtn = document.querySelector<HTMLButtonElement>("#osc-math-preset-diff");
    const multBtn = document.querySelector<HTMLButtonElement>("#osc-math-preset-mult");
    const derivBtn = document.querySelector<HTMLButtonElement>("#osc-math-preset-deriv");
    const integBtn = document.querySelector<HTMLButtonElement>("#osc-math-preset-integ");

    diffBtn?.click();
    expect(panel.mathExpression).toBe("CH1 - CH2");

    multBtn?.click();
    expect(panel.mathExpression).toBe("CH1 * CH2");

    derivBtn?.click();
    expect(panel.mathExpression).toBe("DERIV(CH1)");

    integBtn?.click();
    expect(panel.mathExpression).toBe("INTEG(CH1)");
  });

  it("ajusta la velocidad de simulación y sincroniza el HUD", () => {
    const panel = new OscilloscopePanel();
    let emittedSpeed = 0;
    panel.onSpeedChanged = (spd) => {
      emittedSpeed = spd;
    };

    panel.setSimulationSpeed(2.0);
    expect(panel.simulationSpeedMultiplier).toBe(2.0);

    const speedSelect = document.querySelector<HTMLSelectElement>("#osc-sim-speed");
    if (speedSelect) {
      speedSelect.value = "5";
      speedSelect.dispatchEvent(new Event("change"));
      expect(panel.simulationSpeedMultiplier).toBe(5.0);
      expect(emittedSpeed).toBe(5.0);
    }
  });

  it("sincroniza el selector timeDivSelect tanto con formato decimal como exponencial", () => {
    const panel = new OscilloscopePanel();
    const timeSelect = document.querySelector<HTMLSelectElement>("#osc-time-div");
    if (timeSelect) {
      timeSelect.innerHTML = `
        <option value="1e-8">10 ns/div</option>
        <option value="0.001">1 ms/div</option>
        <option value="0.02">20 ms/div</option>
        <option value="1">1 s/div</option>
      `;

      panel.syncTimeDivSelect(1e-8);
      expect(timeSelect.value).toBe("1e-8");

      panel.syncTimeDivSelect(0.001);
      expect(timeSelect.value).toBe("0.001");

      panel.syncTimeDivSelect(1.0);
      expect(timeSelect.value).toBe("1");
    }
  });

  it("actualiza tarjetas de medición con formato correcto de kHz y MHz", () => {
    const panel = new OscilloscopePanel();
    const ch1Meas = document.querySelector("#osc-meas-ch1");
    if (ch1Meas) {
      ch1Meas.innerHTML = `
        <span class="val-vpp">--</span>
        <span class="val-vrms">--</span>
        <span class="val-vavg">--</span>
        <span class="val-freq">--</span>
        <span class="val-duty">--</span>
      `;
    }

    panel.ch1ProbeNode = "1";
    // Crear señal senoidal de 16 MHz (T = 62.5 ns)
    const period = 62.5e-9;
    panel.transientResults = [];
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * (period * 5);
      const v = Math.sin((2 * Math.PI * t) / period) * 2.5 + 2.5;
      panel.transientResults.push({
        time: t,
        nodeVoltages: { "1": v },
        branchCurrents: {},
      });
    }

    const canvas = document.querySelector<HTMLCanvasElement>("#osc-canvas");
    if (canvas) {
      Object.defineProperty(canvas, "clientWidth", { value: 800, configurable: true });
      Object.defineProperty(canvas, "clientHeight", { value: 400, configurable: true });
      canvas.getClientRects = () => [{ width: 800, height: 400, top: 0, left: 0, bottom: 400, right: 800, x: 0, y: 0, toJSON: () => ({}) }] as unknown as DOMRectList;
    }

    panel.draw();

    const freqEl = ch1Meas?.querySelector(".val-freq");
    expect(freqEl?.textContent).toBe("16.00 MHz");
  });

  it("alterna cíclicamente los modos de cursores al hacer clic en el botón", () => {
    const panel = new OscilloscopePanel();
    const cursorsBtn = document.querySelector<HTMLButtonElement>("#osc-cursors-btn");
    expect(panel.cursorMode).toBe("off");
    expect(cursorsBtn?.textContent).toBe("📏 Cursores: OFF");

    // Click 1: off -> both
    cursorsBtn?.click();
    expect(panel.cursorMode).toBe("both");
    expect(panel.isCursorsEnabled).toBe(true);
    expect(cursorsBtn?.textContent).toBe("📏 Ambos (XY)");

    // Click 2: both -> time
    cursorsBtn?.click();
    expect(panel.cursorMode).toBe("time");
    expect(cursorsBtn?.textContent).toBe("📏 Tiempo (X)");

    // Click 3: time -> voltage
    cursorsBtn?.click();
    expect(panel.cursorMode).toBe("voltage");
    expect(cursorsBtn?.textContent).toBe("📏 Voltaje (Y)");

    // Click 4: voltage -> track
    cursorsBtn?.click();
    expect(panel.cursorMode).toBe("track");
    expect(cursorsBtn?.textContent).toBe("📏 Rastreo (Track)");

    // Click 5: track -> off
    cursorsBtn?.click();
    expect(panel.cursorMode).toBe("off");
    expect(panel.isCursorsEnabled).toBe(false);
    expect(cursorsBtn?.textContent).toBe("📏 Cursores: OFF");
  });

  it("actualiza la tarjeta de telemetría de cursores (#osc-meas-cursors) al activar cursores", () => {
    const panel = new OscilloscopePanel();
    panel.ch1ProbeNode = "1";
    panel.timeDivValue = 0.01; // 10ms/div (ventana 100ms)

    const cursorsCard = document.querySelector("#osc-meas-cursors");
    expect(cursorsCard?.classList.contains("active")).toBe(false);

    panel.setCursorMode("both");
    expect(cursorsCard?.classList.contains("active")).toBe(true);

    const modeBadge = document.querySelector("#osc-meas-cursor-mode-badge");
    expect(modeBadge?.textContent).toContain("Ambos (XY)");

    const dtEl = document.querySelector("#meas-cursor-dt");
    const dvEl = document.querySelector("#meas-cursor-dv");
    // Default: cursorT1 = 0.25, cursorT2 = 0.75 -> deltaT = 0.5 * 100ms = 50ms
    expect(dtEl?.textContent).toBe("50.00 ms");
    // Default: cursorV1 = 1.0, cursorV2 = -1.0 -> deltaV = 2.00 V
    expect(dvEl?.textContent).toBe("+2.00 V");
  });

  it("persiste y restaura correctamente cursorMode en getPersistentState y applyPersistentState", () => {
    const panel = new OscilloscopePanel();
    panel.setCursorMode("track");

    const state = panel.getPersistentState();
    expect(state.cursorMode).toBe("track");
    expect(state.isCursorsEnabled).toBe(true);

    const newPanel = new OscilloscopePanel();
    newPanel.applyPersistentState(state);
    expect(newPanel.cursorMode).toBe("track");
    expect(newPanel.isCursorsEnabled).toBe(true);

    const cursorsBtn = document.querySelector<HTMLButtonElement>("#osc-cursors-btn");
    expect(cursorsBtn?.textContent).toBe("📏 Rastreo (Track)");
  });

  it("permite alternar el canal objetivo del cursor haciendo clic en el badge o al enfocar canales", () => {
    const panel = new OscilloscopePanel();
    panel.setCursorMode("both");
    expect(panel.cursorTargetChannel).toBe("ch1");

    const modeBadge = document.querySelector<HTMLButtonElement>("#osc-meas-cursor-mode-badge");
    expect(modeBadge?.textContent).toContain("[CH1 ▾]");

    // Clic en el badge cicla al siguiente canal: CH1 -> CH2
    modeBadge?.click();
    expect(panel.cursorTargetChannel).toBe("ch2");
    expect(modeBadge?.textContent).toContain("[CH2 ▾]");

    // Clic de nuevo: CH2 -> CH3
    modeBadge?.click();
    expect(panel.cursorTargetChannel).toBe("ch3");
    expect(modeBadge?.textContent).toContain("[CH3 ▾]");

    // Cambiar canal enfocado sincroniza automáticamente el canal del cursor
    panel.setFocusedChannel("ch4");
    expect(panel.cursorTargetChannel).toBe("ch4");
    expect(modeBadge?.textContent).toContain("[CH4 ▾]");

    panel.setFocusedChannel("math");
    expect(panel.cursorTargetChannel).toBe("math");
    expect(modeBadge?.textContent).toContain("[MATH ▾]");
  });
});




