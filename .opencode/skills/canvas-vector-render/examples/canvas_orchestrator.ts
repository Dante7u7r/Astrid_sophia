// canvas_orchestrator.ts — Reference Implementation v2.0
// Skill: canvas-vector-render
// Covers: viewport affine transform, zoom-to-pointer, frustum culling,
//         draw-call batching, grid raster, hit-testing, HiDPI, inertial pan.

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface Point2D { x: number; y: number; }
export interface AABB    { x: number; y: number; width: number; height: number; }

export interface WireSegment {
    id:   string;
    x1:   number; y1: number;
    x2:   number; y2: number;
    netId: string;
}

export interface SchematicComponent {
    id:      string;
    bounds:  AABB;          // World-space AABB
    zIndex:  number;
    draw:    (ctx: CanvasRenderingContext2D) => void;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const GRID_SIZE     = 20;    // World-space grid pitch (px)
const MIN_ZOOM      = 0.15;
const MAX_ZOOM      = 5.0;
const PAN_LAMBDA    = 8;     // Inertial decay coefficient (s⁻¹)
const PAN_THRESHOLD = 0.5;   // Stop animation below this velocity (px/s)
const HIT_RADIUS_W  = 5;     // Hit-test threshold in world-space pixels

// ─────────────────────────────────────────────────────────────
// CanvasOrchestrator
// ─────────────────────────────────────────────────────────────

export class CanvasOrchestrator {
    private canvas: HTMLCanvasElement;
    private ctx:    CanvasRenderingContext2D;
    private dpr:    number;

    // Viewport state — (s, tx, ty) define the affine W→S transform:
    //   Xs = s·Xw + tx,  Ys = s·Yw + ty
    public zoom:    number = 1.0;
    public offsetX: number = 0;
    public offsetY: number = 0;

    // Inertial pan state
    private velX: number = 0;
    private velY: number = 0;
    private lastPanTime: number = 0;
    private rafId: number | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Cannot acquire 2D context");
        this.ctx = ctx;
        this.dpr = window.devicePixelRatio ?? 1;
        this._applyDpr();
    }

    // ── HiDPI setup ────────────────────────────────────────────

    /** Call this once on mount and again on every ResizeObserver callback. */
    public resize(): void {
        this.dpr = window.devicePixelRatio ?? 1;
        this.canvas.width  = this.canvas.clientWidth  * this.dpr;
        this.canvas.height = this.canvas.clientHeight * this.dpr;
        this._applyDpr();
    }

    private _applyDpr(): void {
        // Scale once for physical pixels; viewport math operates in CSS pixels.
        this.ctx.scale(this.dpr, this.dpr);
    }

    // ── Coordinate conversions ─────────────────────────────────

    /** Screen → World: Xw = (Xs − tx) / s */
    public screenToWorld(sx: number, sy: number): Point2D {
        return {
            x: (sx - this.offsetX) / this.zoom,
            y: (sy - this.offsetY) / this.zoom,
        };
    }

    /** World → Screen: Xs = s·Xw + tx */
    public worldToScreen(wx: number, wy: number): Point2D {
        return {
            x: wx * this.zoom + this.offsetX,
            y: wy * this.zoom + this.offsetY,
        };
    }

    /** Snap a world-space coordinate to the nearest grid intersection. */
    public snapToGrid(coord: number): number {
        return Math.round(coord / GRID_SIZE) * GRID_SIZE;
    }

    // ── Viewport queries ───────────────────────────────────────

    /** Returns the visible rectangle in world-space coordinates. */
    public visibleWorldRect(): { minX: number; maxX: number; minY: number; maxY: number } {
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const tl = this.screenToWorld(0, 0);
        const br = this.screenToWorld(W, H);
        return { minX: tl.x, maxX: br.x, minY: tl.y, maxY: br.y };
    }

    /** AABB frustum cull: returns true if the box is (even partially) visible. */
    public isVisible(box: AABB): boolean {
        const { minX, maxX, minY, maxY } = this.visibleWorldRect();
        return (
            box.x + box.width  >= minX && box.x <= maxX &&
            box.y + box.height >= minY && box.y <= maxY
        );
    }

    // ── Zoom ──────────────────────────────────────────────────

    /**
     * Zoom-to-pointer (fixed-point zoom).
     * The world point under (sx, sy) is invariant after the zoom.
     *
     *   s'  = clamp(s · δ, sMin, sMax)
     *   tx' = sx − s'·((sx − tx)/s)   (= sx − s'·Xw)
     *   ty' = sy − s'·((sy − ty)/s)
     */
    public zoomAt(delta: number, sx: number, sy: number): void {
        const qw = this.screenToWorld(sx, sy);           // fixed world point
        const nextZoom = Math.min(
            Math.max(this.zoom * delta, MIN_ZOOM),
            MAX_ZOOM
        );
        if (nextZoom === this.zoom) return;
        this.zoom    = nextZoom;
        this.offsetX = sx - qw.x * this.zoom;
        this.offsetY = sy - qw.y * this.zoom;
    }

