/**
 * Adapta un elemento canvas 2D a la densidad de píxeles nativa de la pantalla (DPR / Retina / 4K),
 * manteniendo las coordenadas lógicas CSS sincronizadas con la escala física de renderizado.
 */
export function ensureCanvasDpr(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): { width: number; height: number; dpr: number } {
  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 300;
  const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 150;
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  return { width, height, dpr };
}
