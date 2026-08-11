import type { ComponentInstance } from "../canvas_orchestrator";

const OPTIONAL_FLOATING_PIN_TYPES = new Set<ComponentInstance["type"]>([
  "mcu_8051",
  "mcu_avr",
  "arduino_uno",
  "esp32",
  "raspberry_pi_pico",
]);

export function allowsFloatingPins(type: ComponentInstance["type"]): boolean {
  return OPTIONAL_FLOATING_PIN_TYPES.has(type);
}