    // ── Inertial panning ──────────────────────────────────────

    /** Call on each pointermove delta while dragging. */
    public pan(dx: number, dy: number, dt: number): void {
        this.offsetX += dx;
        this.offsetY += dy;
        if (dt > 0) {
            this.velX = dx / dt;
            this.velY = dy / dt;
        }
        this.lastPanTime = performance.now();
    }

    /** Call on pointerup to start inertial coast. */
    public startInertia(): void {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        this._inertiaStep();
    }

    private _inertiaStep(): void {
        const now = performance.now();
        const dt  = (now - this.lastPanTime) / 1000; // seconds
        this.lastPanTime = now;

        // Exponential velocity decay: v_{n+1} = v_n · (1 − λΔt)
        const decay = 1 - PAN_LAMBDA * dt;
        this.velX *= decay;
        this.velY *= decay;

        this.offsetX += this.velX * dt * 1000; // re-convert to px
        this.offsetY += this.velY * dt * 1000;

        const speed = Math.hypot(this.velX, this.velY);
        if (speed > PAN_THRESHOLD) {
            this.rafId = requestAnimationFrame(() => this._inertiaStep());
        } else {
            this.rafId = null;
        }
    }

    // ── Render pipeline ───────────────────────────────────────

    /**
     * Begin a render frame.
     * 1. Clears the canvas.
     * 2. Saves screen-space state (for UI overlays drawn after endRender).
     * 3. Draws the dot grid (screen-space, pre-transform).
     * 4. Applies the W→S affine transform — all subsequent draws are in world space.
     */
    public beginRender(): void {
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        this.ctx.clearRect(0, 0, W, H);
        this.ctx.save();

        // Grid is drawn before setTransform (so we control screen-space positions explicitly)
        this._drawGrid(W, H);

        // Apply the viewport transform — world-space draws follow
        this.ctx.setTransform(
            this.zoom * this.dpr, 0,
            0, this.zoom * this.dpr,
            this.offsetX * this.dpr,
            this.offsetY * this.dpr
        );
    }

    /** Restore screen-space context. Call after all world-space draws. */
    public endRender(): void {
        this.ctx.restore();
    }

    // ── Grid ──────────────────────────────────────────────────

    private _drawGrid(W: number, H: number): void {
        // Skip at very low zoom: dots would be too dense to read
        if (this.zoom < 0.4) return;

        const { minX, maxX, minY, maxY } = this.visibleWorldRect();

        const startX = Math.floor(minX / GRID_SIZE) * GRID_SIZE;
        const startY = Math.floor(minY / GRID_SIZE) * GRID_SIZE;
        const endX   = Math.ceil(maxX  / GRID_SIZE) * GRID_SIZE;
        const endY   = Math.ceil(maxY  / GRID_SIZE) * GRID_SIZE;

        // Batch all dots in a single path for a single GPU flush
        this.ctx.beginPath();
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
        const r = Math.max(1.0, 1.5 * this.zoom); // dots scale with zoom for visual stability

        for (let wx = startX; wx <= endX; wx += GRID_SIZE) {
            for (let wy = startY; wy <= endY; wy += GRID_SIZE) {
                const sp = this.worldToScreen(wx, wy);
                this.ctx.moveTo(sp.x + r, sp.y);
                this.ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
            }
        }
        this.ctx.fill();
    }

    // ── Wire batch renderer ───────────────────────────────────

    /**
     * Renders a list of wire segments with frustum culling and batched draw calls.
     * Groups wires by netId so all same-net wires share a single stroke.
     */
    public drawWires(wires: WireSegment[], style: string = "#4af"): void {
        const { minX, maxX, minY, maxY } = this.visibleWorldRect();

        // Group wires by netId (style bucket)
        const buckets = new Map<string, WireSegment[]>();
        for (const w of wires) {
            // Frustum cull: reject if AABB of segment is completely outside viewport
            const wMinX = Math.min(w.x1, w.x2); const wMaxX = Math.max(w.x1, w.x2);
            const wMinY = Math.min(w.y1, w.y2); const wMaxY = Math.max(w.y1, w.y2);
            if (wMaxX < minX || wMinX > maxX || wMaxY < minY || wMinY > maxY) continue;

            if (!buckets.has(w.netId)) buckets.set(w.netId, []);
            buckets.get(w.netId)!.push(w);
        }

        // One stroke call per net (style bucket)
        this.ctx.lineWidth   = 1.5;
        this.ctx.lineCap     = "round";
        this.ctx.strokeStyle = style;

        for (const [, bucket] of buckets) {
            this.ctx.beginPath();
            for (const w of bucket) {
                this.ctx.moveTo(w.x1, w.y1);
                this.ctx.lineTo(w.x2, w.y2);
            }
            this.ctx.stroke();
        }
    }

