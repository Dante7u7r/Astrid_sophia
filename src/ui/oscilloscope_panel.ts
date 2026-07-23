import type { PvtConfig, SParameterResult } from "../simulation/mcu-types";
import type { PersistedOscilloscopeState } from "../persistence/circuit_file";
import {
  calculateOscilloscopeMetrics,
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
  drawTyReticle,
  drawXyTrace,
} from "./oscilloscope_renderer";
import {
  dragOscilloscopeCursor,
  hitTestOscilloscopeCursor,
  type OscilloscopeCursor,
} from "./oscilloscope_cursor_model";

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

  // Buttons referenced in DOM
  private oscCh1Btn: HTMLButtonElement | null = null;
  private oscCh2Btn: HTMLButtonElement | null = null;
  private oscCh3Btn: HTMLButtonElement | null = null;
  private oscCh4Btn: HTMLButtonElement | null = null;

  // Controls UI elements
  private voltsCh1Select: HTMLSelectElement | null = null;
  private voltsCh2Select: HTMLSelectElement | null = null;
  private voltsCh3Select: HTMLSelectElement | null = null;
  private voltsCh4Select: HTMLSelectElement | null = null;

  private offsetCh1Slider: HTMLInputElement | null = null;
  private offsetCh2Slider: HTMLInputElement | null = null;
  private offsetCh3Slider: HTMLInputElement | null = null;
  private offsetCh4Slider: HTMLInputElement | null = null;

  private timeDivSelect: HTMLSelectElement | null = null;
  private cursorsBtn: HTMLButtonElement | null = null;

  private triggerModeSelect: HTMLSelectElement | null = null;
  private triggerEdgeSelect: HTMLSelectElement | null = null;
  private triggerLevelSlider: HTMLInputElement | null = null;

  private modeTyBtn: HTMLButtonElement | null = null;
  private modeXyBtn: HTMLButtonElement | null = null;

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

  // Interactive Cursors
  public isCursorsEnabled = false;
  private cursorT1 = 0.25; // fraction of width
  private cursorT2 = 0.75; // fraction of width
  private cursorV1 = 1.0;  // volts
  private cursorV2 = -1.0; // volts
  private draggingCursor: OscilloscopeCursor | null = null;

  // Calibration settings per channel
  public voltsPerDivCh1 = 1.0;
  public voltsPerDivCh2 = 1.0;
  public voltsPerDivCh3 = 1.0;
  public voltsPerDivCh4 = 1.0;

  public offsetCh1 = 0.0; // pixels
  public offsetCh2 = 0.0; // pixels
  public offsetCh3 = 0.0; // pixels
  public offsetCh4 = 0.0; // pixels

  public timeDivValue = 0.02; // seconds/div (default 20ms/div)
  public isXyMode = false;

  // Triggering
  public triggerChannel: OscilloscopeChannel = "ch1";
  public triggerEdge: TriggerEdge = "rising";
  public triggerLevel = 0.0; // volts

  private oscMouseX: number | null = null;
  private oscMouseY: number | null = null;
  private animationFrameId: number | null = null;
  private lastMeasurementsUpdateAt = 0;
  private readonly measurementsUpdateIntervalMs = 250;

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

    const voltsSelects = [
      this.voltsCh1Select,
      this.voltsCh2Select,
      this.voltsCh3Select,
      this.voltsCh4Select,
    ];
    voltsSelects.forEach((select, index) => {
      if (select) select.value = state.voltsPerDiv[index].toString();
    });

    const offsetSliders = [
      this.offsetCh1Slider,
      this.offsetCh2Slider,
      this.offsetCh3Slider,
      this.offsetCh4Slider,
    ];
    offsetSliders.forEach((slider, index) => {
      if (slider) slider.value = state.offsets[index].toString();
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
    this.draw();
  }

  constructor() {
    this.oscCanvas = document.querySelector("#osc-canvas");
    this.oscCh1Btn = document.querySelector("#osc-ch1-btn");
    this.oscCh2Btn = document.querySelector("#osc-ch2-btn");
    this.oscCh3Btn = document.querySelector("#osc-ch3-btn");
    this.oscCh4Btn = document.querySelector("#osc-ch4-btn");

    this.voltsCh1Select = document.querySelector("#osc-volts-ch1");
    this.voltsCh2Select = document.querySelector("#osc-volts-ch2");
    this.voltsCh3Select = document.querySelector("#osc-volts-ch3");
    this.voltsCh4Select = document.querySelector("#osc-volts-ch4");

    this.offsetCh1Slider = document.querySelector("#osc-offset-ch1");
    this.offsetCh2Slider = document.querySelector("#osc-offset-ch2");
    this.offsetCh3Slider = document.querySelector("#osc-offset-ch3");
    this.offsetCh4Slider = document.querySelector("#osc-offset-ch4");

    this.timeDivSelect = document.querySelector("#osc-time-div");
    this.cursorsBtn = document.querySelector("#osc-cursors-btn");

    this.triggerModeSelect = document.querySelector("#osc-trigger-mode");
    this.triggerEdgeSelect = document.querySelector("#osc-trigger-edge");
    this.triggerLevelSlider = document.querySelector("#osc-trigger-level");

    this.modeTyBtn = document.querySelector("#osc-mode-ty");
    this.modeXyBtn = document.querySelector("#osc-mode-xy");

    if (this.oscCanvas) {
      this.oscCtx = this.oscCanvas.getContext("2d");
      this.initEvents();
    }
  }

  private initEvents() {
    if (!this.oscCanvas) return;

    // 1. Mouse coordinates and Cursor dragging
    this.oscCanvas.addEventListener("mousedown", (e) => {
      if (!this.isCursorsEnabled || !this.oscCanvas) return;
      const rect = this.oscCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = this.oscCanvas.width;
      const h = this.oscCanvas.height;

      this.draggingCursor = hitTestOscilloscopeCursor(
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
          offsetCh1: this.offsetCh1,
        },
      );
    });

    this.oscCanvas.addEventListener("mousemove", (e) => {
      const rect = this.oscCanvas!.getBoundingClientRect();
      this.oscMouseX = e.clientX - rect.left;
      this.oscMouseY = e.clientY - rect.top;

      if (this.draggingCursor && this.isCursorsEnabled) {
        const w = this.oscCanvas!.width;
        const h = this.oscCanvas!.height;
        const nextCursorState = dragOscilloscopeCursor(
          this.draggingCursor,
          this.oscMouseX,
          this.oscMouseY,
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
            offsetCh1: this.offsetCh1,
          },
        );
        this.cursorT1 = nextCursorState.cursorT1;
        this.cursorT2 = nextCursorState.cursorT2;
        this.cursorV1 = nextCursorState.cursorV1;
        this.cursorV2 = nextCursorState.cursorV2;
        this.draw();
      }
    });

    window.addEventListener("mouseup", () => {
      this.draggingCursor = null;
    });
    window.addEventListener("resize", () => this.refreshVisibility());

    this.oscCanvas.addEventListener("mouseleave", () => {
      this.oscMouseX = null;
      this.oscMouseY = null;
      this.draggingCursor = null;
    });

    // 2. Control panel events
    const updateScales = () => {
      if (this.voltsCh1Select) this.voltsPerDivCh1 = parseFloat(this.voltsCh1Select.value);
      if (this.voltsCh2Select) this.voltsPerDivCh2 = parseFloat(this.voltsCh2Select.value);
      if (this.voltsCh3Select) this.voltsPerDivCh3 = parseFloat(this.voltsCh3Select.value);
      if (this.voltsCh4Select) this.voltsPerDivCh4 = parseFloat(this.voltsCh4Select.value);

      if (this.offsetCh1Slider) this.offsetCh1 = parseFloat(this.offsetCh1Slider.value);
      if (this.offsetCh2Slider) this.offsetCh2 = parseFloat(this.offsetCh2Slider.value);
      if (this.offsetCh3Slider) this.offsetCh3 = parseFloat(this.offsetCh3Slider.value);
      if (this.offsetCh4Slider) this.offsetCh4 = parseFloat(this.offsetCh4Slider.value);

      if (this.timeDivSelect) this.timeDivValue = parseFloat(this.timeDivSelect.value);

      if (this.triggerModeSelect) this.triggerChannel = normalizeTriggerChannel(this.triggerModeSelect.value);
      if (this.triggerEdgeSelect) this.triggerEdge = normalizeTriggerEdge(this.triggerEdgeSelect.value);
      if (this.triggerLevelSlider) this.triggerLevel = parseFloat(this.triggerLevelSlider.value) / 30;

      this.draw();
    };

    [
      this.voltsCh1Select, this.voltsCh2Select, this.voltsCh3Select, this.voltsCh4Select,
      this.offsetCh1Slider, this.offsetCh2Slider, this.offsetCh3Slider, this.offsetCh4Slider,
      this.timeDivSelect, this.triggerModeSelect, this.triggerEdgeSelect, this.triggerLevelSlider
    ].forEach(el => el?.addEventListener("input", updateScales));

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

    // Channels buttons wire
    const setupChToggle = (btn: HTMLButtonElement | null) => {
      btn?.addEventListener("click", () => {
        btn.classList.toggle("active");
        this.draw();
      });
    };
    setupChToggle(this.oscCh1Btn);
    setupChToggle(this.oscCh2Btn);
    setupChToggle(this.oscCh3Btn);
    setupChToggle(this.oscCh4Btn);
  }

  private getProbeNodeByChannel(ch: OscilloscopeChannel): string | null {
    if (ch === "ch1") return this.ch1ProbeNode;
    if (ch === "ch2") return this.ch2ProbeNode;
    if (ch === "ch3") return this.ch3ProbeNode;
    return this.ch4ProbeNode;
  }

  private isCanvasVisible(): boolean {
    if (!this.oscCanvas?.isConnected) return false;
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

    const width = this.oscCanvas.clientWidth;
    const height = this.oscCanvas.clientHeight;
    if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) return;
    
    if (this.oscCanvas.width !== width || this.oscCanvas.height !== height) {
      this.oscCanvas.width = width;
      this.oscCanvas.height = height;
    }

    // Phosphor dark green fade
    if (this.isSimulating && this.activeAnalysisMode !== 'AC') {
      this.oscCtx.fillStyle = 'rgba(3, 5, 8, 0.25)';
      this.oscCtx.fillRect(0, 0, width, height);
    } else {
      this.oscCtx.fillStyle = '#030508';
      this.oscCtx.fillRect(0, 0, width, height);
    }

    const isCh1Active = this.oscCh1Btn?.classList.contains('active') ?? false;
    const isCh2Active = this.oscCh2Btn?.classList.contains('active') ?? false;
    const isCh3Active = this.oscCh3Btn?.classList.contains('active') ?? false;
    const isCh4Active = this.oscCh4Btn?.classList.contains('active') ?? false;

    // --- MODO AC SWEEP: DIAGRAMA DE BODE LOGARÍTMICO ---
    if (this.activeAnalysisMode === 'AC' && this.acSweepResults !== null && this.acSweepResults.frequencies.length > 0) {
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
        this.offsetCh1,
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
        this.offsetCh1,
        this.offsetCh2,
      );

    } else {
      const ctx = this.oscCtx;
      const { divHeight } = drawTyReticle(this.oscCtx, width, height);

      if (this.isSimulating && !this.isOscPaused) {
        // Adjust sweep speed based on timeDivValue
        this.sweepTime += (this.timeDivValue * 10 / 100);
        if (this.sweepTime > this.timeDivValue * 10) {
          this.sweepTime = 0.0;
        }
        if (this.onFrameUpdate) {
          this.onFrameUpdate(this.sweepTime);
        }
      }

      const triggerNode = this.getProbeNodeByChannel(this.triggerChannel);
      const triggerStartIdx = findTriggerStartIndex(
        this.transientResults,
        triggerNode,
        this.triggerEdge,
        this.triggerLevel,
      );

      // Draw channels
      const drawChannelTY = (nodeId: string, color: string, voltsPerDiv: number, offsetPixels: number, isActive: boolean) => {
        if (!isActive || !nodeId || triggerStartIdx >= this.transientResults.length) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2.0;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();

        const tracePoints = buildTyTracePoints(
          this.transientResults,
          nodeId,
          { width, height },
          { voltsPerDiv, offsetPixels, timeDivValue: this.timeDivValue },
          triggerStartIdx,
        );
        for (let i = 0; i < tracePoints.length; i++) {
          const point = tracePoints[i];
          if (i === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      drawChannelTY(this.ch1ProbeNode || "", '#66fcf1', this.voltsPerDivCh1, this.offsetCh1, isCh1Active);
      drawChannelTY(this.ch2ProbeNode || "", '#a855f7', this.voltsPerDivCh2, this.offsetCh2, isCh2Active);
      drawChannelTY(this.ch3ProbeNode || "", '#f97316', this.voltsPerDivCh3, this.offsetCh3, isCh3Active);
      drawChannelTY(this.ch4ProbeNode || "", '#22c55e', this.voltsPerDivCh4, this.offsetCh4, isCh4Active);

      this.updateMeasurementsIfNeeded(
        [
          { id: "osc-meas-ch1", node: this.ch1ProbeNode, active: isCh1Active, color: "#66fcf1" },
          { id: "osc-meas-ch2", node: this.ch2ProbeNode, active: isCh2Active, color: "#a855f7" },
          { id: "osc-meas-ch3", node: this.ch3ProbeNode, active: isCh3Active, color: "#f97316" },
          { id: "osc-meas-ch4", node: this.ch4ProbeNode, active: isCh4Active, color: "#22c55e" },
        ],
      );

      if (this.isCursorsEnabled) {
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
          this.offsetCh1,
          this.timeDivValue,
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
      const el = document.getElementById(channel.id);
      if (!el) continue;

      const label = channel.id.replace("osc-meas-", "").toUpperCase();
      if (channel.active && channel.node) {
        const metrics = calculateOscilloscopeMetrics(this.transientResults, channel.node);
        el.innerHTML = `<span style="font-weight:bold; color:${channel.color}">${label}:</span> Vpp=${metrics.vpp.toFixed(2)}V, Vrms=${metrics.vrms.toFixed(2)}V, F=${metrics.freq.toFixed(0)}Hz`;
      } else {
        el.textContent = `${label}: --`;
      }
    }
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
    this.refreshVisibility();
  }

  public stop() {
    this.isSimulating = false;
    this.cancelScheduledFrame();
    this.transientResults = [];
    this.acSweepResults = null;
    this.pvtTraces = [];
    this.refreshVisibility();
  }
}
