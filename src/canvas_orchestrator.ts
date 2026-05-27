export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComponentInstance {
  id: string;
  type: 'resistor' | 'capacitor' | 'inductor' | 'diode' | 'vsource' | 'ground' | 'nmos' | 'opamp' | 'pmos' | 'npn' | 'pnp';
  value: number;
  x: number;
  y: number;
  rotation: number; // 0, 90, 180, 270 degrees
  selected?: boolean;
  waveType?: string;
  amplitude?: number;
  frequency?: number;
  offset?: number;
  dutyCycle?: number;
}

export interface PinInstance {
  componentId: string;
  pinIndex: number;
  x: number; // World X
  y: number; // World Y
}

export interface WireInstance {
  id: string;
  from: { componentId: string; pinIndex: number };
  to: { componentId: string; pinIndex: number };
  points: Point2D[]; // Path points for rendering
}

export class CanvasOrchestrator {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Viewport State
  public zoom: number = 1.0;
  public offsetX: number = 0;
  public offsetY: number = 0;

  // Constants
  public readonly minZoom: number = 0.3;
  public readonly maxZoom: number = 3.0;
  public readonly gridSize: number = 20;

  // Components & Wires State
  public components: ComponentInstance[] = [];
  public wires: WireInstance[] = [];

  // Interaction State
  public hoveredComponent: ComponentInstance | null = null;
  public hoveredPin: PinInstance | null = null;
  public hoveredWire: WireInstance | null = null;
  
  public selectedComponent: ComponentInstance | null = null; // Mantenido para compatibilidad e indicador principal
  public selectedComponents: ComponentInstance[] = [];
  public selectedWire: WireInstance | null = null;
  
  public activePinForWire: PinInstance | null = null;
  public tempWireEnd: Point2D | null = null;
  
  public isDragging: boolean = false;
  private dragStartOffset: Point2D = { x: 0, y: 0 };
  private dragStartOffsets: Record<string, Point2D> = {};

