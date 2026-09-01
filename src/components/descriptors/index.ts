// ==========================================================================
// COMPONENT DESCRIPTORS INDEX — Colección de todas las definiciones EDA
// ==========================================================================

import type { ComponentDefinition } from "../types";

import {
  CapacitorDefinition,
  DmmDefinition,
  FuseDefinition,
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
  IgbtDefinition,
  LedDefinition,
  NjfDefinition,
  NmosDefinition,
  NpnDefinition,
  OptoDefinition,
  PjfDefinition,
  PmosDefinition,
  PnpDefinition,
  SchottkyDiodeDefinition,
  ZenerDiodeDefinition,
  DiodeBridgeDefinition,
  Bsim3NmosDefinition,
  Bsim3PmosDefinition,
  Bsim4NmosDefinition,
  Bsim4PmosDefinition,
} from "./semiconductors";

import {
  DiacDefinition,
  ScrDefinition,
  Tl431Definition,
  TriacDefinition,
} from "./power_electronics";

import {
  FrequencyCounterDefinition,
  LogicProbeDefinition,
  PulseGeneratorDefinition,
  StbProbeDefinition,
  WattmeterDefinition,
} from "./instruments";

import {
  CccsDefinition,
  CcvsDefinition,
  ComparatorIdealDefinition,
  IsourceDefinition,
  OpampDefinition,
  OpampIdealDefinition,
  VccsDefinition,
  VcvsDefinition,
  VsourceDefinition,
} from "./analog";

import {
  BuzzerDefinition,
  DcMotorDefinition,
  LampDefinition,
  Lcd16x2Definition,
  PushbuttonDefinition,
  RelayDefinition,
  SevenSegmentDefinition,
  ServoMotorDefinition,
  StepperMotorDefinition,
  SpeakerDefinition,
  SolenoidDefinition,
  SsrDefinition,
  SwitchDefinition,
  SwitchDpdtDefinition,
  SwitchSpdtDefinition,
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
  BcdTo7SegDefinition,
  FlipFlopDDefinition,
  FlipFlopJKDefinition,
  ShiftRegister595Definition,
} from "./sequential_logic";

import {
  BcdCounter90Definition,
  Decoder138Definition,
  JohnsonCounter4017Definition,
  Multiplexer151Definition,
  UpDownCounter193Definition,
} from "./digital_ics";

import {
  ArduinoUnoDefinition,
  Esp32Definition,
  Mcu8051Definition,
  McuAvrDefinition,
  Pic16f84aDefinition,
  RaspberryPiPicoDefinition,
} from "./microcontrollers";

import {
  NetLabelDefinition,
  PowerPortDefinition,
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
  FuseDefinition,
  GroundDefinition,
  TransformerDefinition,
  DmmDefinition,
  WattmeterDefinition,
  LogicProbeDefinition,
  PulseGeneratorDefinition,
  FrequencyCounterDefinition,
  StbProbeDefinition,

  // Semiconductores
  DiodeDefinition,
  ZenerDiodeDefinition,
  SchottkyDiodeDefinition,
  LedDefinition,
  NmosDefinition,
  PmosDefinition,
  IgbtDefinition,
  NpnDefinition,
  PnpDefinition,
  NjfDefinition,
  PjfDefinition,
  OptoDefinition,
  DiodeBridgeDefinition,
  Bsim3NmosDefinition,
  Bsim3PmosDefinition,
  Bsim4NmosDefinition,
  Bsim4PmosDefinition,
  ScrDefinition,
  TriacDefinition,
  DiacDefinition,
  Tl431Definition,

  // Fuentes y Activos Analógicos
  VsourceDefinition,
  IsourceDefinition,
  VcvsDefinition,
  VccsDefinition,
  CcvsDefinition,
  CccsDefinition,
  OpampDefinition,
  OpampIdealDefinition,
  ComparatorIdealDefinition,

  // Actuadores e Interruptores
  LampDefinition,
  RelayDefinition,
  BuzzerDefinition,
  SwitchDefinition,
  SwitchSpdtDefinition,
  SwitchDpdtDefinition,
  PushbuttonDefinition,
  DcMotorDefinition,
  ServoMotorDefinition,
  StepperMotorDefinition,
  SpeakerDefinition,
  SolenoidDefinition,
  SsrDefinition,
  SevenSegmentDefinition,
  Lcd16x2Definition,

  // Lógica Digital Combinacional
  AndGateDefinition,
  OrGateDefinition,
  NotGateDefinition,
  NandGateDefinition,
  NorGateDefinition,
  XorGateDefinition,

  // Lógica Secuencial & CIs Digitales
  FlipFlopDDefinition,
  FlipFlopJKDefinition,
  BcdTo7SegDefinition,
  ShiftRegister595Definition,
  JohnsonCounter4017Definition,
  BcdCounter90Definition,
  UpDownCounter193Definition,
  Decoder138Definition,
  Multiplexer151Definition,

  // Microcontroladores
  Mcu8051Definition,
  McuAvrDefinition,
  Pic16f84aDefinition,
  ArduinoUnoDefinition,
  Esp32Definition,
  RaspberryPiPicoDefinition,

  // Anotaciones y Documentación
  NetLabelDefinition,
  PowerPortDefinition,
  TextNoteDefinition,

  // Macromodelos
  SubcircuitDefinition,
];
