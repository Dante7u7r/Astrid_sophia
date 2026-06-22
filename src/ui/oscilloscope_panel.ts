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
  private oscCh1Btn: HTMLButtonElement | null = null;
  private oscCh2Btn: HTMLButtonElement | null = null;

  // External references updated by main.ts
  public activeAnalysisMode: 'DC' | 'AC' | 'TRAN' | 'SENS' | 'PSS' | 'STB' = 'DC';
  public isSimulating = false;
  public isOscPaused = false;
  public oscTime = 0;
  public sweepTime = 0.0;
  public readonly transientDuration = 0.05;
  public transientResults: TimeStepResult[] = [];
  public acSweepResults: AcSweepResult | null = null;
  public liveVoltages: Record<string, number> = {};
  public ch1ProbeNode: string | null = "1";
  public ch2ProbeNode: string | null = "2";
  public onFrameUpdate?: (sweepTime: number) => void;

  private oscMouseX: number | null = null;
  private animationFrameId: number | null = null;

  constructor() {
    this.oscCanvas = document.querySelector("#osc-canvas");
    this.oscCh1Btn = document.querySelector("#osc-ch1-btn");
    this.oscCh2Btn = document.querySelector("#osc-ch2-btn");

    if (this.oscCanvas) {
      this.oscCtx = this.oscCanvas.getContext("2d");
      this.initEvents();
    }
  }

  private initEvents() {
    if (this.oscCanvas) {
      this.oscCanvas.addEventListener("mousemove", (e) => {
        const rect = this.oscCanvas!.getBoundingClientRect();
        this.oscMouseX = e.clientX - rect.left;
      });
      this.oscCanvas.addEventListener("mouseleave", () => {
        this.oscMouseX = null;
      });
    }
  }

  public draw() {
    if (!this.oscCanvas || !this.oscCtx) return;

    const width = this.oscCanvas.clientWidth;
    const height = this.oscCanvas.clientHeight;
    
    if (this.oscCanvas.width !== width || this.oscCanvas.height !== height) {
      this.oscCanvas.width = width;
      this.oscCanvas.height = height;
    }

    // Limpiar con fósforo oscuro (efecto de desvanecimiento gradual para persistencia analógica si es animado)
    if (this.isSimulating && this.activeAnalysisMode !== 'AC') {
      this.oscCtx.fillStyle = 'rgba(3, 5, 8, 0.16)';
      this.oscCtx.fillRect(0, 0, width, height);
    } else {
      this.oscCtx.fillStyle = '#030508';
      this.oscCtx.fillRect(0, 0, width, height);
    }

    // --- MODO AC SWEEP: DIAGRAMA DE BODE LOGARÍTMICO ---
    if (this.activeAnalysisMode === 'AC' && this.acSweepResults !== null && this.acSweepResults.frequencies.length > 0) {
      const ctx = this.oscCtx!;
      const freqs = this.acSweepResults.frequencies;
      const fMin = freqs[0];
      const fMax = freqs[freqs.length - 1];
      const logMin = Math.log10(fMin);
      const logMax = Math.log10(fMax);

      // Rejilla logarítmica (Décadas)
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
          
          // Escribir década de frecuencia
          ctx.fillStyle = 'rgba(102, 252, 241, 0.4)';
          ctx.font = '9px var(--font-sans)';
          ctx.textAlign = 'center';
          let label = dec >= 1000 ? (dec / 1000) + " kHz" : dec + " Hz";
          ctx.fillText(label, x, height - 4);
        }
      });

      // Subdivisiones logarítmicas tenues
      ctx.strokeStyle = 'rgba(102, 252, 241, 0.015)';
      for (let dec = 10; dec <= 10000; dec *= 10) {
        for (let mul = 2; mul <= 9; mul++) {
          const val = dec * mul;
          if (val >= fMin && val <= fMax) {
            const x = ((Math.log10(val) - logMin) / (logMax - logMin)) * width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height - 15);
            ctx.stroke();
          }
        }
      }

      // Líneas horizontales de referencia en dB
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      for (let i = 1; i < 5; i++) {
        const y = (height - 15) * (i / 5);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Dibujar Curva de Amplitud (dB)
      const drawBodeAmplitude = (nodeId: string, color: string, isCh1: boolean) => {
        const amps = this.acSweepResults!.nodeAmplitudes[nodeId];
        if (!amps || amps.length === 0) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = isCh1 ? 2.5 : 1.8;
        ctx.shadowColor = color;
        ctx.shadowBlur = isCh1 ? 6 : 3;
        ctx.beginPath();

        for (let i = 0; i < freqs.length; i++) {
          const x = ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * width;
          const db = amps[i];
          const y = (height - 15) * (1.0 - (db - (-80)) / (20 - (-80)));

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      // Dibujar Curva de Fase (Grados)
      const drawBodePhase = (nodeId: string, color: string) => {
        const phases = this.acSweepResults!.nodePhases[nodeId];
        if (!phases || phases.length === 0) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();

        for (let i = 0; i < freqs.length; i++) {
          const x = ((Math.log10(freqs[i]) - logMin) / (logMax - logMin)) * width;
          const deg = phases[i];
          const y = (height - 15) * (1.0 - (deg - (-180)) / (180 - (-180)));

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
      };

      const isCh1Active = this.oscCh1Btn && this.oscCh1Btn.classList.contains('active');
      const isCh2Active = this.oscCh2Btn && this.oscCh2Btn.classList.contains('active');

      if (isCh1Active && this.ch1ProbeNode !== null) {
        drawBodeAmplitude(this.ch1ProbeNode, '#66fcf1', true);
        drawBodePhase(this.ch1ProbeNode, 'rgba(102, 252, 241, 0.4)');
      }
      if (isCh2Active && this.ch2ProbeNode !== null) {
        drawBodeAmplitude(this.ch2ProbeNode, '#a855f7', false);
        drawBodePhase(this.ch2ProbeNode, 'rgba(168, 85, 247, 0.45)');
      }

      // Escribir marcas de ejes Y
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '8px var(--font-mono)';
      ctx.textAlign = 'left';
      ctx.fillText("+20 dB", 5, 12);
      ctx.fillText("-80 dB", 5, height - 20);

      ctx.textAlign = 'right';
      ctx.fillText("+180°", width - 5, 12);
      ctx.fillText("-180°", width - 5, height - 20);

      // CURSOR INTERACTIVO EN HOVER (BODE SWEEP INFO TOOLTIP)
      if (this.oscMouseX !== null && this.oscMouseX >= 0 && this.oscMouseX <= width) {
        const pct = this.oscMouseX / width;
        const logVal = logMin + pct * (logMax - logMin);
        const fVal = Math.pow(10, logVal);

        let closestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < freqs.length; i++) {
          const diff = Math.abs(freqs[i] - fVal);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        }

        const exactFreq = freqs[closestIdx];

        ctx.strokeStyle = 'rgba(102, 252, 241, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(this.oscMouseX, 0);
        ctx.lineTo(this.oscMouseX, height - 15);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(10, 15, 25, 0.9)';
        ctx.strokeStyle = 'rgba(102, 252, 241, 0.5)';
        ctx.lineWidth = 1;
        
        let tooltipText = `Frecuencia: ${exactFreq.toFixed(1)} Hz`;
        if (this.ch1ProbeNode !== null && isCh1Active) {
          const db1 = this.acSweepResults.nodeAmplitudes[this.ch1ProbeNode][closestIdx];
          const ph1 = this.acSweepResults.nodePhases[this.ch1ProbeNode][closestIdx];
          tooltipText += ` | Canal 1: ${db1.toFixed(1)} dB, ${ph1.toFixed(1)}°`;
        }
        if (this.ch2ProbeNode !== null && isCh2Active) {
          const db2 = this.acSweepResults.nodeAmplitudes[this.ch2ProbeNode][closestIdx];
          const ph2 = this.acSweepResults.nodePhases[this.ch2ProbeNode][closestIdx];
          tooltipText += ` | Canal 2: ${db2.toFixed(1)} dB, ${ph2.toFixed(1)}°`;
        }

        ctx.font = 'bold 9px var(--font-sans)';
        const tWidth = ctx.measureText(tooltipText).width;
        
        const rectX = Math.min(Math.max(this.oscMouseX - tWidth / 2 - 8, 4), width - tWidth - 16);
        ctx.beginPath();
        ctx.roundRect(rectX, 15, tWidth + 16, 18, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'hsl(174, 97%, 69%)';
        ctx.textAlign = 'left';
        ctx.fillText(tooltipText, rectX + 8, 27);
      }

    } else {
      // Rejilla de fósforo estándar (Modos TRAN o Senoidales genéricas)
      this.oscCtx.strokeStyle = 'rgba(102, 252, 241, 0.05)';
      this.oscCtx.lineWidth = 1;
      
      const gridSize = 30;
      for (let x = 0; x < width; x += gridSize) {
        this.oscCtx.beginPath();
        this.oscCtx.moveTo(x, 0);
        this.oscCtx.lineTo(x, height);
        this.oscCtx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        this.oscCtx.beginPath();
        this.oscCtx.moveTo(0, y);
        this.oscCtx.lineTo(width, y);
        this.oscCtx.stroke();
      }

      // Ejes centrales
      this.oscCtx.strokeStyle = 'rgba(102, 252, 241, 0.15)';
      this.oscCtx.lineWidth = 1.5;
      this.oscCtx.beginPath();
      this.oscCtx.moveTo(0, height / 2);
      this.oscCtx.lineTo(width, height / 2);
      this.oscCtx.stroke();

      this.oscCtx.beginPath();
      this.oscCtx.moveTo(width / 2, 0);
      this.oscCtx.lineTo(width / 2, height);
      this.oscCtx.stroke();

      const isCh1Active = this.oscCh1Btn && this.oscCh1Btn.classList.contains('active');
      const isCh2Active = this.oscCh2Btn && this.oscCh2Btn.classList.contains('active');

      // --- MODO TRANSIENT: GRAFICAR ONDAS FÍSICAS REALES SIMULADAS ---
      if ((this.activeAnalysisMode === 'TRAN' || this.activeAnalysisMode === 'PSS') && this.transientResults.length > 0) {
        if (this.isSimulating && !this.isOscPaused) {
          this.sweepTime += (this.transientDuration / 100);
          if (this.sweepTime > this.transientDuration) {
            this.sweepTime = 0.0;
          }
        }
        if (this.onFrameUpdate) {
          this.onFrameUpdate(this.sweepTime);
        }

        const scaleY = height * 0.08; 
        const centerY = height / 2;

        // CH 1 (Cian Eléctrico)
        if (isCh1Active && this.ch1ProbeNode !== null) {
          this.oscCtx.strokeStyle = '#66fcf1';
          this.oscCtx.lineWidth = 2.5;
          this.oscCtx.shadowColor = '#66fcf1';
          this.oscCtx.shadowBlur = 6;
          this.oscCtx.beginPath();

          let isFirst = true;
          for (const pt of this.transientResults) {
            if (pt.time > this.sweepTime) {
              break;
            }

            const x = (pt.time / this.transientDuration) * width;
            const v = pt.nodeVoltages[this.ch1ProbeNode] || 0.0;
            const y = centerY - v * scaleY;

            if (isFirst) {
              this.oscCtx.moveTo(x, y);
              isFirst = false;
            } else {
              this.oscCtx.lineTo(x, y);
            }
          }
          this.oscCtx.stroke();
          this.oscCtx.shadowBlur = 0;

          const activePt = this.transientResults.find(p => p.time >= this.sweepTime) || this.transientResults[this.transientResults.length - 1];
          if (activePt) {
            const x = (activePt.time / this.transientDuration) * width;
            const v = activePt.nodeVoltages[this.ch1ProbeNode] || 0.0;
            const y = centerY - v * scaleY;
            this.oscCtx.fillStyle = '#66fcf1';
            this.oscCtx.beginPath();
            this.oscCtx.arc(x, y, 4, 0, Math.PI * 2);
            this.oscCtx.fill();
          }
        }

        // CH 2 (Morado/Violeta)
        if (isCh2Active && this.ch2ProbeNode !== null) {
          this.oscCtx.strokeStyle = '#a855f7';
          this.oscCtx.lineWidth = 2.0;
          this.oscCtx.shadowColor = '#a855f7';
          this.oscCtx.shadowBlur = 4;
          this.oscCtx.beginPath();

          let isFirst = true;
          for (const pt of this.transientResults) {
            if (pt.time > this.sweepTime) {
              break;
            }

            const x = (pt.time / this.transientDuration) * width;
            const v = pt.nodeVoltages[this.ch2ProbeNode] || 0.0;
            const y = centerY - v * scaleY;

            if (isFirst) {
              this.oscCtx.moveTo(x, y);
              isFirst = false;
            } else {
              this.oscCtx.lineTo(x, y);
            }
          }
          this.oscCtx.stroke();
          this.oscCtx.shadowBlur = 0;

          const activePt = this.transientResults.find(p => p.time >= this.sweepTime) || this.transientResults[this.transientResults.length - 1];
          if (activePt) {
            const x = (activePt.time / this.transientDuration) * width;
            const v = activePt.nodeVoltages[this.ch2ProbeNode] || 0.0;
            const y = centerY - v * scaleY;
            this.oscCtx.fillStyle = '#a855f7';
            this.oscCtx.beginPath();
            this.oscCtx.arc(x, y, 3, 0, Math.PI * 2);
            this.oscCtx.fill();
          }
        }

      } else {
        // --- SEÑALES SENOIDALES SIMULADAS ---
        if (this.isSimulating && !this.isOscPaused) {
          this.oscTime += 0.05;
        }

        // CH 1 (Cian)
        if (isCh1Active) {
          this.oscCtx.strokeStyle = '#66fcf1';
          this.oscCtx.lineWidth = 2.5;
          this.oscCtx.shadowColor = '#66fcf1';
          this.oscCtx.shadowBlur = 6;
          this.oscCtx.beginPath();

          const node1Volt = this.liveVoltages['1'] || 0.0;
          const ampl = 15 + Math.min(Math.abs(node1Volt) * 12, height * 0.35);

          for (let x = 0; x < width; x++) {
            const angle = (x / width) * Math.PI * 4 + this.oscTime;
            const y = (height / 2) + Math.sin(angle) * ampl;
            
            if (x === 0) {
              this.oscCtx.moveTo(x, y);
            } else {
              this.oscCtx.lineTo(x, y);
            }
          }
          this.oscCtx.stroke();
          this.oscCtx.shadowBlur = 0;
        }

        // CH 2 (Morado)
        if (isCh2Active) {
          this.oscCtx.strokeStyle = '#a855f7';
          this.oscCtx.lineWidth = 2;
          this.oscCtx.shadowColor = '#a855f7';
          this.oscCtx.shadowBlur = 4;
          this.oscCtx.beginPath();

          const node2Volt = this.liveVoltages['2'] || 0.0;
          const ampl2 = 10 + Math.min(Math.abs(node2Volt) * 10, height * 0.25);

          for (let x = 0; x < width; x++) {
            const t = (x / width) * 8 + this.oscTime * 1.5;
            const wave = (t % 1) * 2 - 1; 
            const noise = (Math.sin(x * 0.25) * 0.08);
            const y = (height / 2) + (wave + noise) * ampl2;
            
            if (x === 0) {
              this.oscCtx.moveTo(x, y);
            } else {
              this.oscCtx.lineTo(x, y);
            }
          }
          this.oscCtx.stroke();
          this.oscCtx.shadowBlur = 0;
        }
      }
    }

    if (this.isSimulating) {
      this.animationFrameId = requestAnimationFrame(() => this.draw());
    }
  }

  public start() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.isSimulating = true;
    this.draw();
  }

  public stop() {
    this.isSimulating = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.draw();
  }
}