  // Caja de Selección CAD
  public selectionStart: Point2D | null = null;
  public selectionEnd: Point2D | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not acquire 2D rendering context");
    this.ctx = context;
  }

  // --- COORDINATE TRANSLATIONS ---

  public screenToWorld(screenX: number, screenY: number): Point2D {
    return {
      x: (screenX - this.offsetX) / this.zoom,
      y: (screenY - this.offsetY) / this.zoom,
    };
  }

  public worldToScreen(worldX: number, worldY: number): Point2D {
    return {
      x: worldX * this.zoom + this.offsetX,
      y: worldY * this.zoom + this.offsetY,
    };
  }

  public snapToGrid(coord: number): number {
    return Math.round(coord / this.gridSize) * this.gridSize;
  }

  public getComponentPins(comp: ComponentInstance): PinInstance[] {
    const pins: PinInstance[] = [];
    const rad = (comp.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const getRotatedOffset = (lx: number, ly: number): Point2D => {
      return {
        x: comp.x + (lx * cos - ly * sin),
        y: comp.y + (lx * sin + ly * cos),
      };
    };

    if (comp.type === 'ground') {
      // Ground has 1 pin at the top center of its drawing
      const pt = getRotatedOffset(0, -20);
      pins.push({ componentId: comp.id, pinIndex: 0, x: pt.x, y: pt.y });
    } else if (comp.type === 'nmos' || comp.type === 'pmos' || comp.type === 'npn' || comp.type === 'pnp') {
      // NMOS, PMOS, and BJT (NPN/PNP) all have 3 pins
      const ptGate = getRotatedOffset(-40, 0);
      const ptDrain = getRotatedOffset(20, -40);
      const ptSource = getRotatedOffset(20, 40);
      pins.push({ componentId: comp.id, pinIndex: 0, x: ptGate.x, y: ptGate.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: ptDrain.x, y: ptDrain.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: ptSource.x, y: ptSource.y });
    } else if (comp.type === 'opamp') {
      // Op-Amp has 5 pins: In+ (-40, -15), In- (-40, 15), V+ (0, -40), V- (0, 40), Out (40, 0)
      const ptInPos = getRotatedOffset(-40, -15);
      const ptInNeg = getRotatedOffset(-40, 15);
      const ptVplus = getRotatedOffset(0, -40);
      const ptVminus = getRotatedOffset(0, 40);
      const ptOut = getRotatedOffset(40, 0);
      pins.push({ componentId: comp.id, pinIndex: 0, x: ptInPos.x, y: ptInPos.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: ptInNeg.x, y: ptInNeg.y });
      pins.push({ componentId: comp.id, pinIndex: 2, x: ptVplus.x, y: ptVplus.y });
      pins.push({ componentId: comp.id, pinIndex: 3, x: ptVminus.x, y: ptVminus.y });
      pins.push({ componentId: comp.id, pinIndex: 4, x: ptOut.x, y: ptOut.y });
    } else {
      // Other 2-pin components
      const pt1 = getRotatedOffset(-40, 0);
      const pt2 = getRotatedOffset(40, 0);
      pins.push({ componentId: comp.id, pinIndex: 0, x: pt1.x, y: pt1.y });
      pins.push({ componentId: comp.id, pinIndex: 1, x: pt2.x, y: pt2.y });
    }

    return pins;
  }

  public isVisible(box: BoundingBox): boolean {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.canvas.width, this.canvas.height);

    return (
      box.x + box.width >= topLeft.x &&
      box.x <= bottomRight.x &&
      box.y + box.height >= topLeft.y &&
      box.y <= bottomRight.y
    );
  }

  // --- CAMERA OPERATIONS ---

  public zoomAt(zoomFactor: number, screenTargetX: number, screenTargetY: number): void {
    const worldTarget = this.screenToWorld(screenTargetX, screenTargetY);
    const nextZoom = Math.min(Math.max(this.zoom * zoomFactor, this.minZoom), this.maxZoom);
    if (nextZoom === this.zoom) return;

    this.zoom = nextZoom;
    this.offsetX = screenTargetX - worldTarget.x * this.zoom;
    this.offsetY = screenTargetY - worldTarget.y * this.zoom;
  }

  public pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  // --- DRAWING / RENDERING ---

  public render(_voltageMap: Record<string, number> = {}, probes: { ch1?: Point2D; ch2?: Point2D } = {}): void {
    const { width, height } = this.canvas;
    
    // Sync actual drawing bounds
    if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
      this.canvas.width = this.canvas.clientWidth;
      this.canvas.height = this.canvas.clientHeight;
    }

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.save();

    // 1. Draw Background Grid
    this.drawWorldGrid();

    // 2. Apply Camera Transformations
    this.ctx.setTransform(this.zoom, 0, 0, this.zoom, this.offsetX, this.offsetY);

    // 3. Draw Wires
    this.drawWires(_voltageMap);

    // 4. Draw Components
    for (const comp of this.components) {
      this.drawComponent(comp);
    }

    // 5. Draw Temporary Drawing Wire
    if (this.activePinForWire && this.tempWireEnd) {
      this.ctx.strokeStyle = "rgba(102, 252, 241, 0.6)";
      this.ctx.lineWidth = 2.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      
      const pinPt = this.activePinForWire;
      this.ctx.moveTo(pinPt.x, pinPt.y);

      // Orthogonal path for preview
      const midX = pinPt.x + (this.tempWireEnd.x - pinPt.x) / 2;
      this.ctx.lineTo(midX, pinPt.y);
      this.ctx.lineTo(midX, this.tempWireEnd.y);
      this.ctx.lineTo(this.tempWireEnd.x, this.tempWireEnd.y);
      
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // 6. Draw Highlights & Pins
    this.drawPins(_voltageMap);

    // 7. Draw Oscilloscope Probe Badges
    if (probes.ch1) {
      this.ctx.fillStyle = "hsl(174, 97%, 69%)";
      this.ctx.shadowColor = "hsl(174, 97%, 69%)";
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(probes.ch1.x, probes.ch1.y - 14, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      
      this.ctx.fillStyle = "#030508";
      this.ctx.font = "bold 9px var(--font-sans)";
      this.ctx.textAlign = "center";
      this.ctx.fillText("①", probes.ch1.x, probes.ch1.y - 11);
    }
    if (probes.ch2) {
      this.ctx.fillStyle = "hsl(270, 89%, 65%)";
      this.ctx.shadowColor = "hsl(270, 89%, 65%)";
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      this.ctx.arc(probes.ch2.x, probes.ch2.y - 14, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      
      this.ctx.fillStyle = "#030508";
      this.ctx.font = "bold 9px var(--font-sans)";
      this.ctx.textAlign = "center";
      this.ctx.fillText("②", probes.ch2.x, probes.ch2.y - 11);
    }

    // 8. Draw CAD Selection Drag Box
    if (this.selectionStart && this.selectionEnd) {
      this.ctx.save();
      this.ctx.fillStyle = "rgba(102, 252, 241, 0.05)";
      this.ctx.strokeStyle = "rgba(102, 252, 241, 0.4)";
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([4, 3]);
      
      const x = Math.min(this.selectionStart.x, this.selectionEnd.x);
      const y = Math.min(this.selectionStart.y, this.selectionEnd.y);
      const w = Math.abs(this.selectionStart.x - this.selectionEnd.x);
      const h = Math.abs(this.selectionStart.y - this.selectionEnd.y);
      
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, w, h, 4);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private drawWorldGrid(): void {
    const { width, height } = this.canvas;
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(width, height);

    const startX = Math.floor(topLeft.x / this.gridSize) * this.gridSize;
    const endX = Math.ceil(bottomRight.x / this.gridSize) * this.gridSize;
    const startY = Math.floor(topLeft.y / this.gridSize) * this.gridSize;
    const endY = Math.ceil(bottomRight.y / this.gridSize) * this.gridSize;

    this.ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    for (let x = startX; x <= endX; x += this.gridSize) {
      for (let y = startY; y <= endY; y += this.gridSize) {
        const screenPos = this.worldToScreen(x, y);
        this.ctx.beginPath();
        this.ctx.arc(screenPos.x, screenPos.y, 1.2 * this.zoom, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  private drawComponent(comp: ComponentInstance): void {
    this.ctx.save();
    this.ctx.translate(comp.x, comp.y);
    this.ctx.rotate((comp.rotation * Math.PI) / 180);

    // Color systems
    const isSelected = comp.selected || 
                       this.selectedComponent?.id === comp.id ||
                       this.selectedComponents.some(c => c.id === comp.id);
    const isHovered = this.hoveredComponent?.id === comp.id;

    let color = "hsl(174, 97%, 69%)"; // Default electric cyan
    if (isSelected) {
      color = "hsl(270, 89%, 65%)"; // Selected purple
    } else if (isHovered) {
      color = "hsl(210, 100%, 56%)"; // Hovered accent blue
    }

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = isSelected ? 3 : 2;
    this.ctx.fillStyle = "rgba(8, 12, 22, 0.75)";

    // Add subtle glow if selected or hovered
    if (isSelected || isHovered) {
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = isSelected ? 8 : 4;
    }

    // 1. Draw Leads
    if (comp.type !== 'ground' && comp.type !== 'nmos' && comp.type !== 'pmos' && comp.type !== 'npn' && comp.type !== 'pnp' && comp.type !== 'opamp') {
      this.ctx.beginPath();
      this.ctx.moveTo(-40, 0);
      this.ctx.lineTo(-20, 0);
      this.ctx.moveTo(20, 0);
      this.ctx.lineTo(40, 0);
      this.ctx.stroke();
    } else if (comp.type === 'ground') {
      this.ctx.beginPath();
      this.ctx.moveTo(0, -20);
      this.ctx.lineTo(0, 0);
      this.ctx.stroke();
    }

    // 2. Draw Core Symbol Body
    this.ctx.beginPath();
    switch (comp.type) {
      case 'resistor':
        // Zig-zag symbol
        this.ctx.moveTo(-20, 0);
        this.ctx.lineTo(-15, -8);
        this.ctx.lineTo(-10, 8);
        this.ctx.lineTo(-5, -8);
        this.ctx.lineTo(0, 8);
        this.ctx.lineTo(5, -8);
        this.ctx.lineTo(10, 8);
        this.ctx.lineTo(15, -8);
        this.ctx.lineTo(20, 0);
        this.ctx.stroke();
        break;

      case 'capacitor':
        // Parallel plates
        this.ctx.moveTo(-6, -14);
        this.ctx.lineTo(-6, 14);
        this.ctx.moveTo(6, -14);
        this.ctx.lineTo(6, 14);
        this.ctx.stroke();
        break;

      case 'inductor':
        // Curved coils
        this.ctx.moveTo(-20, 0);
        for (let i = 0; i < 4; i++) {
          const startX = -20 + i * 10;
          this.ctx.arc(startX + 5, 0, 5, Math.PI, 0, false);
        }
        this.ctx.stroke();
        break;

      case 'diode':
        // Triangle + bar
        this.ctx.moveTo(-12, -10);
        this.ctx.lineTo(-12, 10);
        this.ctx.lineTo(8, 0);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(8, -10);
        this.ctx.lineTo(8, 10);
        this.ctx.stroke();
        break;

      case 'nmos':
        // MOSFET Canal N
        // Canal vertical central
        this.ctx.moveTo(10, -20);
        this.ctx.lineTo(10, 20);
        
        // Placa a la izquierda (Puerta / Gate)
        this.ctx.moveTo(-10, -15);
        this.ctx.lineTo(-10, 15);
        
        // Terminal de la Puerta (Gate)
        this.ctx.moveTo(-10, 0);
        this.ctx.lineTo(-40, 0);
        
        // Terminal del Drenaje (Drain)
        this.ctx.moveTo(10, -15);
        this.ctx.lineTo(20, -15);
        this.ctx.lineTo(20, -40);
        
        // Terminal de la Fuente (Source)
        this.ctx.moveTo(10, 15);
        this.ctx.lineTo(20, 15);
        this.ctx.lineTo(20, 40);
        
        // Flecha característica apuntando al sustrato (canal N)
        this.ctx.moveTo(10, 15);
        this.ctx.lineTo(15, 11);
        this.ctx.moveTo(10, 15);
        this.ctx.lineTo(15, 19);
        
        this.ctx.stroke();
        break;

      case 'pmos':
        // MOSFET Canal P
        // Canal vertical central
        this.ctx.moveTo(10, -20);
        this.ctx.lineTo(10, 20);
        
        // Burbuja de inversión en puerta
        this.ctx.moveTo(-6, 0);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(-11, 0, 4, 0, Math.PI * 2);
        this.ctx.stroke();
        
        // Placa a la izquierda (Puerta / Gate)
        this.ctx.beginPath();
        this.ctx.moveTo(-6, -15);
        this.ctx.lineTo(-6, 15);
        
        // Terminal de la Puerta (Gate)
        this.ctx.moveTo(-15, 0);
        this.ctx.lineTo(-40, 0);
        
        // Terminal del Drenaje (Drain)
        this.ctx.moveTo(10, -15);
        this.ctx.lineTo(20, -15);
        this.ctx.lineTo(20, -40);
        
        // Terminal de la Fuente (Source)
        this.ctx.moveTo(10, 15);
        this.ctx.lineTo(20, 15);
        this.ctx.lineTo(20, 40);
        
        // Flecha en la fuente apuntando hacia el canal (invertida respecto a NMOS)
        this.ctx.moveTo(15, 15);
        this.ctx.lineTo(10, 11);
        this.ctx.moveTo(15, 15);
        this.ctx.lineTo(10, 19);
        
        this.ctx.stroke();
        break;

      case 'npn':
        // BJT NPN
        // Barra vertical de la Base
        this.ctx.moveTo(-10, -20);
        this.ctx.lineTo(-10, 20);
        
        // Terminal de la Base (Base)
        this.ctx.moveTo(-10, 0);
        this.ctx.lineTo(-40, 0);
        
        // Colector (Collector)
        this.ctx.moveTo(-10, -10);
        this.ctx.lineTo(20, -25);
        this.ctx.lineTo(20, -40);
        
        // Emisor (Emitter)
        this.ctx.moveTo(-10, 10);
        this.ctx.lineTo(20, 25);
        this.ctx.lineTo(20, 40);
        
        // Flecha en el emisor apuntando hacia AFUERA
        this.ctx.moveTo(20, 25);
        this.ctx.lineTo(12, 23);
        this.ctx.moveTo(20, 25);
        this.ctx.lineTo(17, 17);
        
        this.ctx.stroke();
        break;

      case 'pnp':
        // BJT PNP
        // Barra vertical de la Base
        this.ctx.moveTo(-10, -20);
        this.ctx.lineTo(-10, 20);
        
        // Terminal de la Base (Base)
        this.ctx.moveTo(-10, 0);
        this.ctx.lineTo(-40, 0);
        
        // Colector (Collector)
        this.ctx.moveTo(-10, -10);
        this.ctx.lineTo(20, -25);
        this.ctx.lineTo(20, -40);
        
        // Emisor (Emitter)
        this.ctx.moveTo(-10, 10);
        this.ctx.lineTo(20, 25);
        this.ctx.lineTo(20, 40);
        
        // Flecha en el emisor apuntando hacia ADENTRO
        this.ctx.moveTo(-10, 10);
        this.ctx.lineTo(-2, 12);
        this.ctx.moveTo(-10, 10);
        this.ctx.lineTo(-5, 18);
        
        this.ctx.stroke();
        break;

      case 'vsource':
        // Circle with + and - signs
        this.ctx.arc(0, 0, 18, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        // Plus and minus
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1.5;
        // Plus (+) near positive side (-10)
        this.ctx.beginPath();
        this.ctx.moveTo(-11, 0);
        this.ctx.lineTo(-5, 0);
        this.ctx.moveTo(-8, -3);
        this.ctx.lineTo(-8, 3);
        // Minus (-) near negative side (10)
        this.ctx.moveTo(5, 0);
        this.ctx.lineTo(11, 0);
        this.ctx.stroke();
        break;

      case 'ground':
        // Horizontal parallel lines of decreasing size
        this.ctx.moveTo(-14, 0);
        this.ctx.lineTo(14, 0);
        this.ctx.moveTo(-9, 5);
        this.ctx.lineTo(9, 5);
        this.ctx.moveTo(-4, 10);
        this.ctx.lineTo(4, 10);
        this.ctx.stroke();
        break;

      case 'opamp':
        // Triángulo de Op-Amp de 5 pines
        // 1. Cuerpo principal (triángulo apuntando a la derecha)
        this.ctx.beginPath();
        this.ctx.moveTo(-30, -30);
        this.ctx.lineTo(-30, 30);
        this.ctx.lineTo(30, 0);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        // 2. Terminales de Pines Físicos
        this.ctx.beginPath();
        // Entrada No Inversora (In+) en (-40, -15)
        this.ctx.moveTo(-30, -15);
        this.ctx.lineTo(-40, -15);
        
        // Entrada Inversora (In-) en (-40, 15)
        this.ctx.moveTo(-30, 15);
        this.ctx.lineTo(-40, 15);

        // Alimentación V+ en (0, -40)
        this.ctx.moveTo(0, -15);
        this.ctx.lineTo(0, -40);

        // Alimentación V- en (0, 40)
        this.ctx.moveTo(0, 15);
        this.ctx.lineTo(0, 40);

        // Salida Out en (40, 0)
        this.ctx.moveTo(30, 0);
        this.ctx.lineTo(40, 0);
        
        // 3. Signos + y - interiores
        // Signo + en Entrada No Inversora
        this.ctx.moveTo(-24, -15);
        this.ctx.lineTo(-16, -15);
        this.ctx.moveTo(-20, -19);
        this.ctx.lineTo(-20, -11);

        // Signo - en Entrada Inversora
        this.ctx.moveTo(-24, 15);
        this.ctx.lineTo(-16, 15);

        this.ctx.stroke();
        break;
    }

    // 3. Draw text value and label
    this.ctx.shadowBlur = 0;
    this.ctx.rotate(-(comp.rotation * Math.PI) / 180); // Un-rotate text so it stays horizontal

    this.ctx.fillStyle = isSelected ? "hsl(270, 89%, 80%)" : "hsl(210, 17%, 85%)";
    this.ctx.font = "bold 11px var(--font-sans)";
    this.ctx.textAlign = "center";
    this.ctx.fillText(comp.id, 0, comp.type === 'ground' ? 24 : -24);

    if (comp.type !== 'ground') {
      this.ctx.fillStyle = "var(--text-muted)";
      this.ctx.font = "9px var(--font-mono)";
      let formattedVal = comp.value.toString();
      if (comp.type === 'resistor') {
        formattedVal = comp.value >= 1000 ? (comp.value / 1000) + " kΩ" : comp.value + " Ω";
      } else if (comp.type === 'capacitor') {
        formattedVal = comp.value < 1e-6 ? (comp.value * 1e9) + " nF" : (comp.value * 1e6) + " µF";
      } else if (comp.type === 'inductor') {
        formattedVal = comp.value < 1e-3 ? (comp.value * 1e6) + " µH" : (comp.value * 1e3) + " mH";
      } else if (comp.type === 'vsource') {
        formattedVal = comp.value + " V";
      }
      this.ctx.fillText(formattedVal, 0, 32);
    }

    this.ctx.restore();
  }

  private drawWires(_voltageMap: Record<string, number> = {}): void {
    this.ctx.save();
    
    for (const wire of this.wires) {
      // Find endpoints
      const fromComp = this.components.find(c => c.id === wire.from.componentId);
      const toComp = this.components.find(c => c.id === wire.to.componentId);
      
      if (!fromComp || !toComp) continue;

      const fromPins = this.getComponentPins(fromComp);
      const toPins = this.getComponentPins(toComp);
      const startPt = fromPins.find(p => p.pinIndex === wire.from.pinIndex);
      const endPt = toPins.find(p => p.pinIndex === wire.to.pinIndex);

      if (!startPt || !endPt) continue;

      // Calcular puntos del camino ortogonal
      const points: Point2D[] = [];
      points.push({ x: startPt.x, y: startPt.y });

      const dx = Math.abs(endPt.x - startPt.x);
      const dy = Math.abs(endPt.y - startPt.y);

      if (dx < 0.1) {
        // Línea vertical pura
        points.push({ x: endPt.x, y: endPt.y });
      } else if (dy < 0.1) {
        // Línea horizontal pura
        points.push({ x: endPt.x, y: endPt.y });
      } else {
        // Determinar orientación dominante para decidir la salida ortogonal
        // Componentes horizontales (rotación 0 o 180) usualmente conectan en X.
        // Si la distancia horizontal es mayor, trazamos X -> Y -> X. De lo contrario Y -> X -> Y.
        if (dx >= dy) {
          const midX = startPt.x + (endPt.x - startPt.x) / 2;
          points.push({ x: midX, y: startPt.y });
          points.push({ x: midX, y: endPt.y });
        } else {
          const midY = startPt.y + (endPt.y - startPt.y) / 2;
          points.push({ x: startPt.x, y: midY });
          points.push({ x: endPt.x, y: midY });
        }
        points.push({ x: endPt.x, y: endPt.y });
      }

      // Dibujar camino ortogonal con esquinas redondeadas
      this.ctx.beginPath();
      this.ctx.moveTo(points[0].x, points[0].y);
      
      const cornerRadius = 8;
      if (points.length > 2) {
        for (let i = 1; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          this.ctx.arcTo(p1.x, p1.y, p2.x, p2.y, cornerRadius);
        }
      }
      this.ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

      // Estilo interactivo del cable
      const isSelected = this.selectedWire?.id === wire.id;
      const isHovered = this.hoveredWire?.id === wire.id;

      if (isSelected) {
        this.ctx.strokeStyle = "hsl(270, 89%, 65%)"; // Selected violet neón
        this.ctx.lineWidth = 3;
        this.ctx.shadowColor = "hsl(270, 89%, 65%)";
        this.ctx.shadowBlur = 8;
      } else if (isHovered) {
        this.ctx.strokeStyle = "hsl(210, 100%, 56%)"; // Hovered azul neón
        this.ctx.lineWidth = 2.5;
        this.ctx.shadowColor = "hsl(210, 100%, 56%)";
        this.ctx.shadowBlur = 6;
      } else {
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.45)"; // Cable estándar semitransparente
        this.ctx.lineWidth = 2;
        this.ctx.shadowBlur = 0;
      }

      this.ctx.stroke();
      this.ctx.shadowBlur = 0; // Reset shadow

      // Guardar los puntos calculados en la instancia del cable para colisiones posteriores
      wire.points = points;

      // Highlight conexiones/pins
      this.ctx.fillStyle = isSelected 
        ? "hsl(270, 89%, 65%)" 
        : isHovered 
          ? "hsl(210, 100%, 56%)" 
          : "rgba(102, 252, 241, 0.3)";
      this.ctx.beginPath();
      this.ctx.arc(startPt.x, startPt.y, 4, 0, Math.PI * 2);
      this.ctx.arc(endPt.x, endPt.y, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private drawPins(voltageMap: Record<string, number> = {}): void {
    this.ctx.save();

    for (const comp of this.components) {
      const pins = this.getComponentPins(comp);
      for (const pin of pins) {
        const isHovered = this.hoveredPin && 
                          this.hoveredPin.componentId === pin.componentId && 
                          this.hoveredPin.pinIndex === pin.pinIndex;
        const isActive = this.activePinForWire && 
                         this.activePinForWire.componentId === pin.componentId && 
                         this.activePinForWire.pinIndex === pin.pinIndex;

        if (isHovered || isActive) {
          this.ctx.fillStyle = "hsl(174, 97%, 69%)";
          this.ctx.shadowColor = "hsl(174, 97%, 69%)";
          this.ctx.shadowBlur = 6;
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 6, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.shadowBlur = 0;

          // Draw tooltip with voltage
          const pinKey = `${pin.componentId}:${pin.pinIndex}`;
          if (isHovered && voltageMap[pinKey] !== undefined) {
            const volt = voltageMap[pinKey];
            this.ctx.fillStyle = "rgba(8, 12, 22, 0.95)";
            this.ctx.strokeStyle = "rgba(102, 252, 241, 0.4)";
            this.ctx.lineWidth = 1;
            
            const txt = `${volt.toFixed(4)} V`;
            this.ctx.font = "bold 9px var(--font-mono)";
            const txtWidth = this.ctx.measureText(txt).width;
            
            // Draw small rounded rect
            this.ctx.beginPath();
            this.ctx.roundRect(pin.x - txtWidth / 2 - 6, pin.y - 25, txtWidth + 12, 16, 4);
            this.ctx.fill();
            this.ctx.stroke();
            
            // Draw text
            this.ctx.fillStyle = "hsl(174, 97%, 69%)";
            this.ctx.textAlign = "center";
            this.ctx.fillText(txt, pin.x, pin.y - 14);
          }
        } else {
          this.ctx.fillStyle = "rgba(102, 252, 241, 0.5)";
          this.ctx.beginPath();
          this.ctx.arc(pin.x, pin.y, 3, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    this.ctx.restore();
  }

  // --- ACTIONS & OPERATIONS ---

  public addComponent(type: ComponentInstance['type'], x: number, y: number, value: number): ComponentInstance {
    // Generate incremental ID
    const count = this.components.filter(c => c.type === type).length + 1;
    let prefix = "R";
    switch (type) {
      case 'capacitor': prefix = "C"; break;
      case 'inductor': prefix = "L"; break;
      case 'diode': prefix = "D"; break;
      case 'nmos': prefix = "M"; break;
      case 'pmos': prefix = "M"; break;
      case 'npn': prefix = "Q"; break;
      case 'pnp': prefix = "Q"; break;
      case 'vsource': prefix = "V"; break;
      case 'ground': prefix = "GND"; break;
    }
    const id = prefix === "GND" ? `GND${count}` : `${prefix}${count}`;

    const newComp: ComponentInstance = {
      id,
      type,
      value,
      x: this.snapToGrid(x),
      y: this.snapToGrid(y),
      rotation: 0,
    };

    this.components.push(newComp);
    return newComp;
  }

  public removeComponent(id: string): void {
    this.components = this.components.filter(c => c.id !== id);
    // Also remove any wires attached to this component
    this.wires = this.wires.filter(w => w.from.componentId !== id && w.to.componentId !== id);
    this.selectedComponents = this.selectedComponents.filter(c => c.id !== id);
  }

  public checkHover(worldX: number, worldY: number): void {
    this.hoveredComponent = null;
    this.hoveredPin = null;
    this.hoveredWire = null;

    // 1. Check pin hover first (takes priority)
    for (const comp of this.components) {
      const pins = this.getComponentPins(comp);
      for (const pin of pins) {
        const dx = worldX - pin.x;
        const dy = worldY - pin.y;
        if (dx * dx + dy * dy < 64) { // 8px radius check
          this.hoveredPin = pin;
          return;
        }
      }
    }

    // 2. Check component bounds hover
    for (const comp of this.components) {
      const size = 30; // standard hover bound
      if (
        worldX >= comp.x - size &&
        worldX <= comp.x + size &&
        worldY >= comp.y - size &&
        worldY <= comp.y + size
      ) {
        this.hoveredComponent = comp;
        return;
      }
    }

    // 3. Check wire proximity hover
    for (const wire of this.wires) {
      if (!wire.points || wire.points.length < 2) continue;
      for (let i = 0; i < wire.points.length - 1; i++) {
        const p1 = wire.points[i];
        const p2 = wire.points[i + 1];
        
        let dist = Infinity;
        if (Math.abs(p1.y - p2.y) < 0.1) { // Segmento horizontal
          const minX = Math.min(p1.x, p2.x);
          const maxX = Math.max(p1.x, p2.x);
          if (worldX >= minX - 4 && worldX <= maxX + 4) {
            dist = Math.abs(worldY - p1.y);
          }
        } else if (Math.abs(p1.x - p2.x) < 0.1) { // Segmento vertical
          const minY = Math.min(p1.y, p2.y);
          const maxY = Math.max(p1.y, p2.y);
          if (worldY >= minY - 4 && worldY <= maxY + 4) {
            dist = Math.abs(worldX - p1.x);
          }
        }
        
        if (dist < 6) { // Tolerancia de proximidad al cable de 6px
          this.hoveredWire = wire;
          return;
        }
      }
    }
  }

  public selectComponentAt(worldX: number, worldY: number, isShift: boolean = false): ComponentInstance | null {
    let hitComp: ComponentInstance | null = null;
    for (const comp of this.components) {
      const size = 35;
      if (
        worldX >= comp.x - size &&
        worldX <= comp.x + size &&
        worldY >= comp.y - size &&
        worldY <= comp.y + size
      ) {
        hitComp = comp;
        break;
      }
    }

    if (hitComp) {
      this.selectedWire = null; // Quitar selección de cable
      if (isShift) {
        // Modo aditivo
        const idx = this.selectedComponents.findIndex(c => c.id === hitComp!.id);
        if (idx >= 0) {
          this.selectedComponents.splice(idx, 1);
        } else {
          this.selectedComponents.push(hitComp);
        }
        this.selectedComponent = this.selectedComponents.length > 0 
          ? this.selectedComponents[this.selectedComponents.length - 1] 
          : null;
      } else {
        // Clic normal
        // Si ya pertenece al lote actual seleccionado, no vaciar el lote (para permitir arrastrar todo el grupo)
        if (!this.selectedComponents.some(c => c.id === hitComp!.id)) {
          this.selectedComponents = [hitComp];
        }
        this.selectedComponent = hitComp;
      }
      return hitComp;
    }

    // Si no golpeó ningún componente y no hay Shift, limpiar selección
    if (!isShift) {
      this.selectedComponent = null;
      this.selectedComponents = [];
      
      // Intentar seleccionar cable
      if (this.hoveredWire) {
        this.selectedWire = this.hoveredWire;
      } else {
        this.selectedWire = null;
      }
    }
    return null;
  }

  public completeBoxSelection(): void {
    if (!this.selectionStart || !this.selectionEnd) return;
    
    const x = Math.min(this.selectionStart.x, this.selectionEnd.x);
    const y = Math.min(this.selectionStart.y, this.selectionEnd.y);
    const w = Math.abs(this.selectionStart.x - this.selectionEnd.x);
    const h = Math.abs(this.selectionStart.y - this.selectionEnd.y);
    
    // Umbral mínimo para evitar clicks en el vacío
    if (w < 6 && h < 6) {
      this.selectedComponents = [];
      this.selectedComponent = null;
      this.selectedWire = null;
      this.selectionStart = null;
      this.selectionEnd = null;
      return;
    }
    
    this.selectedComponents = [];
    this.selectedWire = null;
    
    for (const comp of this.components) {
      // Verificar si el centro del componente está dentro de la ventana de selección
      if (
        comp.x >= x - 15 &&
        comp.x <= x + w + 15 &&
        comp.y >= y - 15 &&
        comp.y <= y + h + 15
      ) {
        this.selectedComponents.push(comp);
      }
    }
    
    if (this.selectedComponents.length > 0) {
      this.selectedComponent = this.selectedComponents[this.selectedComponents.length - 1];
    } else {
      this.selectedComponent = null;
    }
    
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  public startDraggingSelected(worldX: number, worldY: number): void {
    this.isDragging = true;
    this.dragStartOffsets = {};
    
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        this.dragStartOffsets[comp.id] = {
          x: worldX - comp.x,
          y: worldY - comp.y
        };
      }
    } else if (this.selectedComponent) {
      this.dragStartOffset = {
        x: worldX - this.selectedComponent.x,
        y: worldY - this.selectedComponent.y
      };
    }
  }

  public handleDragging(worldX: number, worldY: number): void {
    if (!this.isDragging) return;

    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        const offset = this.dragStartOffsets[comp.id];
        if (offset) {
          comp.x = this.snapToGrid(worldX - offset.x);
          comp.y = this.snapToGrid(worldY - offset.y);
        }
      }
    } else if (this.selectedComponent) {
      this.selectedComponent.x = this.snapToGrid(worldX - this.dragStartOffset.x);
      this.selectedComponent.y = this.snapToGrid(worldY - this.dragStartOffset.y);
    }
    
    this.syncWireConnections();
  }

  public stopDragging(): void {
    this.isDragging = false;
  }

  public syncWireConnections(): void {
    // Las conexiones físicas de las pistas se sincronizan dinámicamente en drawWires()
  }

  public connectPins(from: PinInstance, to: PinInstance): void {
    if (from.componentId === to.componentId) return;

    const exists = this.wires.some(
      w => 
        (w.from.componentId === from.componentId && w.from.pinIndex === from.pinIndex &&
         w.to.componentId === to.componentId && w.to.pinIndex === to.pinIndex) ||
        (w.from.componentId === to.componentId && w.from.pinIndex === to.pinIndex &&
         w.to.componentId === from.componentId && w.to.pinIndex === from.pinIndex)
    );

    if (exists) return;

    const id = `wire_${from.componentId}_p${from.pinIndex}_to_${to.componentId}_p${to.pinIndex}`;
    this.wires.push({
      id,
      from: { componentId: from.componentId, pinIndex: from.pinIndex },
      to: { componentId: to.componentId, pinIndex: to.pinIndex },
      points: []
    });
  }

  public rotateSelectedComponent(): void {
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        comp.rotation = (comp.rotation + 90) % 360;
      }
    } else if (this.selectedComponent) {
      this.selectedComponent.rotation = (this.selectedComponent.rotation + 90) % 360;
    }
  }

  public removeSelected(): void {
    // 1. Borrar cable seleccionado individual
    if (this.selectedWire) {
      this.wires = this.wires.filter(w => w.id !== this.selectedWire!.id);
      this.selectedWire = null;
      return;
    }

    // 2. Borrar componentes seleccionados en lote
    if (this.selectedComponents.length > 0) {
      for (const comp of this.selectedComponents) {
        this.removeComponent(comp.id);
      }
      this.selectedComponents = [];
      this.selectedComponent = null;
    } else if (this.selectedComponent) {
      this.removeComponent(this.selectedComponent.id);
      this.selectedComponent = null;
    }
  }
}
