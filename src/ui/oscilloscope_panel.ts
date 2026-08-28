import type { PvtConfig, SParameterResult } from "../simulation/mcu-types";
import type { PersistedOscilloscopeState } from "../persistence/circuit_file";
import {
  calculateOscilloscopeMetrics,
  calculateAutoFitSettings,
  calculateAutoFitForValues,
  calculateTrigger50Percent,
  calculatePhaseDifferenceDeg,
  calculateWaveformHistogram,
  evaluateMaskTest,
  findTimeIndex,
  searchNextCrossing,
  searchNextPeak,
  type AutoFitSettings,
  type MaskToleranceDefinition,
  buildTyTracePoints,
  findTriggerStartIndex,
  formatOscilloscopeTime,
  normalizeTriggerChannel,
  normalizeTriggerEdge,
  type OscilloscopeChannel,
  type TriggerEdge,
  OSCILLOSCOPE_TIME_PER_DIV,
  OSCILLOSCOPE_VOLTS_PER_DIV,
} from "./oscilloscope_model";
import {
  drawAcSweep,
  drawOscilloscopeCursors,
  drawPvtTraces,
  drawSplitTyReticle,
  drawTyReticle,
  drawXyTrace,
  drawXyNotice,
  drawWaveformHistogram,
  drawMaskOverlay,
  renderSmoothTracePath,
  formatCursorTime,
  formatCursorVoltage,
} from "./oscilloscope_renderer";
import {
  dragOscilloscopeCursor,
  hitTestOscilloscopeCursor,
  sampleVoltageAtNormalizedTime,
  sampleArrayAtNormalizedTime,
  type CursorMode,
  type OscilloscopeCursor,
} from "./oscilloscope_cursor_model";
import { ensureCanvasDpr } from "./canvas_dpr";
import { evaluateWaveformMath } from "./waveform_math_parser";
import { getInstrumentThemeColors } from "./instrument_theme";
import {
  calculateAutomatedMeasurements,
  exportMeasurementsToCsv,
  exportMeasurementsToJson,
  type AutomatedMeasurementItem,
} from "../simulation/automated_measurements";

export interface PvtRunResult {
  readonly config: PvtConfig;
  readonly transient: readonly TimeStepResult[];
  readonly converged: boolean;
  readonly error: string | null;
}

export interface PvtTrace {
  config?: PvtConfig;
  name?: string;
  label?: string;
  results: readonly TimeStepResult[];
  visible: boolean;
  color: string;
}

export interface TimeStepResult {
  time: number;
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  deviceTemperatures?: Record<string, number>;
}

export interface AcSweepResult {
  frequencies: number[];
  nodeAmplitudes: Record<string, number[]>;
  nodePhases: Record<string, number[]>;
  errorLog?: string;
}

export class OscilloscopePanel {
  private oscCanvas: HTMLCanvasElement | null = null;
  private oscCtx: CanvasRenderingContext2D | null = null;

  // Buttons referenced in DOM (top header)
  private oscCh1Btn: HTMLButtonElement | null = null;
  private oscCh2Btn: HTMLButtonElement | null = null;
  private oscCh3Btn: HTMLButtonElement | null = null;
  private oscCh4Btn: HTMLButtonElement | null = null;

  // Timebase & Trigger DOM elements
  private timeDivSelect: HTMLSelectElement | null = null;
  private simSpeedSelect: HTMLSelectElement | null = null;
  public simulationSpeedMultiplier = 1.0;
  private cursorsBtn: HTMLButtonElement | null = null;
  private mathBtn: HTMLButtonElement | null = null;
  private snapshotBtn: HTMLButtonElement | null = null;
  private csvBtn: HTMLButtonElement | null = null;

  private triggerModeSelect: HTMLSelectElement | null = null;
  private triggerEdgeSelect: HTMLSelectElement | null = null;
  private triggerLevelSlider: HTMLInputElement | null = null;
  private triggerSweepModeSelect: HTMLSelectElement | null = null;
  private trigger50Btn: HTMLButtonElement | null = null;

  private modeTyBtn: HTMLButtonElement | null = null;
  private modeXyBtn: HTMLButtonElement | null = null;
  private modeSplitBtn: HTMLButtonElement | null = null;
  private isSplitMode = false;

  // Tabbed Focused Channel UI elements
  private focusedChannel: "ch1" | "ch2" | "ch3" | "ch4" | "math" = "ch1";
  private focusedCard: HTMLElement | null = null;
  private focusedTitle: HTMLElement | null = null;
  private focusedToggleBtn: HTMLButtonElement | null = null;
  private focusedNodeInput: HTMLInputElement | null = null;
  private focusedDcBtn: HTMLButtonElement | null = null;
  private focusedAcBtn: HTMLButtonElement | null = null;
  private focusedGndBtn: HTMLButtonElement | null = null;
  private focusedInvBtn: HTMLButtonElement | null = null;
  private focusedVoltsSelect: HTMLSelectElement | null = null;
  private focusedVoltsBadge: HTMLElement | null = null;
  private focusedOffsetSlider: HTMLInputElement | null = null;
  private focusedOffsetVal: HTMLElement | null = null;

  // Math Presets and Coupling container
  private mathPresetsRow: HTMLElement | null = null;
  private couplingRow: HTMLElement | null = null;
  private mathPresetDiffBtn: HTMLButtonElement | null = null;
  private mathPresetMultBtn: HTMLButtonElement | null = null;
  private mathPresetDerivBtn: HTMLButtonElement | null = null;
  private mathPresetIntegBtn: HTMLButtonElement | null = null;

  private tabCh1: HTMLButtonElement | null = null;
  private tabCh2: HTMLButtonElement | null = null;
  private tabCh3: HTMLButtonElement | null = null;
  private tabCh4: HTMLButtonElement | null = null;
  private tabMath: HTMLButtonElement | null = null;

  // External references updated by main.ts
  public activeAnalysisMode: 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' | 'PVT' | 'SPAR' = 'DC';
  public isSimulating = false;
  public isOscPaused = false;
  public oscTime = 0;
  public sweepTime = 0.0;
  public readonly transientDuration = 0.05;
  public transientResults: TimeStepResult[] = [];
  public acSweepResults: AcSweepResult | null = null;
  public liveVoltages: Record<string, number> = {};

  // 4 channels probe nodes
  public ch1ProbeNode: string | null = "1";
  public ch2ProbeNode: string | null = null;
  public ch3ProbeNode: string | null = null;
  public ch4ProbeNode: string | null = null;

  // Advanced Digital Storage Features
  public interpolationMode: "linear" | "sinc" = "linear";
  public phosphorDecay: "off" | "short" | "medium" | "infinite" = "off";

  public onFrameUpdate?: (sweepTime: number) => void;
  public onSpeedChanged?: (speed: number) => void;

  // PVT Multi-corner overlay
  public pvtMode = false;
  public pvtTraces: PvtTrace[] = [];
  public pvtColors: string[] = ['#FACC15', '#38BDF8', '#F43F5E', '#4ADE80', '#FB923C'];

  // SPAR (S-Parameter) state
  public sparResult: SParameterResult | null = null;
  public sparCh1Index = 0;
  public sparCh2Index = 1;

  // Interactive Cursors & Marker Dragging
  public isCursorsEnabled = false;
  public cursorMode: CursorMode = "off";
  public cursorTargetChannel: "ch1" | "ch2" | "ch3" | "ch4" | "math" = "ch1";
  private cursorT1 = 0.25; // fraction of width
  private cursorT2 = 0.75; // fraction of width
  private cursorV1 = 1.0;  // volts
  private cursorV2 = -1.0; // volts
  private hoveredCursor: OscilloscopeCursor | null = null;
  private draggingMarker: null | { type: "cursor"; cursor: OscilloscopeCursor } | { type: "channelOffset"; channel: 1 | 2 | 3 | 4 } | { type: "triggerLevel" } = null;

  public onPickProbeRequested?: (channel: "ch1" | "ch2" | "ch3" | "ch4") => void;
  public onProbeNodeChanged?: (channel: "ch1" | "ch2" | "ch3" | "ch4", nodeId: string | null) => void;

  // Calibration settings per channel
  public voltsPerDivCh1 = 1.0;
  public voltsPerDivCh2 = 1.0;
  public voltsPerDivCh3 = 1.0;
  public voltsPerDivCh4 = 1.0;
  public mathVoltsPerDiv = 1.0;

  // Offsets in Divisions (-4.0 to +4.0 div)
  public offsetCh1 = 0.0;
  public offsetCh2 = 0.0;
  public offsetCh3 = 0.0;
  public offsetCh4 = 0.0;
  public mathOffset = 0.0;

  // Channel Coupling & Inversion
  public couplingCh1: "dc" | "ac" | "gnd" = "dc";
  public couplingCh2: "dc" | "ac" | "gnd" = "dc";
  public couplingCh3: "dc" | "ac" | "gnd" = "dc";
  public couplingCh4: "dc" | "ac" | "gnd" = "dc";

  public invertCh1 = false;
  public invertCh2 = false;
  public invertCh3 = false;
  public invertCh4 = false;

  public isMathEnabled = false;
  public mathExpression = "CH1 - CH2";

  // Histogram / PDF & Mask Testing State
  public isHistogramEnabled = false;
  public isMaskTestingEnabled = false;
  public activeMask: MaskToleranceDefinition | null = null;

  public timeDivValue = 0.02; // seconds/div (default 20ms/div)
  public isXyMode = false;

  // Triggering
  public triggerChannel: OscilloscopeChannel = "ch1";
  public triggerEdge: TriggerEdge = "rising";
  public triggerLevel = 0.0; // volts
  public triggerSweepMode: "auto" | "normal" | "single" = "auto";
  private singleTriggerFired = false;

  private oscMouseX: number | null = null;
  private oscMouseY: number | null = null;
  private animationFrameId: number | null = null;
  private lastMeasurementsUpdateAt = 0;
  private readonly measurementsUpdateIntervalMs = 250;

