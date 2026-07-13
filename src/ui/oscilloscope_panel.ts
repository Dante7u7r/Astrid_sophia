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
      const ctx = this.oscCtx!;
      const freqs = this.acSweepResults.frequencies;
      const fMin = freqs[0];
      const fMax = freqs[freqs.length - 1];
      const logMin = Math.log10(fMin);
      const logMax = Math.log10(fMax);

      // Decades Grid
      ctx.strokeStyle = 'rgba(102, 252, 241, 0.08)';
      ctx.lineWidth = 1;
      const decades = [10, 100, 1000, 10000, 100000];
      decades.forEach(dec => {
        if (dec >= fMin && dec <= fMax) {
          const x = ((Math.log10(dec) - logMin) / (logMax - logMin)) * width;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height - 15);
          ctx.stroke();
          ctx.fillStyle = 'rgba(102, 252, 241, 0.4)';
          ctx.font = '9px var(--font-sans)';
          ctx.textAlign = 'center';
          const label = dec >= 1000 ? (dec / 1000) + " kHz" : dec + " Hz";
          ctx.fillText(label, x, height - 4);
        }
      });

      // Bode Curving
      const drawBode = (nodeId: string, color: string, isActive: boolean) => {
        if (!isActive || !nodeId) return;
        const amps = this.acSweepResults!.nodeAmplitudes[nodeId];
        if (!amps || amps.length === 0) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let i = 0; i < freqs.length; i++) {
          const x = ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * width;
          const db = amps[i];
          const y = (height - 15) * (1.0 - (db - (-80)) / (20 - (-80)));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      drawBode(this.ch1ProbeNode || "", '#66fcf1', isCh1Active);
      drawBode(this.ch2ProbeNode || "", '#a855f7', isCh2Active);
      drawBode(this.ch3ProbeNode || "", '#f97316', isCh3Active);
      drawBode(this.ch4ProbeNode || "", '#22c55e', isCh4Active);

    } else if (this.isXyMode && isCh1Active && isCh2Active && this.transientResults.length > 1) {
      // --- MODO X-Y: CURVAS DE LISSAJOUS ---
      const ctx = this.oscCtx!;
      ctx.strokeStyle = 'rgba(102, 252, 241, 0.05)';
      ctx.lineWidth = 1;
      // Draw XY Grid
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      ctx.strokeStyle = '#66fcf1';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#66fcf1';
      ctx.shadowBlur = 6;
      ctx.beginPath();

      const nodeX = this.ch1ProbeNode || "1";
      const nodeY = this.ch2ProbeNode || "2";

      for (let i = 0; i < this.transientResults.length; i++) {
        const pt = this.transientResults[i];
        const vx = pt.nodeVoltages[nodeX] ?? 0.0;
        const vy = pt.nodeVoltages[nodeY] ?? 0.0;

        const x = width / 2 + (vx / this.voltsPerDivCh1) * (width / 10) + this.offsetCh1;
        const y = height / 2 - (vy / this.voltsPerDivCh2) * (height / 8) - this.offsetCh2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

    } else {
      // --- MODO T-Y (ESTÁNDAR) ---
      const ctx = this.oscCtx!;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      
      const divWidth = width / 10;
      const divHeight = height / 8;

      // Draw standard reticle grid
      for (let x = 0; x <= width; x += divWidth) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y <= height; y += divHeight) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Central axes
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
      ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
      ctx.stroke();

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

      const pointsToDraw = this.transientResults.slice(triggerStartIdx);

      // Draw channels
      const drawChannelTY = (nodeId: string, color: string, voltsPerDiv: number, offsetPixels: number, isActive: boolean) => {
        if (!isActive || !nodeId || pointsToDraw.length === 0) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2.0;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();

        const tracePoints = buildTyTracePoints(
          pointsToDraw,
          nodeId,
          { width, height },
          { voltsPerDiv, offsetPixels, timeDivValue: this.timeDivValue },
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

      // Draw Interactive Cursors
      if (this.isCursorsEnabled) {
        ctx.strokeStyle = "rgba(251, 191, 36, 0.7)"; // Yellow vertical Cursors
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        // T1
        const x1 = this.cursorT1 * width;
        ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, height); ctx.stroke();
        ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
        ctx.font = "8px var(--font-mono)";
        ctx.fillText("t1", x1 + 4, 12);

        // T2
        const x2 = this.cursorT2 * width;
        ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, height); ctx.stroke();
        ctx.fillText("t2", x2 + 4, 12);

        // V1 and V2
        ctx.strokeStyle = "rgba(244, 63, 94, 0.7)"; // Pink horizontal Cursors
        const centerY = height / 2;
        const y1 = centerY - (this.cursorV1 / this.voltsPerDivCh1) * divHeight - this.offsetCh1;
        const y2 = centerY - (this.cursorV2 / this.voltsPerDivCh1) * divHeight - this.offsetCh1;

        ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(width, y1); ctx.stroke();
        ctx.fillStyle = "rgba(244, 63, 94, 0.9)";
        ctx.fillText("v1", 4, y1 - 4);

        ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(width, y2); ctx.stroke();
        ctx.fillText("v2", 4, y2 - 4);
        ctx.setLineDash([]);

        // Delta Panel Tooltip
        const windowDuration = this.timeDivValue * 10;
        const tVal1 = this.cursorT1 * windowDuration;
        const tVal2 = this.cursorT2 * windowDuration;
        const dt = Math.abs(tVal2 - tVal1);
        const dv = Math.abs(this.cursorV2 - this.cursorV1);
        const freqEst = dt > 0 ? 1 / dt : 0;

        ctx.fillStyle = "rgba(10, 15, 25, 0.9)";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.5)";
        ctx.lineWidth = 1;
        const txt = `Δt: ${(dt * 1000).toFixed(2)} ms | 1/Δt: ${freqEst.toFixed(1)} Hz | ΔV: ${dv.toFixed(2)} V`;
        ctx.font = "bold 9px var(--font-sans)";
        const tWidth = ctx.measureText(txt).width;
        ctx.beginPath();
        ctx.roundRect(width / 2 - tWidth / 2 - 8, 12, tWidth + 16, 18, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "hsl(174, 97%, 69%)";
        ctx.textAlign = "center";
        ctx.fillText(txt, width / 2, 24);
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
