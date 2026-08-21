// ==========================================================================
// COMPONENT DESCRIPTORS INDEX — Colección de todas las definiciones EDA
// ==========================================================================

import type { ComponentDefinition } from "../types";

import {
  CapacitorDefinition,
  DmmDefinition,
  GroundDefinition,
  InductorDefinition,
  LdrDefinition,
  PotentiometerDefinition,
  ResistorDefinition,
  ThermistorDefinition,
  TransformerDefinition,
} from "./passives";

import {
  DiodeDefinition,
  LedDefinition,
  NjfDefinition,
  NmosDefinition,
  NpnDefinition,
  OptoDefinition,
  PjfDefinition,
  PmosDefinition,
  PnpDefinition,
} from "./semiconductors";

import {
  IsourceDefinition,
  OpampDefinition,
  OpampIdealDefinition,
  VsourceDefinition,
} from "./analog";

import {
  BuzzerDefinition,
  LampDefinition,
  RelayDefinition,
  SwitchDefinition,
} from "./actuators";

import {
  AndGateDefinition,
  NandGateDefinition,
  NorGateDefinition,
  NotGateDefinition,
  OrGateDefinition,
  XorGateDefinition,
} from "./logic_gates";

import {
  ArduinoUnoDefinition,
  Esp32Definition,
  Mcu8051Definition,
  McuAvrDefinition,
  RaspberryPiPicoDefinition,
} from "./microcontrollers";

import {
  NetLabelDefinition,
  TextNoteDefinition,
} from "./annotations";

import {
  SubcircuitDefinition,
} from "./subcircuits";

export const ALL_COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = [
  // Pasivos
  ResistorDefinition,
  CapacitorDefinition,
  InductorDefinition,
  PotentiometerDefinition,
  LdrDefinition,
  ThermistorDefinition,
  GroundDefinition,
  TransformerDefinition,
  DmmDefinition,

  // Semiconductores
  DiodeDefinition,
  LedDefinition,
  NmosDefinition,
  PmosDefinition,
  NpnDefinition,
  PnpDefinition,
  NjfDefinition,
  PjfDefinition,
  OptoDefinition,

  // Analógicos
  OpampDefinition,
  OpampIdealDefinition,
  VsourceDefinition,
  IsourceDefinition,

  // Actuadores
  LampDefinition,
  RelayDefinition,
  BuzzerDefinition,
  SwitchDefinition,

  // Lógica Digital
  AndGateDefinition,
  OrGateDefinition,
  NotGateDefinition,
  NandGateDefinition,
  NorGateDefinition,
  XorGateDefinition,

  // Microcontroladores
  Mcu8051Definition,
  McuAvrDefinition,
  ArduinoUnoDefinition,
  Esp32Definition,
  RaspberryPiPicoDefinition,

  // Anotaciones y Documentación
  NetLabelDefinition,
  TextNoteDefinition,

  // Macromodelos
  SubcircuitDefinition,
];