  public formatOffset(divs: number, voltsPerDiv: number): string {
    const v = divs * voltsPerDiv;
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)} V (${divs >= 0 ? '+' : ''}${divs.toFixed(1)} div)`;
  }

  public formatVolts(val: number): string {
    return val >= 1 ? `${val.toFixed(1)} V/div` : `${(val * 1000).toFixed(0)} mV/div`;
  }

  public formatTime(val: number): string {
    return formatOscilloscopeTime(val);
  }

  public syncTimeDivSelect(val: number): void {
    if (!this.timeDivSelect) return;
    this.timeDivSelect.value = val.toString();
    if (this.timeDivSelect.selectedIndex === -1) {
      for (let i = 0; i < this.timeDivSelect.options.length; i++) {
        const optVal = parseFloat(this.timeDivSelect.options[i].value);
        if (Math.abs(optVal - val) <= Math.max(1e-12, val * 0.05)) {
          this.timeDivSelect.selectedIndex = i;
          break;
        }
      }
    }
  }

  public getVoltsPerDiv(ch: "ch1" | "ch2" | "ch3" | "ch4" | "math"): number {
    if (ch === "math") return this.mathVoltsPerDiv;
    if (ch === "ch1") return this.voltsPerDivCh1;
    if (ch === "ch2") return this.voltsPerDivCh2;
    if (ch === "ch3") return this.voltsPerDivCh3;
    return this.voltsPerDivCh4;
  }

  public getOffsetDivs(ch: "ch1" | "ch2" | "ch3" | "ch4" | "math"): number {
    if (ch === "math") return this.mathOffset;
    if (ch === "ch1") return this.offsetCh1;
    if (ch === "ch2") return this.offsetCh2;
    if (ch === "ch3") return this.offsetCh3;
    return this.offsetCh4;
  }

  public getPersistentState(): PersistedOscilloscopeState {
    return {
      channelsEnabled: [
        this.oscCh1Btn?.classList.contains("active") ?? true,
        this.oscCh2Btn?.classList.contains("active") ?? false,
        this.oscCh3Btn?.classList.contains("active") ?? false,
        this.oscCh4Btn?.classList.contains("active") ?? false,
      ],
      voltsPerDiv: [
        this.voltsPerDivCh1,
        this.voltsPerDivCh2,
        this.voltsPerDivCh3,
        this.voltsPerDivCh4,
      ],
      offsets: [this.offsetCh1, this.offsetCh2, this.offsetCh3, this.offsetCh4],
      timeDivValue: this.timeDivValue,
      isXyMode: this.isXyMode,
      isCursorsEnabled: this.isCursorsEnabled,
      cursorMode: this.isCursorsEnabled ? (this.cursorMode === "off" ? "both" : this.cursorMode) : "off",
      isMathEnabled: this.isMathEnabled,
      mathExpression: this.mathExpression,
      mathVoltsPerDiv: this.mathVoltsPerDiv,
      mathOffset: this.mathOffset,
      cursorTargetChannel: this.cursorTargetChannel,
      triggerChannel: this.triggerChannel,
      triggerEdge: this.triggerEdge,
      triggerLevel: this.triggerLevel,
      cursorT1: this.cursorT1,
      cursorT2: this.cursorT2,
      cursorV1: this.cursorV1,
      cursorV2: this.cursorV2,
    };
  }

  public updateCursorButtonState(): void {
    if (!this.cursorsBtn) return;
    const isCursorsOn = this.cursorMode !== "off" && this.isCursorsEnabled;
    this.cursorsBtn.classList.toggle("active", isCursorsOn);
    const labels: Record<CursorMode, string> = {
      off: "📏 Cursores: OFF",
      both: "📏 Ambos (XY)",
      time: "📏 Tiempo (X)",
      voltage: "📏 Voltaje (Y)",
      track: "📏 Rastreo (Track)",
    };
    this.cursorsBtn.textContent = labels[this.cursorMode] ?? (isCursorsOn ? "📏 Cursores: ON" : "📏 Cursores: OFF");
    this.cursorsBtn.title = `Modo Cursores: ${labels[this.cursorMode] ?? "Activo"} (Clic para alternar)`;
  }

  public setCursorMode(mode: CursorMode): void {
    this.cursorMode = mode;
    this.isCursorsEnabled = mode !== "off";
    this.updateCursorButtonState();
    this.updateMeasurementsIfNeeded(
      [
        { id: "osc-meas-ch1", node: this.ch1ProbeNode, active: this.isChannelActive("ch1"), color: "#FACC15" },
        { id: "osc-meas-ch2", node: this.ch2ProbeNode, active: this.isChannelActive("ch2"), color: "#38BDF8" },
        { id: "osc-meas-ch3", node: this.ch3ProbeNode, active: this.isChannelActive("ch3"), color: "#F43F5E" },
        { id: "osc-meas-ch4", node: this.ch4ProbeNode, active: this.isChannelActive("ch4"), color: "#4ADE80" },
      ],
    );
    this.draw();
  }

  public applyPersistentState(state: PersistedOscilloscopeState): void {
    [
      this.voltsPerDivCh1,
      this.voltsPerDivCh2,
      this.voltsPerDivCh3,
      this.voltsPerDivCh4,
    ] = state.voltsPerDiv;
    [this.offsetCh1, this.offsetCh2, this.offsetCh3, this.offsetCh4] = state.offsets;
    this.timeDivValue = state.timeDivValue;
    this.isXyMode = state.isXyMode;
    if (state.cursorMode && state.cursorMode !== "off") {
      this.cursorMode = state.cursorMode;
      this.isCursorsEnabled = true;
    } else if (state.isCursorsEnabled) {
      this.isCursorsEnabled = true;
      this.cursorMode = "both";
    } else {
      this.isCursorsEnabled = false;
      this.cursorMode = "off";
    }
    if (typeof state.isMathEnabled === "boolean") {
      this.isMathEnabled = state.isMathEnabled;
      this.mathBtn?.classList.toggle("active", this.isMathEnabled);
    }
    if (typeof state.mathExpression === "string") {
      this.mathExpression = state.mathExpression;
    }
    if (typeof state.mathVoltsPerDiv === "number") {
      this.mathVoltsPerDiv = state.mathVoltsPerDiv;
    }
    if (typeof state.mathOffset === "number") {
      this.mathOffset = state.mathOffset;
    }
    if (state.cursorTargetChannel) {
      this.cursorTargetChannel = state.cursorTargetChannel;
    }
    this.triggerChannel = state.triggerChannel;
    this.triggerEdge = state.triggerEdge;
    this.triggerLevel = state.triggerLevel;
    this.cursorT1 = state.cursorT1;
    this.cursorT2 = state.cursorT2;
    this.cursorV1 = state.cursorV1;
    this.cursorV2 = state.cursorV2;

    const channelButtons = [this.oscCh1Btn, this.oscCh2Btn, this.oscCh3Btn, this.oscCh4Btn];
    channelButtons.forEach((button, index) => {
      button?.classList.toggle("active", state.channelsEnabled[index]);
    });

    this.syncTimeDivSelect(state.timeDivValue);
    if (this.triggerModeSelect) this.triggerModeSelect.value = state.triggerChannel;
    if (this.triggerEdgeSelect) this.triggerEdgeSelect.value = state.triggerEdge;
    if (this.triggerLevelSlider) {
      const vPerDiv = this.getVoltsPerDiv(state.triggerChannel) || 1;
      this.triggerLevelSlider.value = (state.triggerLevel / vPerDiv).toFixed(2);
    }

    this.modeTyBtn?.classList.toggle("active", !state.isXyMode);
    this.modeXyBtn?.classList.toggle("active", state.isXyMode);
    this.updateCursorButtonState();
    this.syncFocusedChannelUI();
    this.updateHud();
    this.draw();
  }

  constructor() {
    this.oscCanvas = document.querySelector("#osc-canvas");
    this.oscCh1Btn = document.querySelector("#osc-ch1-btn");
    this.oscCh2Btn = document.querySelector("#osc-ch2-btn");
    this.oscCh3Btn = document.querySelector("#osc-ch3-btn");
    this.oscCh4Btn = document.querySelector("#osc-ch4-btn");

    this.timeDivSelect = document.querySelector("#osc-time-div");
    this.simSpeedSelect = document.querySelector("#osc-sim-speed");
    this.cursorsBtn = document.querySelector("#osc-cursors-btn");
    this.mathBtn = document.querySelector("#osc-math-btn");
    this.snapshotBtn = document.querySelector("#osc-snapshot-btn");
    this.csvBtn = document.querySelector("#osc-csv-btn");

    this.triggerModeSelect = document.querySelector("#osc-trigger-mode");
    this.triggerEdgeSelect = document.querySelector("#osc-trigger-edge");
    this.triggerLevelSlider = document.querySelector("#osc-trigger-level");
    this.triggerSweepModeSelect = document.querySelector("#osc-trigger-sweep-mode");
    this.trigger50Btn = document.querySelector("#osc-trigger-50-btn");

    this.modeTyBtn = document.querySelector("#osc-mode-ty");
    this.modeXyBtn = document.querySelector("#osc-mode-xy");
    this.modeSplitBtn = document.querySelector("#osc-mode-split");

    // Focused Channel UI
    this.focusedCard = document.querySelector("#osc-focused-card");
    this.focusedTitle = document.querySelector("#osc-focused-title");
    this.focusedToggleBtn = document.querySelector("#osc-focused-toggle-btn");
    this.focusedNodeInput = document.querySelector("#osc-focused-node");
    this.focusedDcBtn = document.querySelector("#osc-focused-dc");
    this.focusedAcBtn = document.querySelector("#osc-focused-ac");
    this.focusedGndBtn = document.querySelector("#osc-focused-gnd");
    this.focusedInvBtn = document.querySelector("#osc-focused-inv");
    this.focusedVoltsSelect = document.querySelector("#osc-focused-volts");
    this.focusedVoltsBadge = document.querySelector("#osc-focused-volts-badge");
    this.focusedOffsetSlider = document.querySelector("#osc-focused-offset");
    this.focusedOffsetVal = document.querySelector("#osc-focused-offset-val");

    // Math Presets & Rows
    this.mathPresetsRow = document.querySelector("#osc-math-presets-row");
    this.couplingRow = document.querySelector("#osc-coupling-row");
    this.mathPresetDiffBtn = document.querySelector("#osc-math-preset-diff");
    this.mathPresetMultBtn = document.querySelector("#osc-math-preset-mult");
    this.mathPresetDerivBtn = document.querySelector("#osc-math-preset-deriv");
    this.mathPresetIntegBtn = document.querySelector("#osc-math-preset-integ");

    this.tabCh1 = document.querySelector("#osc-tab-ch1");
    this.tabCh2 = document.querySelector("#osc-tab-ch2");
    this.tabCh3 = document.querySelector("#osc-tab-ch3");
    this.tabCh4 = document.querySelector("#osc-tab-ch4");
    this.tabMath = document.querySelector("#osc-tab-math");

    if (this.oscCanvas) {
      this.oscCtx = this.oscCanvas.getContext("2d");
      this.initEvents();
      this.syncFocusedChannelUI();
      this.updateHud();

      if (typeof ResizeObserver !== "undefined") {
        const resizeObs = new ResizeObserver(() => {
          this.draw();
        });
        resizeObs.observe(this.oscCanvas);
      }

      if (typeof window !== "undefined") {
        window.addEventListener("astryd-theme-changed", () => {
          this.draw();
        });
      }
    }
  }

  public clampCursorVoltagesToVisibleRange(): void {
    const ch = this.cursorTargetChannel;
    const vPerDiv = this.getVoltsPerDiv(ch) || 1.0;
    const offDivs = this.getOffsetDivs(ch) || 0.0;
    const maxVolts = (3.6 - offDivs) * vPerDiv;
    const minVolts = (-3.6 - offDivs) * vPerDiv;

    if (this.cursorV1 > maxVolts || this.cursorV1 < minVolts) {
      this.cursorV1 = (1.5 - offDivs) * vPerDiv;
    }
    if (this.cursorV2 > maxVolts || this.cursorV2 < minVolts) {
      this.cursorV2 = (-1.5 - offDivs) * vPerDiv;
    }
    if (Math.abs(this.cursorV1 - this.cursorV2) < 0.1 * vPerDiv) {
      this.cursorV1 = (1.5 - offDivs) * vPerDiv;
      this.cursorV2 = (-1.5 - offDivs) * vPerDiv;
    }
  }

  public setFocusedChannel(ch: "ch1" | "ch2" | "ch3" | "ch4" | "math"): void {
    this.focusedChannel = ch;
    this.cursorTargetChannel = ch;
    this.clampCursorVoltagesToVisibleRange();
    this.syncFocusedChannelUI();
    this.updateMeasurementsIfNeeded(
      [
        { id: "osc-meas-ch1", node: this.ch1ProbeNode, active: this.isChannelActive("ch1"), color: "#FACC15" },
        { id: "osc-meas-ch2", node: this.ch2ProbeNode, active: this.isChannelActive("ch2"), color: "#38BDF8" },
        { id: "osc-meas-ch3", node: this.ch3ProbeNode, active: this.isChannelActive("ch3"), color: "#F43F5E" },
        { id: "osc-meas-ch4", node: this.ch4ProbeNode, active: this.isChannelActive("ch4"), color: "#4ADE80" },
      ],
    );
    this.draw();
  }

  public setCursorTargetChannel(ch: "ch1" | "ch2" | "ch3" | "ch4" | "math"): void {
    this.cursorTargetChannel = ch;
    this.clampCursorVoltagesToVisibleRange();
    this.updateMeasurementsIfNeeded(
      [
        { id: "osc-meas-ch1", node: this.ch1ProbeNode, active: this.isChannelActive("ch1"), color: "#FACC15" },
        { id: "osc-meas-ch2", node: this.ch2ProbeNode, active: this.isChannelActive("ch2"), color: "#38BDF8" },
        { id: "osc-meas-ch3", node: this.ch3ProbeNode, active: this.isChannelActive("ch3"), color: "#F43F5E" },
        { id: "osc-meas-ch4", node: this.ch4ProbeNode, active: this.isChannelActive("ch4"), color: "#4ADE80" },
      ],
    );
    this.draw();
  }

  public setChannelActive(ch: "ch1" | "ch2" | "ch3" | "ch4", active = true): void {
    if (ch === "ch1") this.oscCh1Btn?.classList.toggle("active", active);
    else if (ch === "ch2") this.oscCh2Btn?.classList.toggle("active", active);
    else if (ch === "ch3") this.oscCh3Btn?.classList.toggle("active", active);
    else if (ch === "ch4") this.oscCh4Btn?.classList.toggle("active", active);

    if (!active && this.cursorTargetChannel === ch) {
      const channelKeys: ("ch1" | "ch2" | "ch3" | "ch4" | "math")[] = ["ch1", "ch2", "ch3", "ch4", "math"];
      const nextActive = channelKeys.find((k) => this.isChannelActive(k)) ?? "ch1";
      this.cursorTargetChannel = nextActive;
      this.clampCursorVoltagesToVisibleRange();
    }

    this.syncFocusedChannelUI();
    this.draw();
  }

  public isChannelActive(key: "ch1" | "ch2" | "ch3" | "ch4" | "math"): boolean {
    if (key === "ch1") return this.oscCh1Btn?.classList.contains("active") ?? true;
    if (key === "ch2") return this.oscCh2Btn?.classList.contains("active") ?? false;
    if (key === "ch3") return this.oscCh3Btn?.classList.contains("active") ?? false;
    if (key === "ch4") return this.oscCh4Btn?.classList.contains("active") ?? false;
    return this.isMathEnabled;
  }

  public syncFocusedChannelUI(): void {
    const ch = this.focusedChannel;

    // Tabs
    const tabs: readonly [HTMLButtonElement | null, string][] = [
      [this.tabCh1, "ch1"],
      [this.tabCh2, "ch2"],
      [this.tabCh3, "ch3"],
      [this.tabCh4, "ch4"],
      [this.tabMath, "math"],
    ];
    tabs.forEach(([tab, key]) => tab?.classList.toggle("active", key === ch));

    // Focused Card style
    if (this.focusedCard) {
      this.focusedCard.className = `osc-focused-card ${ch}`;
    }

    // Title
    if (this.focusedTitle) {
      const titles = {
        ch1: "CANAL 1 (CH1)",
        ch2: "CANAL 2 (CH2)",
        ch3: "CANAL 3 (CH3)",
        ch4: "CANAL 4 (CH4)",
        math: `MATEMÁTICAS (${this.mathExpression || "CH1 - CH2"})`,
      };
      this.focusedTitle.textContent = titles[ch];
    }

    // Active Toggle Button
    const active = this.isChannelActive(ch);
    if (this.focusedToggleBtn) {
      this.focusedToggleBtn.textContent = active ? "ON" : "OFF";
      this.focusedToggleBtn.classList.toggle("active", active);
    }

    // Math Presets row vs Coupling row visibility
    if (this.mathPresetsRow) {
      this.mathPresetsRow.style.display = ch === "math" ? "block" : "none";
    }
    if (this.couplingRow) {
      this.couplingRow.style.display = ch === "math" ? "none" : "block";
    }

    // Node Input / Math Expression Input
    if (this.focusedNodeInput) {
      if (ch === "math") {
        this.focusedNodeInput.disabled = false;
        this.focusedNodeInput.value = this.mathExpression || "CH1 - CH2";
        this.focusedNodeInput.placeholder = "Ej. CH1 - CH2, CH1 * CH2, DERIV(CH1), INTEG(CH1)";
      } else {
        this.focusedNodeInput.disabled = false;
        this.focusedNodeInput.placeholder = "Ej. 1, out...";
        this.focusedNodeInput.value = this.getProbeNodeByChannel(ch) ?? "";
      }
    }

    // Coupling buttons
    const coupling = ch === "ch1" ? this.couplingCh1 : ch === "ch2" ? this.couplingCh2 : ch === "ch3" ? this.couplingCh3 : this.couplingCh4;
    this.focusedDcBtn?.classList.toggle("active", coupling === "dc");
    this.focusedAcBtn?.classList.toggle("active", coupling === "ac");
    this.focusedGndBtn?.classList.toggle("active", coupling === "gnd");

    // Invert button
    const invert = ch === "ch1" ? this.invertCh1 : ch === "ch2" ? this.invertCh2 : ch === "ch3" ? this.invertCh3 : this.invertCh4;
    this.focusedInvBtn?.classList.toggle("active", invert);

    // Volts Per Div
    const v = this.getVoltsPerDiv(ch);
    if (this.focusedVoltsSelect) this.focusedVoltsSelect.value = v.toString();
    if (this.focusedVoltsBadge) this.focusedVoltsBadge.textContent = this.formatVolts(v);

    // Offset
    const off = this.getOffsetDivs(ch);
    if (this.focusedOffsetSlider) this.focusedOffsetSlider.value = off.toString();
    if (this.focusedOffsetVal) this.focusedOffsetVal.textContent = this.formatOffset(off, v);

    // Trigger level slider sync
    if (this.triggerLevelSlider) {
      const trigVPerDiv = this.getVoltsPerDiv(this.triggerChannel) || 1;
      this.triggerLevelSlider.value = (this.triggerLevel / trigVPerDiv).toFixed(2);
    }
  }

  public updateHud(): void {
    const hud1 = document.querySelector("#osc-hud-ch1-val");
    if (hud1) hud1.textContent = this.formatVolts(this.voltsPerDivCh1);
    const hud2 = document.querySelector("#osc-hud-ch2-val");
    if (hud2) hud2.textContent = this.formatVolts(this.voltsPerDivCh2);
    const hud3 = document.querySelector("#osc-hud-ch3-val");
    if (hud3) hud3.textContent = this.formatVolts(this.voltsPerDivCh3);
    const hud4 = document.querySelector("#osc-hud-ch4-val");
    if (hud4) hud4.textContent = this.formatVolts(this.voltsPerDivCh4);
    const hudTime = document.querySelector("#osc-hud-time-val");
    if (hudTime) hudTime.textContent = this.formatTime(this.timeDivValue);

    const trigVal = document.querySelector("#osc-trigger-level-val");
    if (trigVal) trigVal.textContent = `${this.triggerLevel >= 0 ? '+' : ''}${this.triggerLevel.toFixed(2)} V`;

    const hudSpeed = document.querySelector("#osc-hud-speed-val");
    if (hudSpeed) {
      const spd = this.simulationSpeedMultiplier;
      hudSpeed.textContent = spd >= 100 ? "Turbo" : `${spd.toFixed(spd < 1 ? 2 : 1)}x`;
    }
  }

  public setSimulationSpeed(speed: number): void {
    this.simulationSpeedMultiplier = Math.max(0.01, speed);
    if (this.simSpeedSelect) {
      this.simSpeedSelect.value = speed.toString();
    }
    this.updateHud();
  }

  private initEvents() {
    if (!this.oscCanvas) return;

    // 1. Mouse coordinates and Interactive On-Screen Marker Dragging
    this.oscCanvas.addEventListener("mousedown", (e) => {
      if (!this.oscCanvas) return;
      const rect = this.oscCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const divHeight = h / 8;
      const centerY = h / 2;

      // Check left edge ground markers (x <= 28)
      if (x <= 28) {
        const activeOffsets: [number, number, boolean][] = [
          [1, this.offsetCh1, this.oscCh1Btn?.classList.contains("active") ?? true],
          [2, this.offsetCh2, this.oscCh2Btn?.classList.contains("active") ?? false],
          [3, this.offsetCh3, this.oscCh3Btn?.classList.contains("active") ?? false],
          [4, this.offsetCh4, this.oscCh4Btn?.classList.contains("active") ?? false],
        ];
        for (const [chNum, offDivs, active] of activeOffsets) {
          if (!active) continue;
          const tagY = centerY - offDivs * divHeight;
          if (Math.abs(y - tagY) <= 12) {
            this.draggingMarker = { type: "channelOffset", channel: chNum as 1 | 2 | 3 | 4 };
            this.setFocusedChannel(`ch${chNum}` as "ch1" | "ch2" | "ch3" | "ch4");
            return;
          }
        }
      }

      // Check right edge trigger marker (x >= w - 28)
      if (x >= w - 28) {
        const vPerDiv = this.getVoltsPerDiv(this.triggerChannel);
        const trigY = centerY - (this.triggerLevel / (vPerDiv || 1)) * divHeight;
        if (Math.abs(y - trigY) <= 12) {
          this.draggingMarker = { type: "triggerLevel" };
          return;
        }
      }

      // Check Cursors if enabled
      if (this.isCursorsEnabled && this.cursorMode !== "off") {
        const targetVPerDiv = this.getVoltsPerDiv(this.cursorTargetChannel);
        const targetOffsetPx = this.getOffsetDivs(this.cursorTargetChannel) * divHeight;
        const cursor = hitTestOscilloscopeCursor(
          x,
          y,
          {
            cursorT1: this.cursorT1,
            cursorT2: this.cursorT2,
            cursorV1: this.cursorV1,
            cursorV2: this.cursorV2,
            mode: this.cursorMode,
          },
          {
            width: w,
            height: h,
            voltsPerDiv: targetVPerDiv,
            offsetPixels: targetOffsetPx,
            mode: this.cursorMode,
          },
          12,
        );
        if (cursor) {
          this.draggingMarker = { type: "cursor", cursor };
          return;
        }
      }
    });

    this.oscCanvas.addEventListener("mousemove", (e) => {
      const rect = this.oscCanvas!.getBoundingClientRect();
      this.oscMouseX = e.clientX - rect.left;
      this.oscMouseY = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const divHeight = h / 8;
      const centerY = h / 2;

      if (this.draggingMarker) {
        if (this.draggingMarker.type === "channelOffset") {
          const chNum = this.draggingMarker.channel;
          const offsetPixels = centerY - this.oscMouseY!;
          const offsetDivs = Math.max(-4.0, Math.min(4.0, offsetPixels / divHeight));
          if (chNum === 1) this.offsetCh1 = offsetDivs;
          else if (chNum === 2) this.offsetCh2 = offsetDivs;
          else if (chNum === 3) this.offsetCh3 = offsetDivs;
          else if (chNum === 4) this.offsetCh4 = offsetDivs;
          this.syncFocusedChannelUI();
          this.draw();
        } else if (this.draggingMarker.type === "triggerLevel") {
          const vPerDiv = this.getVoltsPerDiv(this.triggerChannel);
          const offsetPixels = centerY - this.oscMouseY!;
          const levelVolts = (offsetPixels / divHeight) * vPerDiv;
          this.triggerLevel = Math.max(-4 * vPerDiv, Math.min(4 * vPerDiv, levelVolts));
          this.updateHud();
          this.syncFocusedChannelUI();
          this.draw();
        } else if (this.draggingMarker.type === "cursor" && (this.isCursorsEnabled || this.cursorMode !== "off")) {
          const targetVPerDiv = this.getVoltsPerDiv(this.cursorTargetChannel);
          const targetOffsetPx = this.getOffsetDivs(this.cursorTargetChannel) * divHeight;
          const nextCursorState = dragOscilloscopeCursor(
            this.draggingMarker.cursor,
            this.oscMouseX!,
            this.oscMouseY!,
            {
              cursorT1: this.cursorT1,
              cursorT2: this.cursorT2,
              cursorV1: this.cursorV1,
              cursorV2: this.cursorV2,
              mode: this.cursorMode,
            },
            {
              width: w,
              height: h,
              voltsPerDiv: targetVPerDiv,
              offsetPixels: targetOffsetPx,
              mode: this.cursorMode,
            },
          );
          this.cursorT1 = nextCursorState.cursorT1;
          this.cursorT2 = nextCursorState.cursorT2;
          this.cursorV1 = nextCursorState.cursorV1;
          this.cursorV2 = nextCursorState.cursorV2;
          this.oscCanvas!.style.cursor =
            this.draggingMarker.cursor === "T1" || this.draggingMarker.cursor === "T2"
              ? "ew-resize"
              : "ns-resize";
          this.updateMeasurementsIfNeeded(
            [
              { id: "osc-meas-ch1", node: this.ch1ProbeNode, active: this.isChannelActive("ch1"), color: "#FACC15" },
              { id: "osc-meas-ch2", node: this.ch2ProbeNode, active: this.isChannelActive("ch2"), color: "#38BDF8" },
              { id: "osc-meas-ch3", node: this.ch3ProbeNode, active: this.isChannelActive("ch3"), color: "#F43F5E" },
              { id: "osc-meas-ch4", node: this.ch4ProbeNode, active: this.isChannelActive("ch4"), color: "#4ADE80" },
            ],
          );
          this.draw();
        }
      } else {
        // Hover cursor hints
        const x = this.oscMouseX!;
        const y = this.oscMouseY!;

        let cursorStyle = "crosshair";
        this.hoveredCursor = null;

        if (x <= 28) {
          const activeOffsets = [
            this.oscCh1Btn?.classList.contains("active") ? this.offsetCh1 : null,
            this.oscCh2Btn?.classList.contains("active") ? this.offsetCh2 : null,
            this.oscCh3Btn?.classList.contains("active") ? this.offsetCh3 : null,
            this.oscCh4Btn?.classList.contains("active") ? this.offsetCh4 : null,
          ];
          for (const off of activeOffsets) {
            if (off === null) continue;
            if (Math.abs(y - (centerY - off * divHeight)) <= 12) {
              cursorStyle = "ns-resize";
              break;
            }
          }
        } else if (x >= w - 28) {
          const vPerDiv = this.getVoltsPerDiv(this.triggerChannel);
          const trigY = centerY - (this.triggerLevel / (vPerDiv || 1)) * divHeight;
          if (Math.abs(y - trigY) <= 12) cursorStyle = "ns-resize";
        } else if (this.isCursorsEnabled || this.cursorMode !== "off") {
          const targetVPerDiv = this.getVoltsPerDiv(this.cursorTargetChannel);
          const targetOffsetPx = this.getOffsetDivs(this.cursorTargetChannel) * divHeight;
          const hoveredCursor = hitTestOscilloscopeCursor(
            x,
            y,
            {
              cursorT1: this.cursorT1,
              cursorT2: this.cursorT2,
              cursorV1: this.cursorV1,
              cursorV2: this.cursorV2,
              mode: this.cursorMode,
            },
            {
              width: w,
              height: h,
              voltsPerDiv: targetVPerDiv,
              offsetPixels: targetOffsetPx,
              mode: this.cursorMode,
            },
            12,
          );
          this.hoveredCursor = hoveredCursor;
          if (hoveredCursor === "T1" || hoveredCursor === "T2") {
            cursorStyle = "ew-resize";
          } else if (hoveredCursor === "V1" || hoveredCursor === "V2") {
            cursorStyle = "ns-resize";
          }
        }

        this.oscCanvas!.style.cursor = cursorStyle;
        this.draw();
      }
    });

    window.addEventListener("mouseup", () => {
      this.draggingMarker = null;
    });
    window.addEventListener("resize", () => this.refreshVisibility());

    this.oscCanvas.addEventListener("mouseleave", () => {
      this.oscMouseX = null;
      this.oscMouseY = null;
      this.hoveredCursor = null;
      this.draggingMarker = null;
      this.draw();
    });

    // Wheel zoom: Vertical Volts/div (o Horizontal Time/div con Shift)
    this.oscCanvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          // Zoom Horizontal de Base de Tiempo
          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
          const timeOptions = [...OSCILLOSCOPE_TIME_PER_DIV];
          let curIdx = timeOptions.findIndex((t) => t >= this.timeDivValue * 0.999);
          if (curIdx === -1) curIdx = 0;
          if (delta > 0 && curIdx < timeOptions.length - 1) {
            this.timeDivValue = timeOptions[curIdx + 1];
          } else if (delta < 0 && curIdx > 0) {
            this.timeDivValue = timeOptions[curIdx - 1];
          }
          this.syncTimeDivSelect(this.timeDivValue);
          this.updateHud();
          this.draw();
        } else {
          // Zoom Vertical de Escala Volts/div para el canal enfocado
          const ch = this.focusedChannel;
          const curV = this.getVoltsPerDiv(ch);
          const voltOptions = [...OSCILLOSCOPE_VOLTS_PER_DIV];
          let curIdx = voltOptions.findIndex((v) => v >= curV * 0.999);
          if (curIdx === -1) curIdx = 0;

          let nextV = curV;
          if (e.deltaY > 0 && curIdx < voltOptions.length - 1) {
            nextV = voltOptions[curIdx + 1];
          } else if (e.deltaY < 0 && curIdx > 0) {
            nextV = voltOptions[curIdx - 1];
          }

          if (ch === "math") this.mathVoltsPerDiv = nextV;
          else if (ch === "ch1") this.voltsPerDivCh1 = nextV;
          else if (ch === "ch2") this.voltsPerDivCh2 = nextV;
          else if (ch === "ch3") this.voltsPerDivCh3 = nextV;
          else if (ch === "ch4") this.voltsPerDivCh4 = nextV;

          this.syncFocusedChannelUI();
          this.updateHud();
          this.draw();
        }
      },
      { passive: false },
    );

    // 2. Channel Tabs
    this.tabCh1?.addEventListener("click", () => this.setFocusedChannel("ch1"));
    this.tabCh2?.addEventListener("click", () => this.setFocusedChannel("ch2"));
    this.tabCh3?.addEventListener("click", () => this.setFocusedChannel("ch3"));
    this.tabCh4?.addEventListener("click", () => this.setFocusedChannel("ch4"));
    this.tabMath?.addEventListener("click", () => this.setFocusedChannel("math"));

    // 3. Probe Picker Button and Drag-and-Drop from panel to canvas
    const pickProbeBtn = document.querySelector<HTMLButtonElement>("#osc-focused-pick-probe-btn");
    pickProbeBtn?.addEventListener("click", () => {
      const ch = this.focusedChannel === "math" ? "ch1" : this.focusedChannel;
      this.onPickProbeRequested?.(ch);
    });

    const setupProbeDrag = (el: HTMLElement | null, getChannel: () => string) => {
      if (!el) return;
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", (e) => {
        const ch = getChannel().toUpperCase();
        if (e.dataTransfer) {
          e.dataTransfer.setData("application/astryd-probe", ch);
          e.dataTransfer.setData("text/plain", `probe:${ch}`);
          e.dataTransfer.effectAllowed = "copy";
        }
      });
    };

    setupProbeDrag(pickProbeBtn, () => this.focusedChannel === "math" ? "ch1" : this.focusedChannel);
    setupProbeDrag(this.oscCh1Btn, () => "ch1");
    setupProbeDrag(this.oscCh2Btn, () => "ch2");
    setupProbeDrag(this.oscCh3Btn, () => "ch3");
    setupProbeDrag(this.oscCh4Btn, () => "ch4");
    setupProbeDrag(this.tabCh1, () => "ch1");
    setupProbeDrag(this.tabCh2, () => "ch2");
    setupProbeDrag(this.tabCh3, () => "ch3");
    setupProbeDrag(this.tabCh4, () => "ch4");

    // 4. Focused Card Controls
    this.focusedToggleBtn?.addEventListener("click", () => {
      const ch = this.focusedChannel;
      if (ch === "ch1") this.oscCh1Btn?.classList.toggle("active");
      else if (ch === "ch2") this.oscCh2Btn?.classList.toggle("active");
      else if (ch === "ch3") this.oscCh3Btn?.classList.toggle("active");
      else if (ch === "ch4") this.oscCh4Btn?.classList.toggle("active");
      else {
        this.isMathEnabled = !this.isMathEnabled;
        this.mathBtn?.classList.toggle("active", this.isMathEnabled);
      }
      this.syncFocusedChannelUI();
      this.draw();
    });

    this.focusedNodeInput?.addEventListener("input", () => {
      const val = this.focusedNodeInput?.value.trim() || null;
      const ch = this.focusedChannel;
      if (ch === "ch1") {
        this.ch1ProbeNode = val;
        if (val) this.oscCh1Btn?.classList.add("active");
      } else if (ch === "ch2") {
        this.ch2ProbeNode = val;
        if (val) this.oscCh2Btn?.classList.add("active");
      } else if (ch === "ch3") {
        this.ch3ProbeNode = val;
        if (val) this.oscCh3Btn?.classList.add("active");
      } else if (ch === "ch4") {
        this.ch4ProbeNode = val;
        if (val) this.oscCh4Btn?.classList.add("active");
      } else if (ch === "math") {
        this.mathExpression = this.focusedNodeInput?.value.trim() || "CH1 - CH2";
      }
      this.syncFocusedChannelUI();
      this.draw();
      if (ch !== "math") {
        this.onProbeNodeChanged?.(ch, val);
      }
    });

    // Math Quick Presets listeners
    this.mathPresetDiffBtn?.addEventListener("click", () => {
      this.mathExpression = "CH1 - CH2";
      if (this.focusedNodeInput) this.focusedNodeInput.value = this.mathExpression;
      this.syncFocusedChannelUI();
      this.draw();
    });
    this.mathPresetMultBtn?.addEventListener("click", () => {
      this.mathExpression = "CH1 * CH2";
      if (this.focusedNodeInput) this.focusedNodeInput.value = this.mathExpression;
      this.syncFocusedChannelUI();
      this.draw();
    });
    this.mathPresetDerivBtn?.addEventListener("click", () => {
      this.mathExpression = "DERIV(CH1)";
      if (this.focusedNodeInput) this.focusedNodeInput.value = this.mathExpression;
      this.syncFocusedChannelUI();
      this.draw();
    });
    this.mathPresetIntegBtn?.addEventListener("click", () => {
      this.mathExpression = "INTEG(CH1)";
      if (this.focusedNodeInput) this.focusedNodeInput.value = this.mathExpression;
      this.syncFocusedChannelUI();
      this.draw();
    });

    const setCoupling = (mode: "dc" | "ac" | "gnd") => {
      const ch = this.focusedChannel;
      if (ch === "ch1") this.couplingCh1 = mode;
      else if (ch === "ch2") this.couplingCh2 = mode;
      else if (ch === "ch3") this.couplingCh3 = mode;
      else if (ch === "ch4") this.couplingCh4 = mode;
      this.syncFocusedChannelUI();
      this.draw();
    };

    this.focusedDcBtn?.addEventListener("click", () => setCoupling("dc"));
    this.focusedAcBtn?.addEventListener("click", () => setCoupling("ac"));
    this.focusedGndBtn?.addEventListener("click", () => setCoupling("gnd"));

    this.focusedInvBtn?.addEventListener("click", () => {
      const ch = this.focusedChannel;
      if (ch === "ch1") this.invertCh1 = !this.invertCh1;
      else if (ch === "ch2") this.invertCh2 = !this.invertCh2;
      else if (ch === "ch3") this.invertCh3 = !this.invertCh3;
      else if (ch === "ch4") this.invertCh4 = !this.invertCh4;
      this.syncFocusedChannelUI();
      this.draw();
    });

    this.focusedVoltsSelect?.addEventListener("input", () => {
      const val = parseFloat(this.focusedVoltsSelect?.value || "1.0");
      const ch = this.focusedChannel;
      if (ch === "math") this.mathVoltsPerDiv = val;
      else if (ch === "ch1") this.voltsPerDivCh1 = val;
      else if (ch === "ch2") this.voltsPerDivCh2 = val;
      else if (ch === "ch3") this.voltsPerDivCh3 = val;
      else if (ch === "ch4") this.voltsPerDivCh4 = val;
      this.syncFocusedChannelUI();
      this.updateHud();
      this.draw();
    });

    this.focusedOffsetSlider?.addEventListener("input", () => {
      const val = parseFloat(this.focusedOffsetSlider?.value || "0.0");
      const ch = this.focusedChannel;
      if (ch === "math") this.mathOffset = val;
      else if (ch === "ch1") this.offsetCh1 = val;
      else if (ch === "ch2") this.offsetCh2 = val;
      else if (ch === "ch3") this.offsetCh3 = val;
      else if (ch === "ch4") this.offsetCh4 = val;
      this.syncFocusedChannelUI();
      this.draw();
    });

    // 4. Horizontal Timebase & Trigger
    this.timeDivSelect?.addEventListener("input", () => {
      if (this.timeDivSelect) this.timeDivValue = parseFloat(this.timeDivSelect.value);
      this.updateHud();
      this.draw();
    });

    this.simSpeedSelect?.addEventListener("change", () => {
      const speed = parseFloat(this.simSpeedSelect?.value ?? "1.0");
      if (Number.isFinite(speed) && speed > 0) {
        this.simulationSpeedMultiplier = speed;
        this.onSpeedChanged?.(speed);
        this.updateHud();
      }
    });

    this.triggerModeSelect?.addEventListener("input", () => {
      if (this.triggerModeSelect) this.triggerChannel = normalizeTriggerChannel(this.triggerModeSelect.value);
      this.syncFocusedChannelUI();
      this.draw();
    });

    this.triggerEdgeSelect?.addEventListener("input", () => {
      if (this.triggerEdgeSelect) this.triggerEdge = normalizeTriggerEdge(this.triggerEdgeSelect.value);
      this.draw();
    });

    this.triggerLevelSlider?.addEventListener("input", () => {
      if (this.triggerLevelSlider) {
        const vPerDiv = this.getVoltsPerDiv(this.triggerChannel) || 1;
        const divs = parseFloat(this.triggerLevelSlider.value || "0");
        this.triggerLevel = divs * vPerDiv;
      }
      this.updateHud();
      this.draw();
    });

    this.trigger50Btn?.addEventListener("click", () => {
      this.setTriggerTo50Percent();
    });

    this.triggerSweepModeSelect?.addEventListener("input", () => {
      if (this.triggerSweepModeSelect) {
        this.triggerSweepMode = (this.triggerSweepModeSelect.value as "auto" | "normal" | "single") || "auto";
        this.singleTriggerFired = false;
      }
      this.draw();
    });

    // Mode toggles
    this.modeTyBtn?.addEventListener("click", () => {
      this.isXyMode = false;
      this.modeTyBtn?.classList.add("active");
      this.modeXyBtn?.classList.remove("active");
      this.draw();
    });

    this.modeXyBtn?.addEventListener("click", () => {
      this.isXyMode = true;
      this.modeXyBtn?.classList.add("active");
      this.modeTyBtn?.classList.remove("active");
      this.draw();
    });

    // Cursors toggle / cycle modes
    this.cursorsBtn?.addEventListener("click", () => {
      const modeCycle: CursorMode[] = ["off", "both", "time", "voltage", "track"];
      const currentIdx = modeCycle.indexOf(this.cursorMode);
      const nextMode = modeCycle[(currentIdx + 1) % modeCycle.length];
      this.setCursorMode(nextMode);
    });

    // Cursor target channel cycling via telemetry badge
    const cursorModeBadge = document.getElementById("osc-meas-cursor-mode-badge");
    cursorModeBadge?.addEventListener("click", (e) => {
      e.stopPropagation();
      const channels: ("ch1" | "ch2" | "ch3" | "ch4" | "math")[] = ["ch1", "ch2", "ch3", "ch4", "math"];
      const currentIdx = channels.indexOf(this.cursorTargetChannel);
      const nextCh = channels[(currentIdx + 1) % channels.length];
      this.setCursorTargetChannel(nextCh);
    });

    // Split Mode Toggle in top bar
    this.modeSplitBtn?.addEventListener("click", () => {
      this.isSplitMode = !this.isSplitMode;
      this.modeSplitBtn?.classList.toggle("active", this.isSplitMode);
      this.draw();
    });

    // MATH Toggle in top bar
    this.mathBtn?.addEventListener("click", () => {
      this.isMathEnabled = !this.isMathEnabled;
      this.mathBtn?.classList.toggle("active", this.isMathEnabled);
      this.setFocusedChannel("math");
      this.draw();
    });

    // Snapshot PNG & CSV Export
    this.snapshotBtn?.addEventListener("click", () => this.snapshotPng());
    this.csvBtn?.addEventListener("click", () => this.exportCsv());

    // Top bar channel buttons (click toggles and focuses)
    const setupChBtn = (btn: HTMLButtonElement | null, ch: "ch1" | "ch2" | "ch3" | "ch4") => {
      btn?.addEventListener("click", () => {
        btn.classList.toggle("active");
        this.setFocusedChannel(ch);
        this.draw();
      });
    };
    setupChBtn(this.oscCh1Btn, "ch1");
    setupChBtn(this.oscCh2Btn, "ch2");
    setupChBtn(this.oscCh3Btn, "ch3");
    setupChBtn(this.oscCh4Btn, "ch4");
  }

  private getProbeNodeByChannel(ch: OscilloscopeChannel): string | null {
    if (ch === "ch1") return this.ch1ProbeNode;
    if (ch === "ch2") return this.ch2ProbeNode;
    if (ch === "ch3") return this.ch3ProbeNode;
    return this.ch4ProbeNode;
  }

  private getAutoFitChannel(): OscilloscopeChannel | null {
    const channels: readonly [OscilloscopeChannel, HTMLButtonElement | null][] = [
      ["ch1", this.oscCh1Btn], ["ch2", this.oscCh2Btn],
      ["ch3", this.oscCh3Btn], ["ch4", this.oscCh4Btn],
    ];
    return channels.find(([channel, button]) => (
      button?.classList.contains("active") && this.getProbeNodeByChannel(channel)
    ))?.[0] ?? null;
  }

  private isCanvasVisible(): boolean {
    if (!this.oscCanvas?.isConnected) return false;
    const floatingWindow = this.oscCanvas.closest(".floating-instrument-window");
    if (floatingWindow) {
      return (floatingWindow.clientWidth > 0 || (floatingWindow as HTMLElement).offsetWidth > 0)
        && (floatingWindow.clientHeight > 0 || (floatingWindow as HTMLElement).offsetHeight > 0);
    }
    const dock = this.oscCanvas.closest("#bottom-dock");
    if (dock?.classList.contains("collapsed")) return false;
    if (this.oscCanvas.clientWidth > 0 && this.oscCanvas.clientHeight > 0) return true;
    if (this.oscCanvas.width > 0 && this.oscCanvas.height > 0) return true;
    return this.oscCanvas.getClientRects().length > 0;
  }

  private shouldAnimate(): boolean {
    return this.isSimulating
      && !this.isOscPaused
      && (this.activeAnalysisMode === "TRAN" || this.activeAnalysisMode === "PSS");
  }

  private cancelScheduledFrame(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private scheduleNextFrame(): void {
    if (!this.shouldAnimate() || this.animationFrameId !== null || !this.isCanvasVisible()) return;
    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.draw();
    });
  }

  public refreshVisibility(): void {
    if (!this.isCanvasVisible()) {
      this.cancelScheduledFrame();
      return;
    }
    this.draw();
  }

  public draw() {
    if (!this.oscCanvas || !this.oscCtx) return;
    if (!this.isCanvasVisible()) {
      this.cancelScheduledFrame();
      return;
    }

    const { width, height } = ensureCanvasDpr(this.oscCanvas, this.oscCtx);
    if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) return;

    const themeColors = getInstrumentThemeColors();

    // Clean, crisp solid background
    this.oscCtx.fillStyle = themeColors.screenBg;
    this.oscCtx.fillRect(0, 0, width, height);

    const isCh1Active = this.oscCh1Btn?.classList.contains("active") ?? false;
    const isCh2Active = this.oscCh2Btn?.classList.contains("active") ?? false;
    const isCh3Active = this.oscCh3Btn?.classList.contains("active") ?? false;
    const isCh4Active = this.oscCh4Btn?.classList.contains("active") ?? false;

    const ch1Color = themeColors.traceColors.ch1;
    const ch2Color = themeColors.traceColors.ch2;
    const ch3Color = themeColors.traceColors.ch3;
    const ch4Color = themeColors.traceColors.ch4;

    const activeChannelsList = [
      { num: 1, node: this.ch1ProbeNode, color: ch1Color, voltsPerDiv: this.voltsPerDivCh1, offsetDivs: this.offsetCh1, active: isCh1Active, coupling: this.couplingCh1, invert: this.invertCh1 },
      { num: 2, node: this.ch2ProbeNode, color: ch2Color, voltsPerDiv: this.voltsPerDivCh2, offsetDivs: this.offsetCh2, active: isCh2Active, coupling: this.couplingCh2, invert: this.invertCh2 },
      { num: 3, node: this.ch3ProbeNode, color: ch3Color, voltsPerDiv: this.voltsPerDivCh3, offsetDivs: this.offsetCh3, active: isCh3Active, coupling: this.couplingCh3, invert: this.invertCh3 },
      { num: 4, node: this.ch4ProbeNode, color: ch4Color, voltsPerDiv: this.voltsPerDivCh4, offsetDivs: this.offsetCh4, active: isCh4Active, coupling: this.couplingCh4, invert: this.invertCh4 },
    ].filter((c): c is typeof c & { node: string } => Boolean(c.active && c.node));

    // --- MODO AC SWEEP: DIAGRAMA DE BODE LOGARÍTMICO ---
    if (this.activeAnalysisMode === "AC" && this.acSweepResults !== null && this.acSweepResults.frequencies.length > 0) {
      drawAcSweep(this.oscCtx, width, height, this.acSweepResults, [
        { node: this.ch1ProbeNode, color: ch1Color, active: isCh1Active },
        { node: this.ch2ProbeNode, color: ch2Color, active: isCh2Active },
        { node: this.ch3ProbeNode, color: ch3Color, active: isCh3Active },
        { node: this.ch4ProbeNode, color: ch4Color, active: isCh4Active },
      ]);
    } else if (this.activeAnalysisMode === "PVT" && this.pvtTraces.length > 0) {
      drawPvtTraces(
        this.oscCtx,
        width,
        height,
        this.pvtTraces,
        this.ch1ProbeNode || "1",
        this.voltsPerDivCh1,
        this.offsetCh1 * (height / 8),
        this.timeDivValue,
      );
    } else if (this.isXyMode) {
      if (activeChannelsList.length >= 2 && this.transientResults.length > 1) {
        const chX = activeChannelsList[0];
        const chY = activeChannelsList[1];
        drawXyTrace(
          this.oscCtx,
          width,
          height,
          this.transientResults,
          chX.node,
          chY.node,
          chX.voltsPerDiv,
          chY.voltsPerDiv,
          chX.offsetDivs * (width / 10),
          chY.offsetDivs * (height / 8),
          {
            xLabel: `CH${chX.num}`,
            yLabel: `CH${chY.num}`,
            traceColor: chY.color,
          },
        );
      } else {
        const singleCh = activeChannelsList.length === 1 ? `CH${activeChannelsList[0].num}` : null;
        drawXyNotice(
          this.oscCtx,
          width,
          height,
          singleCh
            ? `Canal activo: ${singleCh}. Activa otro canal (ej. CH2 o CH4) para graficar X vs Y.`
            : "Se requieren al menos 2 canales activos (ej. CH1 y CH4) para graficar X vs Y",
        );
      }
    } else {
      const ctx = this.oscCtx;
      const divHeight = height / 8;
      const triggerNode = this.getProbeNodeByChannel(this.triggerChannel);
      const triggerStartIdx = findTriggerStartIndex(
        this.transientResults,
        triggerNode,
        this.triggerEdge,
        this.triggerLevel,
        this.timeDivValue,
      );

      if (this.isSplitMode && activeChannelsList.length > 1) {
        const slotHeight = height / activeChannelsList.length;
        drawSplitTyReticle(
          ctx,
          width,
          height,
          activeChannelsList.map(c => ({
            num: c.num,
            color: c.color,
            offsetPixels: c.offsetDivs * (slotHeight / 8),
            voltsPerDiv: c.voltsPerDiv,
          })),
          {
            levelVolts: this.triggerLevel,
            voltsPerDiv: this.getVoltsPerDiv(this.triggerChannel),
            mode: this.triggerSweepMode,
            triggered: triggerStartIdx > 0,
            paused: this.isOscPaused,
          },
        );

        for (let k = 0; k < activeChannelsList.length; k++) {
          const ch = activeChannelsList[k];
          const topY = k * slotHeight;
          const slotDivHeight = slotHeight / 8;
          const offsetPixels = ch.offsetDivs * slotDivHeight;
          const tracePoints = buildTyTracePoints(
            this.transientResults,
            ch.node,
            { width, height: slotHeight },
            { voltsPerDiv: ch.voltsPerDiv, offsetPixels, timeDivValue: this.timeDivValue },
            triggerStartIdx,
            { coupling: ch.coupling, invert: ch.invert },
          );
          if (tracePoints.length < 2) continue;

          const shiftedPoints = tracePoints.map((pt) => ({ x: pt.x, y: pt.y + topY }));

          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          // Glow pass
          ctx.strokeStyle = ch.color;
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = 4.5;
          ctx.beginPath();
          renderSmoothTracePath(ctx, shiftedPoints);
          ctx.stroke();

          // Crisp core line
          ctx.globalAlpha = 1.0;
          ctx.lineWidth = 1.9;
          ctx.beginPath();
          renderSmoothTracePath(ctx, shiftedPoints);
          ctx.stroke();

          ctx.restore();
        }
      } else {
        // Overlay standard single grid
        drawTyReticle(this.oscCtx, width, height, {
          channels: [
            { num: 1, color: ch1Color, offsetPixels: this.offsetCh1 * divHeight, active: isCh1Active },
            { num: 2, color: ch2Color, offsetPixels: this.offsetCh2 * divHeight, active: isCh2Active },
            { num: 3, color: ch3Color, offsetPixels: this.offsetCh3 * divHeight, active: isCh3Active },
            { num: 4, color: ch4Color, offsetPixels: this.offsetCh4 * divHeight, active: isCh4Active },
          ],
          trigger: {
            levelVolts: this.triggerLevel,
            voltsPerDiv: this.getVoltsPerDiv(this.triggerChannel),
            mode: this.triggerSweepMode,
            triggered: triggerStartIdx > 0,
            paused: this.isOscPaused,
          },
        });

        // Handle Trigger Single Shot
        if (this.triggerSweepMode === "single" && this.isSimulating && !this.singleTriggerFired) {
          if (triggerStartIdx > 0 || (this.transientResults.length > 5 && this.triggerLevel === 0)) {
            this.singleTriggerFired = true;
            this.pause();
          }
        }

        // Draw channel traces (Clean, Crisp, 60 FPS, Ultra-smooth Phosphor Bloom)
        const drawChannelTY = (
          nodeId: string,
          color: string,
          voltsPerDiv: number,
          offsetDivs: number,
          isActive: boolean,
          config: { coupling: "dc" | "ac" | "gnd"; invert: boolean; interpolation?: "linear" | "sinc" },
        ) => {
          if (!isActive || !nodeId || triggerStartIdx >= this.transientResults.length) return;

          const offsetPixels = offsetDivs * divHeight;
          const tracePoints = buildTyTracePoints(
            this.transientResults,
            nodeId,
            { width, height },
            { voltsPerDiv, offsetPixels, timeDivValue: this.timeDivValue },
            triggerStartIdx,
            config,
          );
          if (tracePoints.length < 2) return;

          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          // Pass 1: Soft Phosphor Bloom Halo
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = 4.5;
          ctx.beginPath();
          renderSmoothTracePath(ctx, tracePoints);
          ctx.stroke();

          // Pass 2: Crisp Bright Centerline
          ctx.globalAlpha = 1.0;
          ctx.lineWidth = 1.9;
          ctx.beginPath();
          renderSmoothTracePath(ctx, tracePoints);
          ctx.stroke();

          ctx.restore();
        };

        drawChannelTY(this.ch1ProbeNode || "1", ch1Color, this.voltsPerDivCh1, this.offsetCh1, isCh1Active, {
          coupling: this.couplingCh1,
          invert: this.invertCh1,
          interpolation: this.interpolationMode,
        });
        drawChannelTY(this.ch2ProbeNode || "2", ch2Color, this.voltsPerDivCh2, this.offsetCh2, isCh2Active, {
          coupling: this.couplingCh2,
          invert: this.invertCh2,
          interpolation: this.interpolationMode,
        });
        drawChannelTY(this.ch3ProbeNode || "3", ch3Color, this.voltsPerDivCh3, this.offsetCh3, isCh3Active, {
          coupling: this.couplingCh3,
          invert: this.invertCh3,
          interpolation: this.interpolationMode,
        });
        drawChannelTY(this.ch4ProbeNode || "4", ch4Color, this.voltsPerDivCh4, this.offsetCh4, isCh4Active, {
          coupling: this.couplingCh4,
          invert: this.invertCh4,
          interpolation: this.interpolationMode,
        });

        // Render MATH channel (Arbitrary parsed expressions: CH1 - CH2, CH1 * CH2, DERIV(CH1), INTEG(CH1), FFT(CH1), etc.)
        if (this.isMathEnabled && this.transientResults.length > 1) {
          const bindings = {
            ch1Node: this.ch1ProbeNode,
            ch2Node: this.ch2ProbeNode,
            ch3Node: this.ch3ProbeNode,
            ch4Node: this.ch4ProbeNode,
          };
          const mathVals = evaluateWaveformMath(this.mathExpression || "CH1 - CH2", this.transientResults, bindings);

          if (mathVals.length > 1) {
            const windowDuration = this.timeDivValue * 10;
            const firstTime = this.transientResults[triggerStartIdx]?.time ?? 0;
            const mathVoltsPerDiv = this.mathVoltsPerDiv || 1.0;
            const mathOffsetPx = this.mathOffset * divHeight;

            const mathPoints: { x: number; y: number }[] = [];
            for (let i = triggerStartIdx; i < this.transientResults.length; i++) {
              const pt = this.transientResults[i];
              const relTime = pt.time - firstTime;
              if (relTime > windowDuration) break;
              const x = (relTime / windowDuration) * width;
              const vMath = mathVals[i] ?? 0;
              const y = height / 2 - (vMath / mathVoltsPerDiv) * divHeight - mathOffsetPx;
              mathPoints.push({ x, y });
            }

            if (mathPoints.length > 1) {
              ctx.save();
              ctx.strokeStyle = "#FB923C";
              ctx.lineWidth = 2.0;
              ctx.setLineDash([4, 2]);
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.beginPath();
              renderSmoothTracePath(ctx, mathPoints);
              ctx.stroke();
              ctx.restore();
            }
          }
        }

        // Draw Waveform Histogram if enabled
        if (this.isHistogramEnabled) {
          const histNode = this.getProbeNodeByChannel(this.focusedChannel === "math" ? "ch1" : this.focusedChannel);
          if (histNode) {
            const hist = calculateWaveformHistogram(this.transientResults, histNode, 24);
            drawWaveformHistogram(this.oscCtx, width, height, hist, "#FACC15");
          }
        }

        // Draw Mask Testing overlay if enabled
        if (this.isMaskTestingEnabled && this.activeMask) {
          const testNode = this.getProbeNodeByChannel(this.focusedChannel === "math" ? "ch1" : this.focusedChannel);
          if (testNode) {
            const violations = evaluateMaskTest(this.transientResults, testNode, this.activeMask, triggerStartIdx);
            const vPerDiv = this.getVoltsPerDiv(this.focusedChannel);
            const offPx = this.getOffsetDivs(this.focusedChannel) * divHeight;
            drawMaskOverlay(
              this.oscCtx,
              width,
              height,
              this.transientResults,
              testNode,
              this.activeMask,
              vPerDiv,
              offPx,
              this.timeDivValue,
              triggerStartIdx,
              violations,
            );
          }
        }
      }

      this.updateMeasurementsIfNeeded(
        [
          { id: "osc-meas-ch1", node: this.ch1ProbeNode, active: isCh1Active, color: "#FACC15" },
          { id: "osc-meas-ch2", node: this.ch2ProbeNode, active: isCh2Active, color: "#38BDF8" },
          { id: "osc-meas-ch3", node: this.ch3ProbeNode, active: isCh3Active, color: "#F43F5E" },
          { id: "osc-meas-ch4", node: this.ch4ProbeNode, active: isCh4Active, color: "#4ADE80" },
        ],
      );

      if (this.isCursorsEnabled || this.cursorMode !== "off") {
        const effectiveMode = this.cursorMode === "off" ? "both" : this.cursorMode;
        const targetVPerDiv = this.getVoltsPerDiv(this.cursorTargetChannel);
        const targetOffsetPx = this.getOffsetDivs(this.cursorTargetChannel) * divHeight;
        const isTargetMath = this.cursorTargetChannel === "math";
        const targetNode = this.cursorTargetChannel === "math"
          ? null
          : this.getProbeNodeByChannel(this.cursorTargetChannel);
        const metrics = targetNode && this.transientResults.length > 2
          ? calculateOscilloscopeMetrics(this.transientResults, targetNode)
          : null;

        let trackV1: number | null = null;
        let trackV2: number | null = null;
        if (effectiveMode === "track" && this.transientResults.length > 0) {
          if (isTargetMath && this.isMathEnabled) {
            const bindings = {
              ch1Node: this.ch1ProbeNode,
              ch2Node: this.ch2ProbeNode,
              ch3Node: this.ch3ProbeNode,
              ch4Node: this.ch4ProbeNode,
            };
            const mathVals = evaluateWaveformMath(this.mathExpression || "CH1 - CH2", this.transientResults, bindings);
            trackV1 = sampleArrayAtNormalizedTime(this.transientResults, mathVals, this.cursorT1, this.timeDivValue, triggerStartIdx);
            trackV2 = sampleArrayAtNormalizedTime(this.transientResults, mathVals, this.cursorT2, this.timeDivValue, triggerStartIdx);
          } else if (targetNode) {
            trackV1 = sampleVoltageAtNormalizedTime(this.transientResults, targetNode, this.cursorT1, this.timeDivValue, triggerStartIdx);
            trackV2 = sampleVoltageAtNormalizedTime(this.transientResults, targetNode, this.cursorT2, this.timeDivValue, triggerStartIdx);
          }
        }

        drawOscilloscopeCursors(
          this.oscCtx,
          width,
          height,
          divHeight,
          this.cursorT1,
          this.cursorT2,
          this.cursorV1,
          this.cursorV2,
          targetVPerDiv,
          targetOffsetPx,
          this.timeDivValue,
          {
            mode: effectiveMode,
            hoveredCursor: this.hoveredCursor,
            draggingCursor: this.draggingMarker?.type === "cursor" ? this.draggingMarker.cursor : null,
            trackV1,
            trackV2,
            sourceLabel: this.cursorTargetChannel,
            signalPeriod: metrics?.period,
            suppressTopBadge: width < 580 || height < 200,
          },
        );
      }
    }

    this.scheduleNextFrame();
  }

  private updateMeasurementsIfNeeded(channels: readonly {
    id: string;
    node: string | null;
    active: boolean;
    color: string;
  }[]): void {
    const now = performance.now();
    if (
      this.isSimulating
      && this.lastMeasurementsUpdateAt > 0
      && now - this.lastMeasurementsUpdateAt < this.measurementsUpdateIntervalMs
    ) {
      return;
    }
    this.lastMeasurementsUpdateAt = now;

    for (const channel of channels) {
      const card = document.getElementById(channel.id);
      if (!card) continue;
      card.classList.toggle("active", channel.active);

      const nodeBadge = card.querySelector<HTMLElement>(".meas-node-badge");
      if (nodeBadge) {
        nodeBadge.textContent = channel.node ? `N:${channel.node}` : "No Probe";
      }

      const vppEl = card.querySelector<HTMLElement>("[id^='meas-vpp']") || card.querySelector<HTMLElement>(".val-vpp");
      const vrmsEl = card.querySelector<HTMLElement>("[id^='meas-vrms']") || card.querySelector<HTMLElement>(".val-vrms");
      const vavgEl = card.querySelector<HTMLElement>("[id^='meas-vavg']") || card.querySelector<HTMLElement>(".val-vavg");
      const freqEl = card.querySelector<HTMLElement>("[id^='meas-freq']") || card.querySelector<HTMLElement>(".val-freq");
      const dutyEl = card.querySelector<HTMLElement>("[id^='meas-duty']") || card.querySelector<HTMLElement>(".val-duty");
      const trEl = card.querySelector<HTMLElement>("[id^='meas-tr']");
      const tfEl = card.querySelector<HTMLElement>("[id^='meas-tf']");
      const phaseEl = card.querySelector<HTMLElement>("[id^='meas-phase']");

      if (channel.active && channel.node) {
        const metrics = calculateOscilloscopeMetrics(this.transientResults, channel.node);
        let freqText = "--";
        if (metrics.freq > 0) {
          if (metrics.freq >= 1e6) {
            freqText = `${(metrics.freq / 1e6).toFixed(2)} MHz`;
          } else if (metrics.freq >= 1e3) {
            freqText = `${(metrics.freq / 1e3).toFixed(2)} kHz`;
          } else {
            freqText = `${metrics.freq.toFixed(1)} Hz`;
          }
        }

        if (vppEl) vppEl.textContent = metrics.vpp >= 1 ? `${metrics.vpp.toFixed(2)}V` : `${(metrics.vpp * 1000).toFixed(0)}mV`;
        if (vrmsEl) vrmsEl.textContent = metrics.vrms >= 1 ? `${metrics.vrms.toFixed(2)}V` : `${(metrics.vrms * 1000).toFixed(0)}mV`;
        if (vavgEl) vavgEl.textContent = `${metrics.vavg >= 0 ? '+' : ''}${metrics.vavg.toFixed(2)}V`;
        if (freqEl) freqEl.textContent = freqText;
        if (dutyEl) dutyEl.textContent = metrics.freq > 0 ? `${metrics.duty.toFixed(0)}%` : "--";

        const formatTimeMetric = (val?: number) => {
          if (val === undefined || !Number.isFinite(val) || val <= 0) return "--";
          if (val >= 1e-3) return `${(val * 1e3).toFixed(1)}ms`;
          if (val >= 1e-6) return `${(val * 1e6).toFixed(1)}µs`;
          return `${(val * 1e9).toFixed(1)}ns`;
        };

        if (trEl) trEl.textContent = formatTimeMetric(metrics.riseTime);
        if (tfEl) tfEl.textContent = formatTimeMetric(metrics.fallTime);

        if (phaseEl && this.ch1ProbeNode && this.ch2ProbeNode) {
          const deg = calculatePhaseDifferenceDeg(this.transientResults, this.ch1ProbeNode, this.ch2ProbeNode);
          phaseEl.textContent = deg !== null ? `${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°` : "--";
        }
      } else {
        if (vppEl) vppEl.textContent = "--";
        if (vrmsEl) vrmsEl.textContent = "--";
        if (vavgEl) vavgEl.textContent = "--";
        if (freqEl) freqEl.textContent = "--";
        if (dutyEl) dutyEl.textContent = "--";
        if (trEl) trEl.textContent = "--";
        if (tfEl) tfEl.textContent = "--";
        if (phaseEl) phaseEl.textContent = "--";
      }
    }

    // Update dedicated Cursors telemetry card (#osc-meas-cursors)
    const cursorsCard = document.getElementById("osc-meas-cursors");
    if (cursorsCard) {
      const isCursorsOn = this.cursorMode !== "off" && this.isCursorsEnabled;
      cursorsCard.classList.toggle("active", isCursorsOn);

      if (isCursorsOn) {
        const modeBadge = cursorsCard.querySelector<HTMLElement>("#osc-meas-cursor-mode-badge");
        if (modeBadge) {
          const modeLabels: Record<CursorMode, string> = {
            off: "OFF",
            time: `Tiempo (X) [${this.cursorTargetChannel.toUpperCase()} ▾]`,
            voltage: `Voltaje (Y) [${this.cursorTargetChannel.toUpperCase()} ▾]`,
            both: `Ambos (XY) [${this.cursorTargetChannel.toUpperCase()} ▾]`,
            track: `Rastreo [${this.cursorTargetChannel.toUpperCase()} ▾]`,
          };
          modeBadge.textContent = modeLabels[this.cursorMode] ?? `Ambos [${this.cursorTargetChannel.toUpperCase()} ▾]`;
          modeBadge.title = `Canal medido: ${this.cursorTargetChannel.toUpperCase()} (Clic para alternar a otro canal)`;
          modeBadge.dataset.channel = this.cursorTargetChannel;
        }

        const deltaTime = Math.abs(this.cursorT2 - this.cursorT1) * this.timeDivValue * 10;
        const isTargetMath = this.cursorTargetChannel === "math";
        const targetNode = this.cursorTargetChannel === "math"
          ? null
          : this.getProbeNodeByChannel(this.cursorTargetChannel);

        let v1Actual = this.cursorV1;
        let v2Actual = this.cursorV2;
        if (this.cursorMode === "track" && this.transientResults.length > 0) {
          const triggerNode = this.getProbeNodeByChannel(this.triggerChannel);
          const trigStartIdx = findTriggerStartIndex(
            this.transientResults,
            triggerNode,
            this.triggerEdge,
            this.triggerLevel,
            this.timeDivValue,
          );

          if (isTargetMath && this.isMathEnabled) {
            const bindings = {
              ch1Node: this.ch1ProbeNode,
              ch2Node: this.ch2ProbeNode,
              ch3Node: this.ch3ProbeNode,
              ch4Node: this.ch4ProbeNode,
            };
            const mathVals = evaluateWaveformMath(this.mathExpression || "CH1 - CH2", this.transientResults, bindings);
            v1Actual = sampleArrayAtNormalizedTime(this.transientResults, mathVals, this.cursorT1, this.timeDivValue, trigStartIdx);
            v2Actual = sampleArrayAtNormalizedTime(this.transientResults, mathVals, this.cursorT2, this.timeDivValue, trigStartIdx);
          } else if (targetNode) {
            v1Actual = sampleVoltageAtNormalizedTime(this.transientResults, targetNode, this.cursorT1, this.timeDivValue, trigStartIdx);
            v2Actual = sampleVoltageAtNormalizedTime(this.transientResults, targetNode, this.cursorT2, this.timeDivValue, trigStartIdx);
          }
        }
        const deltaVoltage = Math.abs(v2Actual - v1Actual);
        const freq = deltaTime > 0 ? 1 / deltaTime : 0;
        const slewRate = deltaTime > 0 ? deltaVoltage / deltaTime : 0;

        const dtEl = cursorsCard.querySelector<HTMLElement>("#meas-cursor-dt");
        const freqEl = cursorsCard.querySelector<HTMLElement>("#meas-cursor-freq");
        const dvEl = cursorsCard.querySelector<HTMLElement>("#meas-cursor-dv");
        const slewEl = cursorsCard.querySelector<HTMLElement>("#meas-cursor-slew");
        const t1El = cursorsCard.querySelector<HTMLElement>("#meas-cursor-t1");
        const t2El = cursorsCard.querySelector<HTMLElement>("#meas-cursor-t2");
        const v1v2El = cursorsCard.querySelector<HTMLElement>("#meas-cursor-v1v2");

        if (this.cursorMode === "voltage") {
          if (dtEl) dtEl.textContent = "--";
          if (freqEl) freqEl.textContent = "--";
          if (slewEl) slewEl.textContent = "--";
          if (t1El) t1El.textContent = "--";
          if (t2El) t2El.textContent = "--";
          if (dvEl) dvEl.textContent = formatCursorVoltage(deltaVoltage);
          if (v1v2El) v1v2El.textContent = `${formatCursorVoltage(v1Actual)} | ${formatCursorVoltage(v2Actual)}`;
        } else if (this.cursorMode === "time") {
          if (dtEl) dtEl.textContent = formatCursorTime(deltaTime);
          if (freqEl) {
            if (freq >= 1e6) freqEl.textContent = `${(freq / 1e6).toFixed(2)} MHz`;
            else if (freq >= 1e3) freqEl.textContent = `${(freq / 1e3).toFixed(2)} kHz`;
            else freqEl.textContent = `${freq.toFixed(1)} Hz`;
          }
          if (slewEl) slewEl.textContent = "--";
          if (t1El) t1El.textContent = formatCursorTime(this.cursorT1 * this.timeDivValue * 10);
          if (t2El) t2El.textContent = formatCursorTime(this.cursorT2 * this.timeDivValue * 10);
          if (dvEl) dvEl.textContent = "--";
          if (v1v2El) v1v2El.textContent = "--";
        } else {
          // "both" or "track"
          if (dtEl) dtEl.textContent = formatCursorTime(deltaTime);
          if (freqEl) {
            if (freq >= 1e6) freqEl.textContent = `${(freq / 1e6).toFixed(2)} MHz`;
            else if (freq >= 1e3) freqEl.textContent = `${(freq / 1e3).toFixed(2)} kHz`;
            else freqEl.textContent = `${freq.toFixed(1)} Hz`;
          }
          if (dvEl) dvEl.textContent = formatCursorVoltage(deltaVoltage);
          if (slewEl) {
            if (slewRate >= 1e6) slewEl.textContent = `${(slewRate / 1e6).toFixed(2)} V/µs`;
            else if (slewRate >= 1e3) slewEl.textContent = `${(slewRate / 1e3).toFixed(2)} V/ms`;
            else slewEl.textContent = `${slewRate.toFixed(2)} V/s`;
          }
          if (t1El) t1El.textContent = formatCursorTime(this.cursorT1 * this.timeDivValue * 10);
          if (t2El) t2El.textContent = formatCursorTime(this.cursorT2 * this.timeDivValue * 10);
          if (v1v2El) v1v2El.textContent = `${formatCursorVoltage(v1Actual)} | ${formatCursorVoltage(v2Actual)}`;
        }
      }
    }
  }

  public snapshotPng(): void {
    if (!this.oscCanvas) return;
    const a = document.createElement("a");
    a.download = `oscilloscope_${Date.now()}.png`;
    a.href = this.oscCanvas.toDataURL("image/png");
    a.click();
  }

  public exportCsv(): void {
    if (!this.transientResults.length) return;
    const ch1Title = this.ch1ProbeNode ? `CH1_Node_${this.ch1ProbeNode}` : "CH1";
    const ch2Title = this.ch2ProbeNode ? `CH2_Node_${this.ch2ProbeNode}` : "CH2";
    const ch3Title = this.ch3ProbeNode ? `CH3_Node_${this.ch3ProbeNode}` : "CH3";
    const ch4Title = this.ch4ProbeNode ? `CH4_Node_${this.ch4ProbeNode}` : "CH4";
    let csv = `Time_s,${ch1Title}_V,${ch2Title}_V,${ch3Title}_V,${ch4Title}_V\n`;
    for (const pt of this.transientResults) {
      const v1 = this.ch1ProbeNode ? (pt.nodeVoltages[this.ch1ProbeNode] ?? 0) : 0;
      const v2 = this.ch2ProbeNode ? (pt.nodeVoltages[this.ch2ProbeNode] ?? 0) : 0;
      const v3 = this.ch3ProbeNode ? (pt.nodeVoltages[this.ch3ProbeNode] ?? 0) : 0;
      const v4 = this.ch4ProbeNode ? (pt.nodeVoltages[this.ch4ProbeNode] ?? 0) : 0;
      csv += `${pt.time},${v1},${v2},${v3},${v4}\n`;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `osciloscopio_datos_${Date.now()}.csv`);
    link.click();
    URL.revokeObjectURL(url);
  }

  public getAutomatedMeasurements(): AutomatedMeasurementItem[] {
    const activeNodes: string[] = [];
    if (this.ch1ProbeNode && this.oscCh1Btn?.classList.contains("active")) activeNodes.push(this.ch1ProbeNode);
    if (this.ch2ProbeNode && this.oscCh2Btn?.classList.contains("active")) activeNodes.push(this.ch2ProbeNode);
    if (this.ch3ProbeNode && this.oscCh3Btn?.classList.contains("active")) activeNodes.push(this.ch3ProbeNode);
    if (this.ch4ProbeNode && this.oscCh4Btn?.classList.contains("active")) activeNodes.push(this.ch4ProbeNode);

    return calculateAutomatedMeasurements(
      this.transientResults,
      this.acSweepResults,
      activeNodes.length > 0 ? activeNodes : ["1", "2", "out"],
    );
  }

  public exportMeasurementsCsv(circuitName = "Circuito Astryd"): void {
    const measurements = this.getAutomatedMeasurements();
    const csv = exportMeasurementsToCsv(measurements, { circuitName });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `mediciones_${circuitName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}.csv`);
    link.click();
    URL.revokeObjectURL(url);
  }

  public exportMeasurementsJson(circuitName = "Circuito Astryd"): void {
    const measurements = this.getAutomatedMeasurements();
    const json = exportMeasurementsToJson(measurements, { circuitName });
    const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `mediciones_${circuitName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}.json`);
    link.click();
    URL.revokeObjectURL(url);
  }

  public pause() {
    this.isOscPaused = true;
    this.cancelScheduledFrame();
  }

  public resume() {
    this.isOscPaused = false;
    if (this.isSimulating) this.refreshVisibility();
  }

  public start() {
    this.cancelScheduledFrame();
    this.isSimulating = true;
    this.isOscPaused = false;
    this.singleTriggerFired = false;
    this.refreshVisibility();
  }

  public stop() {
    this.isSimulating = false;
    this.cancelScheduledFrame();
    this.transientResults = [];
    this.acSweepResults = null;
    this.pvtTraces = [];
    this.singleTriggerFired = false;
    this.refreshVisibility();
  }

  /** Finaliza el streaming sin borrar las muestras recibidas. */
  public finish(): void {
    this.isSimulating = false;
    this.cancelScheduledFrame();
    this.refreshVisibility();
  }

  public rearmSingleTrigger(): void {
    this.singleTriggerFired = false;
    this.isOscPaused = false;
    this.refreshVisibility();
  }

  public setTriggerTo50Percent(): void {
    if (this.transientResults.length === 0) return;
    const trigNode = this.getProbeNodeByChannel(this.triggerChannel);
    if (!trigNode) return;
    this.triggerLevel = calculateTrigger50Percent(this.transientResults, trigNode);
    this.syncFocusedChannelUI();
    this.updateHud();
    this.draw();
  }

  public autoFit(channel: OscilloscopeChannel | "math" | null = null): boolean {
    if (this.transientResults.length === 0) return false;

    const channelsToFit: Array<{ ch: OscilloscopeChannel; node: string }> = [];

    if (channel && channel !== "math") {
      const node = this.getProbeNodeByChannel(channel);
      if (node) channelsToFit.push({ ch: channel, node });
    } else if (!channel) {
      const allChannels: readonly OscilloscopeChannel[] = ["ch1", "ch2", "ch3", "ch4"];
      const activeList: readonly [OscilloscopeChannel, boolean][] = [
        ["ch1", this.oscCh1Btn?.classList.contains("active") ?? false],
        ["ch2", this.oscCh2Btn?.classList.contains("active") ?? false],
        ["ch3", this.oscCh3Btn?.classList.contains("active") ?? false],
        ["ch4", this.oscCh4Btn?.classList.contains("active") ?? false],
      ];
      for (const [ch, isActive] of activeList) {
        if (!isActive) continue;
        const node = this.getProbeNodeByChannel(ch);
        if (node) channelsToFit.push({ ch, node });
      }

      // Auto-detección: Si ningún canal está marcado activo, activar los que tengan señal real (> 5mV)
      if (channelsToFit.length === 0 && !this.isMathEnabled) {
        for (const ch of allChannels) {
          const node = this.getProbeNodeByChannel(ch);
          if (!node) continue;
          const m = calculateOscilloscopeMetrics(this.transientResults, node);
          if (m.vpp > 0.005) {
            this.setChannelActive(ch, true);
            channelsToFit.push({ ch, node });
          }
        }
        if (channelsToFit.length === 0) {
          const fallbackCh = this.getAutoFitChannel() || "ch1";
          const node = this.getProbeNodeByChannel(fallbackCh);
          if (node) {
            this.setChannelActive(fallbackCh, true);
            channelsToFit.push({ ch: fallbackCh, node });
          }
        }
      }
    }

    let primaryFit: AutoFitSettings | null = null;
    let primaryChannel: OscilloscopeChannel = this.triggerChannel || "ch1";

    for (const { ch, node } of channelsToFit) {
      const coupling = ch === "ch1" ? this.couplingCh1 : ch === "ch2" ? this.couplingCh2 : ch === "ch3" ? this.couplingCh3 : this.couplingCh4;
      const fit = calculateAutoFitSettings(this.transientResults, node, coupling);
      if (!primaryFit || ch === primaryChannel) {
        primaryFit = fit;
        primaryChannel = ch;
      }

      const minOffset = -4;
      const maxOffset = 4;
      const voltsPerDiv = fit.voltsPerDiv;
      const offsetDivs = Math.abs(fit.centerVoltage) > 1e-4
        ? Math.min(maxOffset, Math.max(minOffset, -(fit.centerVoltage / voltsPerDiv)))
        : 0;

      if (ch === "ch1") {
        this.voltsPerDivCh1 = voltsPerDiv;
        this.offsetCh1 = offsetDivs;
      } else if (ch === "ch2") {
        this.voltsPerDivCh2 = voltsPerDiv;
        this.offsetCh2 = offsetDivs;
      } else if (ch === "ch3") {
        this.voltsPerDivCh3 = voltsPerDiv;
        this.offsetCh3 = offsetDivs;
      } else if (ch === "ch4") {
        this.voltsPerDivCh4 = voltsPerDiv;
        this.offsetCh4 = offsetDivs;
      }
    }

    // Auto-fit Math channel if requested or enabled
    if ((channel === "math" || (!channel && this.isMathEnabled)) && this.transientResults.length > 1) {
      const bindings = {
        ch1Node: this.ch1ProbeNode,
        ch2Node: this.ch2ProbeNode,
        ch3Node: this.ch3ProbeNode,
        ch4Node: this.ch4ProbeNode,
      };
      const mathVals = evaluateWaveformMath(this.mathExpression || "CH1 - CH2", this.transientResults, bindings);
      if (mathVals.length > 0) {
        const mathFit = calculateAutoFitForValues(mathVals, this.transientResults);
        this.mathVoltsPerDiv = mathFit.voltsPerDiv;
        this.mathOffset = Math.min(4, Math.max(-4, -(mathFit.centerVoltage / mathFit.voltsPerDiv)));
        if (!primaryFit && channel === "math") {
          primaryFit = mathFit;
        }
      }
    }

    if (primaryFit) {
      this.timeDivValue = primaryFit.timeDivValue;
      this.syncTimeDivSelect(primaryFit.timeDivValue);
      if (typeof primaryFit.triggerLevel50 === "number") {
        this.triggerLevel = primaryFit.triggerLevel50;
      }
    }

    this.syncFocusedChannelUI();
    this.updateHud();
    this.draw();
    return true;
  }

  // ==========================================================================
  // SEARCH & NAVIGATE IN TRACE
  // ==========================================================================

  public searchNextCrossing(
    channel?: "ch1" | "ch2" | "ch3" | "ch4" | "math",
    thresholdVolts = 0.0,
    edge: "rising" | "falling" | "both" = "both",
    fromIndex = 0,
  ): number | null {
    const ch = channel ?? this.focusedChannel;
    if (ch === "math") {
      const bindings = {
        ch1Node: this.ch1ProbeNode,
        ch2Node: this.ch2ProbeNode,
        ch3Node: this.ch3ProbeNode,
        ch4Node: this.ch4ProbeNode,
      };
      const mathVals = evaluateWaveformMath(this.mathExpression || "CH1 - CH2", this.transientResults, bindings);
      if (mathVals.length < 2) return null;
      for (let i = fromIndex; i < mathVals.length - 1; i++) {
        const vCurr = mathVals[i];
        const vNext = mathVals[i + 1];
        const isRising = vCurr <= thresholdVolts && vNext > thresholdVolts;
        const isFalling = vCurr >= thresholdVolts && vNext < thresholdVolts;
        if (edge === "rising" && isRising) return i + 1;
        if (edge === "falling" && isFalling) return i + 1;
        if (edge === "both" && (isRising || isFalling)) return i + 1;
      }
      return null;
    }
    const node = this.getProbeNodeByChannel(ch);
    if (!node) return null;
    return searchNextCrossing(this.transientResults, node, thresholdVolts, edge, fromIndex);
  }

  public searchNextPeak(
    channel?: "ch1" | "ch2" | "ch3" | "ch4" | "math",
    type: "max" | "min" | "both" = "both",
    fromIndex = 0,
  ): number | null {
    const ch = channel ?? this.focusedChannel;
    if (ch === "math") {
      const bindings = {
        ch1Node: this.ch1ProbeNode,
        ch2Node: this.ch2ProbeNode,
        ch3Node: this.ch3ProbeNode,
        ch4Node: this.ch4ProbeNode,
      };
      const mathVals = evaluateWaveformMath(this.mathExpression || "CH1 - CH2", this.transientResults, bindings);
      if (mathVals.length < 3) return null;
      for (let i = Math.max(1, fromIndex); i < mathVals.length - 1; i++) {
        const isMax = mathVals[i] > mathVals[i - 1] && mathVals[i] >= mathVals[i + 1];
        const isMin = mathVals[i] < mathVals[i - 1] && mathVals[i] <= mathVals[i + 1];
        if (type === "max" && isMax) return i;
        if (type === "min" && isMin) return i;
        if (type === "both" && (isMax || isMin)) return i;
      }
      return null;
    }
    const node = this.getProbeNodeByChannel(ch);
    if (!node) return null;
    return searchNextPeak(this.transientResults, node, type, fromIndex);
  }

  public jumpToTime(targetTime: number): boolean {
    if (this.transientResults.length === 0) return false;
    const sampleIdx = findTimeIndex(this.transientResults, targetTime);
    return this.jumpToSampleIndex(sampleIdx);
  }

  public jumpToSampleIndex(sampleIdx: number): boolean {
    if (this.transientResults.length === 0) return false;
    const clampedIdx = Math.max(0, Math.min(this.transientResults.length - 1, sampleIdx));
    const targetSample = this.transientResults[clampedIdx];
    if (!targetSample) return false;

    const totalDuration = this.timeDivValue * 10;
    const firstTime = this.transientResults[0]?.time ?? 0;
    const relTime = targetSample.time - firstTime;
    this.cursorT1 = Math.max(0.02, Math.min(0.98, relTime / totalDuration));
    this.draw();
    return true;
  }

  public setHistogramEnabled(enabled: boolean): void {
    this.isHistogramEnabled = enabled;
    this.draw();
  }

  public setMaskTesting(enabled: boolean, mask?: MaskToleranceDefinition): void {
    this.isMaskTestingEnabled = enabled;
    if (mask) this.activeMask = mask;
    this.draw();
  }
}
