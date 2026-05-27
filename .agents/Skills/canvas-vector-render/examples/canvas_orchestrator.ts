// Example: Highly optimized, reference TypeScript Canvas Orchestrator
// Location: C:\Users\maruc\Desktop\Astryd_Sophia_Skills\canvas-vector-render\examples\canvas_orchestrator.ts

export interface Point2D {
    x: number;
    y: number;
}

export interface BoundingBox {
    x: number; // World X coordinates
    y: number; // World Y coordinates
    width: number;
    height: number;
}

export class CanvasOrchestrator {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    // Viewport State
    public zoom: number = 1.0;
    public offsetX: number = 0;
    public offsetY: number = 0;

    // Constants
    public readonly minZoom: number = 0.2;
    public readonly maxZoom: number = 4.0;
    public readonly gridSize: number = 20;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not acquire 2D rendering context");
        this.ctx = context;
    }

    /**
     * Converts raw Screen coordinates (pixels on the viewport) to World coordinates (logical circuit coordinates).
     */
    public screenToWorld(screenX: number, screenY: number): Point2D {
        return {
            x: (screenX - this.offsetX) / this.zoom,
            y: (screenY - this.offsetY) / this.zoom,
        };
    }

    /**
     * Converts logical World coordinates (circuit) into physical Screen coordinates (pixels).
     */
    public worldToScreen(worldX: number, worldY: number): Point2D {
        return {
            x: worldX * this.zoom + this.offsetX,
            y: worldY * this.zoom + this.offsetY,
        };
    }

    /**
     * Snaps any coordinate coordinate to the closest grid intersection.
     */
    public snapToGrid(coord: number): number {
        return Math.round(coord / this.gridSize) * this.gridSize;
    }

    /**
     * Checks if a component's bounding box is inside the current viewport.
     * Prevents drawing elements that are out of bounds (Viewport Frustum Culling).
     */
    public isVisible(box: BoundingBox): boolean {
        // Calculate the current viewport bounding box in World Space
        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(this.canvas.width, this.canvas.height);

        // Viewport bounds
        const viewMinX = topLeft.x;
        const viewMaxX = bottomRight.x;
        const viewMinY = topLeft.y;
        const viewMaxY = bottomRight.y;

        // Component bounds
        const compMinX = box.x;
        const compMaxX = box.x + box.width;
        const compMinY = box.y;
        const compMaxY = box.y + box.height;

        // Returns true if there is overlapping on both axes
        return (compMaxX >= viewMinX && compMinX <= viewMaxX) &&
               (compMaxY >= viewMinY && compMinY <= viewMaxY);
    }

    /**
     * Handles camera zoom focusing on a specific screen-space target point (usually the mouse pointer).
     */
    public zoomAt(zoomFactor: number, screenTargetX: number, screenTargetY: number): void {
        // Get the target point under the mouse pointer in World Space
        const worldTarget = this.screenToWorld(screenTargetX, screenTargetY);

        // Calculate and clamp new zoom level
        const nextZoom = Math.min(Math.max(this.zoom * zoomFactor, this.minZoom), this.maxZoom);
        if (nextZoom === this.zoom) return;

        this.zoom = nextZoom;

        // Reposition camera offsets so the same World Space point remains under the screen pointer
        this.offsetX = screenTargetX - worldTarget.x * this.zoom;
        this.offsetY = screenTargetY - worldTarget.y * this.zoom;
    }

    /**
     * Standard draw cycle setup. Sets the transformation matrix and renders the canvas grid.
     */
    public beginRender(): void {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        // Save untransformed state for drawing static UI overlays
        this.ctx.save();

        // 1. Draw Grid Background (uses world space projection)
        this.drawWorldGrid();

        // 2. Set Canvas Transform Matrix to apply Panning & Zooming
        this.ctx.setTransform(this.zoom, 0, 0, this.zoom, this.offsetX, this.offsetY);
    }

    public endRender(): void {
        // Restore context state back to screen-space coordinates
        this.ctx.restore();
    }

    /**
     * Draws the dots/grid layout dynamically depending on the current zoom and viewport offsets.
     */
    private drawWorldGrid(): void {
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Get viewport bounds in World Space to draw grid points only inside visible box
        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(width, height);

        // Align boundaries to grid spacing
        const startX = Math.floor(topLeft.x / this.gridSize) * this.gridSize;
        const endX = Math.ceil(bottomRight.x / this.gridSize) * this.gridSize;
        const startY = Math.floor(topLeft.y / this.gridSize) * this.gridSize;
        const endY = Math.ceil(bottomRight.y / this.gridSize) * this.gridSize;

        this.ctx.fillStyle = "rgba(255, 255, 255, 0.05)"; // Subdued dot grid

        // Draw grid intersection dots directly using world coordinates projected onto screen space
        for (let x = startX; x <= endX; x += this.gridSize) {
            for (let y = startY; y <= endY; y += this.gridSize) {
                const screenPos = this.worldToScreen(x, y);
                this.ctx.beginPath();
                this.ctx.arc(screenPos.x, screenPos.y, 1.5 * this.zoom, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }
}