    // ── Component batch renderer ──────────────────────────────

    /** Renders visible components sorted by zIndex. Culls invisible ones. */
    public drawComponents(components: SchematicComponent[]): void {
        const visible = components
            .filter(c => this.isVisible(c.bounds))
            .sort((a, b) => a.zIndex - b.zIndex);

        for (const comp of visible) {
            this.ctx.save();
            comp.draw(this.ctx);
            this.ctx.restore();
        }
    }

    // ── Junction dots ─────────────────────────────────────────

    /** Renders T/X junction dots (world-space radius = 4 px). */
    public drawJunctions(junctions: Point2D[]): void {
        const JUNCTION_R = 4; // world-space radius
        this.ctx.fillStyle = "#4af";
        this.ctx.beginPath();
        for (const j of junctions) {
            this.ctx.moveTo(j.x + JUNCTION_R, j.y);
            this.ctx.arc(j.x, j.y, JUNCTION_R, 0, Math.PI * 2);
        }
        this.ctx.fill();
    }

    // ── Hit-testing ───────────────────────────────────────────

    /**
     * Returns the topmost component (by zIndex) whose AABB contains the
     * world-space point, or null if none.
     * Hit-testing is done in world-space to be zoom-independent.
     */
    public hitTestComponent(
        sx: number, sy: number,
        components: SchematicComponent[]
    ): SchematicComponent | null {
        const w = this.screenToWorld(sx, sy);
        const hits = components.filter(c =>
            w.x >= c.bounds.x && w.x <= c.bounds.x + c.bounds.width &&
            w.y >= c.bounds.y && w.y <= c.bounds.y + c.bounds.height
        );
        return hits.reduce<SchematicComponent | null>(
            (top, c) => (top === null || c.zIndex > top.zIndex) ? c : top, null
        );
    }

    /**
     * Returns the nearest wire segment whose perpendicular distance from the
     * world-space point is < HIT_RADIUS_W, or null if none.
     */
    public hitTestWire(sx: number, sy: number, wires: WireSegment[]): WireSegment | null {
        const p = this.screenToWorld(sx, sy);
        let best: WireSegment | null = null;
        let bestDist = HIT_RADIUS_W;

        for (const w of wires) {
            const dist = _pointToSegmentDist(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
            if (dist < bestDist) { bestDist = dist; best = w; }
        }
        return best;
    }
}

// ─────────────────────────────────────────────────────────────
// Geometry helpers (pure functions)
// ─────────────────────────────────────────────────────────────

/** Point-to-segment distance in world space. */
function _pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ─────────────────────────────────────────────────────────────
// Orthogonal router
// ─────────────────────────────────────────────────────────────

export type RouteMode = "h-first" | "v-first";

/**
 * Generates a 2-segment Manhattan route between two snapped world-space pins.
 * Returns an array of 3 points: [start, bend, end].
 */
export function manhattanRoute(
    start: Point2D, end: Point2D, mode: RouteMode = "h-first"
): [Point2D, Point2D, Point2D] {
    const bend: Point2D = mode === "h-first"
        ? { x: end.x,   y: start.y }
        : { x: start.x, y: end.y   };
    return [start, bend, end];
}

// ─────────────────────────────────────────────────────────────
// Usage example (attach to a <canvas> element)
// ─────────────────────────────────────────────────────────────
/*
const canvas = document.querySelector<HTMLCanvasElement>("#schematic")!;
const orch   = new CanvasOrchestrator(canvas);

// HiDPI
new ResizeObserver(() => { orch.resize(); render(); }).observe(canvas);

// Zoom on scroll
canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    orch.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.offsetX, e.offsetY);
    render();
}, { passive: false });

// Pan with pointer drag
let dragging = false, lastX = 0, lastY = 0, lastT = 0;
canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp; });
canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dt = (e.timeStamp - lastT) / 1000;
    orch.pan(e.clientX - lastX, e.clientY - lastY, dt);
    lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
    render();
});
canvas.addEventListener("pointerup", () => { dragging = false; orch.startInertia(); });

function render() {
    orch.beginRender();
    orch.drawWires(myWires);
    orch.drawComponents(myComponents);
    orch.drawJunctions(myJunctions);
    orch.endRender();
}
*/
