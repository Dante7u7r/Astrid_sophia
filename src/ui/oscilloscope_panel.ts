import type { PvtConfig, SParameterResult } from "../simulation/mcu-types";
import type { PersistedOscilloscopeState } from "../persistence/circuit_file";
import {
  calculateOscilloscopeMetrics,
  calculateAutoFitSettings,
  buildTyTracePoints,
  findTriggerStartIndex,
  normalizeTriggerChannel,
  normalizeTriggerEdge,
  type OscilloscopeChannel,
  type TriggerEdge,
} from "./oscilloscope_model";
import {
  drawAcSweep,
  drawOscilloscopeCursors,
  drawPvtTraces,
  drawSplitTyReticle,
  drawTyReticle,
  drawXyTrace,
} from "./oscilloscope_renderer";
import {
  dragOscilloscopeCursor,
  hitTestOscilloscopeCursor,
  type OscilloscopeCursor,
} from "./oscilloscope_cursor_model";
import { ensureCanvasDpr } from "./canvas_dpr";

export interface PvtRunResult {
  readonly config: PvtConfig;
  readonly transient: readonly TimeStepResult[];
  readonly converged: boolean;
  readonly error: string | null;
}

export interface PvtTrace {
  config: PvtConfig;
  results: readonly TimeStepResult[];
  visible: boolean;
  color: string;
}

export interface TimeStepResult {
  time: number;
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
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
  private cursorsBtn: HTMLButtonElement | null = null;
  private mathBtn: HTMLButtonElement | null = null;
  private snapshotBtn: HTMLButtonElement | null = null;
  private csvBtn: HTMLButtonElement | null = null;

  private triggerModeSelect: HTMLSelectElement | null = null;
  private triggerEdgeSelect: HTMLSelectElement | null = null;
  private triggerLevelSlider: HTMLInputElement | null = null;
  private triggerSweepModeSelect: HTMLSelectElement | null = null;

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
  public ch2ProbeNode: string | null = "2";
  public ch3ProbeNode: string | null = "3";
  public ch4ProbeNode: string | null = "4";

  public onFrameUpdate?: (sweepTime: number) => void;

  // PVT Multi-corner overlay
  public pvtMode = false;
  public pvtTraces: PvtTrace[] = [];
  public pvtColors: string[] = ['#66fcf1', '#a855f7', '#f97316', '#22c55e', '#ef4444'];

  // SPAR (S-Parameter) state
  public sparResult: SParameterResult | null = null;
  public sparCh1Index = 0;
  public sparCh2Index = 1;

  // Interactive Cursors & Marker Dragging
  public isCursorsEnabled = false;
  private cursorT1 = 0.25; // fraction of width
  private cursorT2 = 0.75; // fraction of width
  private cursorV1 = 1.0;  // volts
  private cursorV2 = -1.0; // volts
  private draggingMarker: null | { type: "cursor"; cursor: OscilloscopeCursor } | { type: "channelOffset"; channel: 1 | 2 | 3 | 4 } | { type: "triggerLevel" } = null;

  public onPickProbeRequested?: (channel: "ch1" | "ch2" | "ch3" | "ch4") => void;

  // Calibration settings per channel
  public voltsPerDivCh1 = 1.0;
  public voltsPerDivCh2 = 1.0;
  public voltsPerDivCh3 = 1.0;
  public voltsPerDivCh4 = 1.0;

