// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { OscilloscopePanel, type TimeStepResult } from "./oscilloscope_panel";

describe("OscilloscopePanel", () => {
  beforeEach(() => {
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
        <input id="osc-trigger-level" type="range" value="0" />
        <select id="osc-trigger-sweep-mode"><option value="auto">Auto</option></select>

        <button id="osc-mode-ty" class="active">T-Y</button>
        <button id="osc-mode-xy">X-Y</button>
        <button id="osc-mode-split">⊞ Split</button>

        <div id="osc-focused-card" class="osc-focused-card ch1">
          <span id="osc-focused-title">CANAL 1 (CH1)</span>
          <button id="osc-focused-toggle-btn" class="active">ON</button>
          <input id="osc-focused-node" value="1" />
          <button id="osc-focused-dc" class="active">DC</button>
          <button id="osc-focused-ac">AC</button>
          <button id="osc-focused-gnd">GND</button>
          <button id="osc-focused-inv">INV</button>
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
});

