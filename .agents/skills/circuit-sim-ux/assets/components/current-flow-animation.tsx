/**
 * current-flow-animation.tsx
 *
 * Animación de partículas representando flujo de corriente sobre un wire.
 * Ver references/simulation-feedback.md, sección "Animación de flujo de
 * corriente" — específicamente por qué velocidad (no densidad ni tamaño)
 * es la variable primaria ligada a magnitud de corriente.
 *
 * Componente desacoplado del NetGraph y del solver: recibe los puntos del
 * wire (de wire-router.ts) y un valor de corriente con signo, no conoce
 * nada de la estructura de datos del circuito completo ni de
 * SimulationFrame directamente.
 *
 * INTEGRACIÓN CON ASTRYD SOPHIA: el caller obtiene `currentAmps` con
 * `currentForWire(wireId, latestFrame)` de transient-stream.ts — este
 * componente no importa transient-stream.ts a propósito, para que sea
 * reusable también en contextos donde la corriente venga de un DC
 * operating point síncrono (sin streaming) en vez de un SimulationFrame.
 */

import { useEffect, useRef } from "react";
import type { GridPoint } from "./net-graph";

export interface CurrentFlowAnimationProps {
  /** Puntos del wire en coordenadas de pantalla (ya convertidos de grid a px). */
  points: GridPoint[];
  /**
   * Corriente con signo en amperios. Signo determina dirección:
   * positivo = flujo en el orden de `points` (de points[0] a points[last]),
   * negativo = flujo inverso. Ajusta esta convención si tu solver define
   * el signo de otra forma — lo importante es que sea consistente con
   * cómo defines la dirección de referencia del wire en tu modelo de datos.
   */
  currentAmps: number;
  /**
   * Umbral por debajo del cual no se anima (evita partículas "vibrando"
   * imperceptiblemente por ruido numérico cercano a 0A). Ajustar según
   * la escala típica de corrientes de tu dominio de aplicación —
   * 1e-6 A es razonable para circuitos analógicos de señal pequeña,
   * pero subirlo si trabajas con corrientes de potencia donde 1µA es
   * ruido sin significado.
   */
  thresholdAmps?: number;
  /** Corriente de referencia que mapea a velocidad "rápida" — para calibrar la escala visual a tu dominio. */
  maxExpectedAmps?: number;
  particleColor?: string;
  particleRadius?: number;
  particleCount?: number;
}

/**
 * Convierte magnitud de corriente a velocidad de partícula en px/segundo.
 * Escala no-lineal (sqrt) porque la percepción de velocidad no es lineal
 * con la magnitud — esto evita que un rango grande de corrientes (ej.
 * 1mA a 1A) produzca velocidades que o son todas imperceptiblemente
 * lentas o todas indistinguiblemente rápidas en los extremos.
 */
function currentToSpeed(absAmps: number, maxExpectedAmps: number): number {
  const normalized = Math.min(1, absAmps / maxExpectedAmps);
  const minSpeed = 20; // px/s — visible pero no urgente
  const maxSpeed = 200; // px/s — rápido pero aún legible como partículas individuales
  return minSpeed + Math.sqrt(normalized) * (maxSpeed - minSpeed);
}

function totalPathLength(points: GridPoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/** Posición interpolada a lo largo de la polilínea, dado t en [0,1]. */
function pointAtT(points: GridPoint[], t: number): GridPoint {
  const total = totalPathLength(points);
  if (total === 0) return points[0];
  let target = t * total;

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (target <= segLen || i === points.length - 2) {
      const segT = segLen === 0 ? 0 : target / segLen;
      return {
        x: points[i].x + dx * segT,
        y: points[i].y + dy * segT,
      };
    }
    target -= segLen;
  }
  return points[points.length - 1];
}

export function CurrentFlowAnimation({
  points,
  currentAmps,
  thresholdAmps = 1e-6,
  maxExpectedAmps = 1.0,
  particleColor = "#facc15",
  particleRadius = 3,
  particleCount = 4,
}: CurrentFlowAnimationProps) {
  const svgGroupRef = useRef<SVGGElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  // particlePhases: offset de fase [0,1) por partícula, para distribuirlas
  // uniformemente a lo largo del path en vez de todas saliendo del mismo punto.
  const particlePhases = useRef<number[]>(
    Array.from({ length: particleCount }, (_, i) => i / particleCount)
  );

  const absCurrent = Math.abs(currentAmps);
  const shouldAnimate = absCurrent >= thresholdAmps && points.length >= 2;
  const direction = currentAmps >= 0 ? 1 : -1;

  useEffect(() => {
    if (!shouldAnimate || !svgGroupRef.current) {
      return;
    }

    const pathLength = totalPathLength(points);
    const speed = currentToSpeed(absCurrent, maxExpectedAmps); // px/s
    // Tiempo para completar un ciclo completo del path, en segundos.
    const cycleDuration = pathLength / speed;

    let lastTimestamp: number | null = null;
    const circles = Array.from(
      svgGroupRef.current.querySelectorAll<SVGCircleElement>("circle")
    );

    const tick = (timestamp: number) => {
      if (lastTimestamp === null) lastTimestamp = timestamp;
      const deltaSeconds = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      const deltaPhase =
        cycleDuration > 0 ? deltaSeconds / cycleDuration : 0;

      particlePhases.current = particlePhases.current.map((phase) => {
        let next = phase + deltaPhase * direction;
        // wrap a [0,1)
        next = ((next % 1) + 1) % 1;
        return next;
      });

      particlePhases.current.forEach((phase, i) => {
        const pos = pointAtT(points, phase);
        const circle = circles[i];
        if (circle) {
          circle.setAttribute("cx", String(pos.x));
          circle.setAttribute("cy", String(pos.y));
        }
      });

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
    // points por referencia es suficiente aquí: si el wire se re-rutea,
    // el caller debe pasar un nuevo array (lo cual ocurre naturalmente
    // si points viene de un estado inmutable en el componente padre).
  }, [shouldAnimate, points, absCurrent, maxExpectedAmps, direction]);

  if (!shouldAnimate) {
    return null;
  }

  return (
    <g ref={svgGroupRef} aria-hidden="true">
      {particlePhases.current.map((_, i) => (
        <circle
          key={i}
          r={particleRadius}
          fill={particleColor}
          opacity={0.85}
        />
      ))}
    </g>
  );
}