  // Offsets in Divisions (-4.0 to +4.0 div)
  public offsetCh1 = 0.0;
  public offsetCh2 = 0.0;
  public offsetCh3 = 0.0;
  public offsetCh4 = 0.0;

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
    return val >= 0.001 ? `${(val * 1000).toFixed(0)} ms/div` : `${(val * 1000000).toFixed(0)} µs/div`;
  }

  public getVoltsPerDiv(ch: "ch1" | "ch2" | "ch3" | "ch4" | "math"): number {
    if (ch === "ch1" || ch === "math") return this.voltsPerDivCh1;
    if (ch === "ch2") return this.voltsPerDivCh2;
    if (ch === "ch3") return this.voltsPerDivCh3;
    return this.voltsPerDivCh4;
  }

  public getOffsetDivs(ch: "ch1" | "ch2" | "ch3" | "ch4" | "math"): number {
    if (ch === "ch1" || ch === "math") return this.offsetCh1;
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
      triggerChannel: this.triggerChannel,
      triggerEdge: this.triggerEdge,
      triggerLevel: this.triggerLevel,
      cursorT1: this.cursorT1,
      cursorT2: this.cursorT2,
      cursorV1: this.cursorV1,
      cursorV2: this.cursorV2,
    };
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
    this.isCursorsEnabled = state.isCursorsEnabled;
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

    if (this.timeDivSelect) this.timeDivSelect.value = state.timeDivValue.toString();
    if (this.triggerModeSelect) this.triggerModeSelect.value = state.triggerChannel;
    if (this.triggerEdgeSelect) this.triggerEdgeSelect.value = state.triggerEdge;
    if (this.triggerLevelSlider) this.triggerLevelSlider.value = (state.triggerLevel * 30).toString();

    this.modeTyBtn?.classList.toggle("active", !state.isXyMode);
    this.modeXyBtn?.classList.toggle("active", state.isXyMode);
    if (this.cursorsBtn) {
      this.cursorsBtn.textContent = state.isCursorsEnabled ? "📏 Cursores: ON" : "📏 Cursores: OFF";
      this.cursorsBtn.classList.toggle("active", state.isCursorsEnabled);
    }
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
    this.cursorsBtn = document.querySelector("#osc-cursors-btn");
    this.mathBtn = document.querySelector("#osc-math-btn");
    this.snapshotBtn = document.querySelector("#osc-snapshot-btn");
    this.csvBtn = document.querySelector("#osc-csv-btn");

    this.triggerModeSelect = document.querySelector("#osc-trigger-mode");
    this.triggerEdgeSelect = document.querySelector("#osc-trigger-edge");
    this.triggerLevelSlider = document.querySelector("#osc-trigger-level");
    this.triggerSweepModeSelect = document.querySelector("#osc-trigger-sweep-mode");

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
    }
  }

  public setFocusedChannel(ch: "ch1" | "ch2" | "ch3" | "ch4" | "math"): void {
    this.focusedChannel = ch;
    this.syncFocusedChannelUI();
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
        math: "MATEMÁTICAS (CH1 - CH2)",
      };
      this.focusedTitle.textContent = titles[ch];
    }

    // Active Toggle Button
    const isChannelActive = (key: "ch1" | "ch2" | "ch3" | "ch4" | "math") => {
      if (key === "ch1") return this.oscCh1Btn?.classList.contains("active") ?? true;
      if (key === "ch2") return this.oscCh2Btn?.classList.contains("active") ?? false;
      if (key === "ch3") return this.oscCh3Btn?.classList.contains("active") ?? false;
      if (key === "ch4") return this.oscCh4Btn?.classList.contains("active") ?? false;
      return this.isMathEnabled;
    };
    const active = isChannelActive(ch);
    if (this.focusedToggleBtn) {
      this.focusedToggleBtn.textContent = active ? "ON" : "OFF";
      this.focusedToggleBtn.classList.toggle("active", active);
    }

    // Node Input
    if (this.focusedNodeInput) {
      if (ch === "math") {
        this.focusedNodeInput.value = "CH1 - CH2";
        this.focusedNodeInput.disabled = true;
      } else {
        this.focusedNodeInput.disabled = false;
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
    if (trigVal) trigVal.textContent = `${this.triggerLevel.toFixed(1)} V`;
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
      if (this.isCursorsEnabled) {
        const cursor = hitTestOscilloscopeCursor(
          x,
          y,
          {
            cursorT1: this.cursorT1,
            cursorT2: this.cursorT2,
            cursorV1: this.cursorV1,
            cursorV2: this.cursorV2,
          },
          {
            width: w,
            height: h,
            voltsPerDivCh1: this.voltsPerDivCh1,
            offsetCh1: this.offsetCh1 * divHeight,
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
          this.draw();
        } else if (this.draggingMarker.type === "cursor" && this.isCursorsEnabled) {
          const nextCursorState = dragOscilloscopeCursor(
            this.draggingMarker.cursor,
            this.oscMouseX!,
            this.oscMouseY!,
            {
              cursorT1: this.cursorT1,
              cursorT2: this.cursorT2,
              cursorV1: this.cursorV1,
              cursorV2: this.cursorV2,
            },
            {
              width: w,
              height: h,
              voltsPerDivCh1: this.voltsPerDivCh1,
              offsetCh1: this.offsetCh1 * divHeight,
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
          this.draw();
        }
      } else {
        // Hover cursor hints
        const x = this.oscMouseX!;
        const y = this.oscMouseY!;

        let cursorStyle = "crosshair";

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
        } else if (this.isCursorsEnabled) {
          const hoveredCursor = hitTestOscilloscopeCursor(
            x,
            y,
            {
              cursorT1: this.cursorT1,
              cursorT2: this.cursorT2,
              cursorV1: this.cursorV1,
              cursorV2: this.cursorV2,
            },
            {
              width: w,
              height: h,
              voltsPerDivCh1: this.voltsPerDivCh1,
              offsetCh1: this.offsetCh1 * divHeight,
            },
            12,
          );
          if (hoveredCursor === "T1" || hoveredCursor === "T2") {
            cursorStyle = "ew-resize";
          } else if (hoveredCursor === "V1" || hoveredCursor === "V2") {
            cursorStyle = "ns-resize";
          }
        }

        this.oscCanvas!.style.cursor = cursorStyle;
      }
    });

    window.addEventListener("mouseup", () => {
      this.draggingMarker = null;
    });
    window.addEventListener("resize", () => this.refreshVisibility());

    this.oscCanvas.addEventListener("mouseleave", () => {
      this.oscMouseX = null;
      this.oscMouseY = null;
      this.draggingMarker = null;
    });

    // 2. Channel Tabs
    this.tabCh1?.addEventListener("click", () => this.setFocusedChannel("ch1"));
    this.tabCh2?.addEventListener("click", () => this.setFocusedChannel("ch2"));
    this.tabCh3?.addEventListener("click", () => this.setFocusedChannel("ch3"));
    this.tabCh4?.addEventListener("click", () => this.setFocusedChannel("ch4"));
    this.tabMath?.addEventListener("click", () => this.setFocusedChannel("math"));

    // 3. Probe Picker Button in focused channel card
    const pickProbeBtn = document.querySelector<HTMLButtonElement>("#osc-focused-pick-probe-btn");
    pickProbeBtn?.addEventListener("click", () => {
      const ch = this.focusedChannel === "math" ? "ch1" : this.focusedChannel;
      this.onPickProbeRequested?.(ch);
    });

    // 3. Focused Card Controls
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
      if (ch === "ch1") this.ch1ProbeNode = val;
      else if (ch === "ch2") this.ch2ProbeNode = val;
      else if (ch === "ch3") this.ch3ProbeNode = val;
      else if (ch === "ch4") this.ch4ProbeNode = val;
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
      if (ch === "ch1" || ch === "math") this.voltsPerDivCh1 = val;
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
      if (ch === "ch1" || ch === "math") this.offsetCh1 = val;
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

    this.triggerModeSelect?.addEventListener("input", () => {
      if (this.triggerModeSelect) this.triggerChannel = normalizeTriggerChannel(this.triggerModeSelect.value);
      this.draw();
    });

    this.triggerEdgeSelect?.addEventListener("input", () => {
      if (this.triggerEdgeSelect) this.triggerEdge = normalizeTriggerEdge(this.triggerEdgeSelect.value);
      this.draw();
    });

    this.triggerLevelSlider?.addEventListener("input", () => {
      if (this.triggerLevelSlider) this.triggerLevel = parseFloat(this.triggerLevelSlider.value) / 30;
      this.updateHud();
      this.draw();
    });

    this.triggerSweepModeSelect?.addEventListener("input", () => {
      if (this.triggerSweepModeSelect) {
        this.triggerSweepMode = (this.triggerSweepModeSelect.value as "auto" | "normal" | "single") || "auto";
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

    // Cursors toggle
    this.cursorsBtn?.addEventListener("click", () => {
      this.isCursorsEnabled = !this.isCursorsEnabled;
      if (this.cursorsBtn) {
        this.cursorsBtn.textContent = this.isCursorsEnabled ? "📏 Cursores: ON" : "📏 Cursores: OFF";
        this.cursorsBtn.classList.toggle("active", this.isCursorsEnabled);
      }
      this.draw();
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
      return floatingWindow.clientWidth > 0 && floatingWindow.clientHeight > 0;
    }
    const dock = this.oscCanvas.closest("#bottom-dock");
    if (dock?.classList.contains("collapsed")) return false;
    return this.oscCanvas.getClientRects().length > 0
      && this.oscCanvas.clientWidth > 0
      && this.oscCanvas.clientHeight > 0;
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

    // Clean background clear (NO GHOST TRAILS, NO SMUDGING)
    this.oscCtx.fillStyle = "#030508";
    this.oscCtx.fillRect(0, 0, width, height);

    const isCh1Active = this.oscCh1Btn?.classList.contains("active") ?? false;
    const isCh2Active = this.oscCh2Btn?.classList.contains("active") ?? false;
    const isCh3Active = this.oscCh3Btn?.classList.contains("active") ?? false;
    const isCh4Active = this.oscCh4Btn?.classList.contains("active") ?? false;

    // --- MODO AC SWEEP: DIAGRAMA DE BODE LOGARÍTMICO ---
    if (this.activeAnalysisMode === "AC" && this.acSweepResults !== null && this.acSweepResults.frequencies.length > 0) {
      drawAcSweep(this.oscCtx, width, height, this.acSweepResults, [
        { node: this.ch1ProbeNode, color: "#66fcf1", active: isCh1Active },
        { node: this.ch2ProbeNode, color: "#a855f7", active: isCh2Active },
        { node: this.ch3ProbeNode, color: "#f97316", active: isCh3Active },
        { node: this.ch4ProbeNode, color: "#22c55e", active: isCh4Active },
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
    } else if (this.isXyMode && isCh1Active && isCh2Active && this.transientResults.length > 1) {
      drawXyTrace(
        this.oscCtx,
        width,
        height,
        this.transientResults,
        this.ch1ProbeNode || "1",
        this.ch2ProbeNode || "2",
        this.voltsPerDivCh1,
        this.voltsPerDivCh2,
        this.offsetCh1 * (height / 8),
        this.offsetCh2 * (height / 8),
      );

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

      const activeChannelsList = [
        { num: 1, node: this.ch1ProbeNode || "1", color: "#66fcf1", voltsPerDiv: this.voltsPerDivCh1, offsetDivs: this.offsetCh1, active: isCh1Active, coupling: this.couplingCh1, invert: this.invertCh1 },
        { num: 2, node: this.ch2ProbeNode || "2", color: "#a855f7", voltsPerDiv: this.voltsPerDivCh2, offsetDivs: this.offsetCh2, active: isCh2Active, coupling: this.couplingCh2, invert: this.invertCh2 },
        { num: 3, node: this.ch3ProbeNode || "3", color: "#f97316", voltsPerDiv: this.voltsPerDivCh3, offsetDivs: this.offsetCh3, active: isCh3Active, coupling: this.couplingCh3, invert: this.invertCh3 },
        { num: 4, node: this.ch4ProbeNode || "4", color: "#22c55e", voltsPerDiv: this.voltsPerDivCh4, offsetDivs: this.offsetCh4, active: isCh4Active, coupling: this.couplingCh4, invert: this.invertCh4 },
      ].filter(c => c.active && c.node);

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

          ctx.strokeStyle = ch.color;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          for (let i = 0; i < tracePoints.length; i++) {
            const pt = tracePoints[i];
            const px = pt.x;
            const py = pt.y + topY;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      } else {
        // Overlay standard single grid
        drawTyReticle(this.oscCtx, width, height, {
          channels: [
            { num: 1, color: "#66fcf1", offsetPixels: this.offsetCh1 * divHeight, active: isCh1Active },
            { num: 2, color: "#a855f7", offsetPixels: this.offsetCh2 * divHeight, active: isCh2Active },
            { num: 3, color: "#f97316", offsetPixels: this.offsetCh3 * divHeight, active: isCh3Active },
            { num: 4, color: "#22c55e", offsetPixels: this.offsetCh4 * divHeight, active: isCh4Active },
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

        // Draw channel traces (Clean, Crisp, 60 FPS, Zero Slicing Lag)
        const drawChannelTY = (
          nodeId: string,
          color: string,
          voltsPerDiv: number,
          offsetDivs: number,
          isActive: boolean,
          config: { coupling: "dc" | "ac" | "gnd"; invert: boolean },
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

          ctx.strokeStyle = color;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          for (let i = 0; i < tracePoints.length; i++) {
            const point = tracePoints[i];
            if (i === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
          }
          ctx.stroke();
        };

        drawChannelTY(this.ch1ProbeNode || "1", "#66fcf1", this.voltsPerDivCh1, this.offsetCh1, isCh1Active, {
          coupling: this.couplingCh1,
          invert: this.invertCh1,
        });
        drawChannelTY(this.ch2ProbeNode || "2", "#a855f7", this.voltsPerDivCh2, this.offsetCh2, isCh2Active, {
          coupling: this.couplingCh2,
          invert: this.invertCh2,
        });
        drawChannelTY(this.ch3ProbeNode || "3", "#f97316", this.voltsPerDivCh3, this.offsetCh3, isCh3Active, {
          coupling: this.couplingCh3,
          invert: this.invertCh3,
        });
        drawChannelTY(this.ch4ProbeNode || "4", "#22c55e", this.voltsPerDivCh4, this.offsetCh4, isCh4Active, {
          coupling: this.couplingCh4,
          invert: this.invertCh4,
        });

        // Render MATH channel (CH1 - CH2 differential) if enabled
        if (this.isMathEnabled && this.ch1ProbeNode && this.ch2ProbeNode && isCh1Active && isCh2Active && this.transientResults.length > 1) {
          ctx.strokeStyle = "#ec4899";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 2]);
          ctx.beginPath();

          const windowDuration = this.timeDivValue * 10;
          const firstTime = this.transientResults[triggerStartIdx]?.time ?? 0;

          for (let i = triggerStartIdx; i < this.transientResults.length; i++) {
            const pt = this.transientResults[i];
            const relTime = pt.time - firstTime;
            if (relTime > windowDuration) break;
            const x = (relTime / windowDuration) * width;

            const v1 = pt.nodeVoltages[this.ch1ProbeNode] ?? 0;
            const v2 = pt.nodeVoltages[this.ch2ProbeNode] ?? 0;
            const vMath = v1 - v2;
            const y = height / 2 - (vMath / this.voltsPerDivCh1) * divHeight;

            if (i === triggerStartIdx) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      this.updateMeasurementsIfNeeded(
        [
          { id: "osc-meas-ch1", node: this.ch1ProbeNode, active: isCh1Active, color: "#66fcf1" },
          { id: "osc-meas-ch2", node: this.ch2ProbeNode, active: isCh2Active, color: "#a855f7" },
          { id: "osc-meas-ch3", node: this.ch3ProbeNode, active: isCh3Active, color: "#f97316" },
          { id: "osc-meas-ch4", node: this.ch4ProbeNode, active: isCh4Active, color: "#22c55e" },
        ],
      );

      if (this.isCursorsEnabled) {
        const activeProbe = this.ch1ProbeNode || this.ch2ProbeNode || this.ch3ProbeNode || this.ch4ProbeNode;
        const metrics = activeProbe && this.transientResults.length > 2
          ? calculateOscilloscopeMetrics(this.transientResults, activeProbe)
          : null;

        drawOscilloscopeCursors(
          this.oscCtx,
          width,
          height,
          divHeight,
          this.cursorT1,
          this.cursorT2,
          this.cursorV1,
          this.cursorV2,
          this.voltsPerDivCh1,
          this.offsetCh1 * divHeight,
          this.timeDivValue,
          metrics?.period,
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

    // Keep transient results bounded during long simulation runs to prevent memory bloat
    if (this.transientResults.length > 15_000) {
      this.transientResults = this.transientResults.slice(-10_000);
    }

    for (const channel of channels) {
      const card = document.getElementById(channel.id);
      if (!card) continue;
      card.classList.toggle("active", channel.active);

      const nodeBadge = card.querySelector<HTMLElement>(".meas-node-badge");
      if (nodeBadge) {
        nodeBadge.textContent = channel.node ? `N:${channel.node}` : "No Probe";
      }

      const vppEl = card.querySelector<HTMLElement>(".val-vpp");
      const vrmsEl = card.querySelector<HTMLElement>(".val-vrms");
      const vavgEl = card.querySelector<HTMLElement>(".val-vavg");
      const freqEl = card.querySelector<HTMLElement>(".val-freq");
      const dutyEl = card.querySelector<HTMLElement>(".val-duty");

      if (channel.active && channel.node) {
        const metrics = calculateOscilloscopeMetrics(this.transientResults, channel.node);
        const freqStr = metrics.freq >= 1000 ? `${(metrics.freq / 1000).toFixed(2)}k` : `${metrics.freq.toFixed(0)}`;
        const freqUnit = metrics.freq >= 1000 ? "kHz" : "Hz";

        if (vppEl) vppEl.textContent = metrics.vpp >= 1 ? `${metrics.vpp.toFixed(2)}V` : `${(metrics.vpp * 1000).toFixed(0)}mV`;
        if (vrmsEl) vrmsEl.textContent = metrics.vrms >= 1 ? `${metrics.vrms.toFixed(2)}V` : `${(metrics.vrms * 1000).toFixed(0)}mV`;
        if (vavgEl) vavgEl.textContent = `${metrics.vavg >= 0 ? '+' : ''}${metrics.vavg.toFixed(2)}V`;
        if (freqEl) freqEl.textContent = metrics.freq > 0 ? `${freqStr}${freqUnit}` : "--";
        if (dutyEl) dutyEl.textContent = metrics.freq > 0 ? `${metrics.duty.toFixed(0)}%` : "--";
      } else {
        if (vppEl) vppEl.textContent = "--";
        if (vrmsEl) vrmsEl.textContent = "--";
        if (vavgEl) vavgEl.textContent = "--";
        if (freqEl) freqEl.textContent = "--";
        if (dutyEl) dutyEl.textContent = "--";
      }
    }
  }

  public snapshotPng(): void {
    if (!this.oscCanvas) return;
    const link = document.createElement("a");
    link.download = `osciloscopio_captura_${Date.now()}.png`;
    link.href = this.oscCanvas.toDataURL("image/png");
    link.click();
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

  public autoFit(channel: OscilloscopeChannel | null = null): boolean {
    const selectedChannel = channel ?? this.getAutoFitChannel();
    const probeNode = selectedChannel ? this.getProbeNodeByChannel(selectedChannel) : null;
    if (!selectedChannel || !probeNode || this.transientResults.length === 0) return false;

    const fit = calculateAutoFitSettings(this.transientResults, probeNode);
    this.timeDivValue = fit.timeDivValue;
    if (this.timeDivSelect) this.timeDivSelect.value = fit.timeDivValue.toString();

    const minOffset = -4;
    const maxOffset = 4;
    const voltsPerDiv = fit.voltsPerDiv;
    const offsetDivs = Math.min(
      maxOffset,
      Math.max(minOffset, -(fit.centerVoltage / voltsPerDiv)),
    );

    if (selectedChannel === "ch1") this.voltsPerDivCh1 = voltsPerDiv;
    else if (selectedChannel === "ch2") this.voltsPerDivCh2 = voltsPerDiv;
    else if (selectedChannel === "ch3") this.voltsPerDivCh3 = voltsPerDiv;
    else this.voltsPerDivCh4 = voltsPerDiv;

    if (selectedChannel === "ch1") this.offsetCh1 = offsetDivs;
    else if (selectedChannel === "ch2") this.offsetCh2 = offsetDivs;
    else if (selectedChannel === "ch3") this.offsetCh3 = offsetDivs;
    else this.offsetCh4 = offsetDivs;

    this.syncFocusedChannelUI();
    this.updateHud();
    this.draw();
    return true;
  }
}
