import type { McuDefinition, McuRegister, McuPeripheral } from "./mcu-types";

export const AVR_REGISTERS: McuRegister[] = [
  { name: "SREG", address: 0x3F, size: 8 },
  { name: "SPH", address: 0x3E, size: 8 },
  { name: "SPL", address: 0x3D, size: 8 },
  { name: "GPIOR0", address: 0x3C, size: 8 },
  { name: "GPIOR1", address: 0x3B, size: 8 },
  { name: "GPIOR2", address: 0x3A, size: 8 },
  { name: "OCR0BH", address: 0x39, size: 8 },
  { name: "OCR0BL", address: 0x38, size: 8 },
  { name: "TCNT0", address: 0x36, size: 8 },
  { name: "TCCR0", address: 0x33, size: 8 },
  { name: "TIFR", address: 0x35, size: 8 },
  { name: "TIMSK", address: 0x34, size: 8 },
  { name: "MCUCR", address: 0x35, size: 8 },
  { name: "MCUSR", address: 0x34, size: 8 },
  { name: "OCR0A", address: 0x38, size: 8 },
  { name: "OCR0B", address: 0x3C, size: 8 }
];

export const AVR_PERIPHERALS: McuPeripheral[] = [
  { name: "Timer0", baseAddress: 0x32, size: 8, interrupts: ["TIMER0_OVF", "TIMER0_COMPA"] },
  { name: "Timer1", baseAddress: 0x30, size: 16, interrupts: ["TIMER1_OVF", "TIMER1_COMPA", "TIMER1_CAPT"] },
  { name: "USART", baseAddress: 0x28, size: 8, interrupts: ["USART_RXC", "USART_TXC", "USART_UDRE"] },
  { name: "SPI", baseAddress: 0x20, size: 8, interrupts: ["SPI_STC"] },
  { name: "TWI", baseAddress: 0x18, size: 8, interrupts: ["TWI"] },
  { name: "ADC", baseAddress: 0x10, size: 16, interrupts: ["ADC"] },
  { name: "EEPROM", baseAddress: 0x00, size: 4, interrupts: [] }
];

export const ATMEGA328P: McuDefinition = {
  name: "ATmega328P",
  architecture: "avr",
  clockSpeed: 16e6,
  flashSize: 32 * 1024,
  ramSize: 2 * 1024,
  registers: AVR_REGISTERS,
  peripherals: AVR_PERIPHERALS,
  pcSize: 22,
  stackPointerSize: 16
};

export const ATMEGA2560: McuDefinition = {
  name: "ATmega2560",
  architecture: "avr",
  clockSpeed: 16e6,
  flashSize: 256 * 1024,
  ramSize: 8 * 1024,
  registers: [],
  peripherals: [],
  pcSize: 22,
  stackPointerSize: 16
};

export const ATMEGA328P_DEFINITIONS: McuDefinition = {
  name: "ATmega328P",
  architecture: "avr",
  clockSpeed: 16e6,
  flashSize: 32768,
  ramSize: 2048,
  registers: [
    { name: "R0", address: 0x00, size: 8 },
    { name: "R1", address: 0x01, size: 8 },
    { name: "R2", address: 0x02, size: 8 },
    { name: "R3", address: 0x03, size: 8 },
    { name: "R4", address: 0x04, size: 8 },
    { name: "R5", address: 0x05, size: 8 },
    { name: "R6", address: 0x06, size: 8 },
    { name: "R7", address: 0x07, size: 8 },
    { name: "R8", address: 0x08, size: 8 },
    { name: "R9", address: 0x09, size: 8 },
    { name: "R10", address: 0x0A, size: 8 },
    { name: "R11", address: 0x0B, size: 8 },
    { name: "R12", address: 0x0C, size: 8 },
    { name: "R13", address: 0x0D, size: 8 },
    { name: "R14", address: 0x0E, size: 8 },
    { name: "R15", address: 0x0F, size: 8 },
    { name: "R16", address: 0x10, size: 8 },
    { name: "R17", address: 0x11, size: 8 },
    { name: "R18", address: 0x12, size: 8 },
    { name: "R19", address: 0x13, size: 8 },
    { name: "R20", address: 0x14, size: 8 },
    { name: "R21", address: 0x15, size: 8 },
    { name: "R22", address: 0x16, size: 8 },
    { name: "R23", address: 0x17, size: 8 },
    { name: "R24", address: 0x18, size: 8 },
    { name: "R25", address: 0x19, size: 8 },
    { name: "R26", address: 0x1A, size: 8 },
    { name: "R27", address: 0x1B, size: 8 },
    { name: "R28", address: 0x1C, size: 8 },
    { name: "R29", address: 0x1D, size: 8 },
    { name: "R30", address: 0x1E, size: 8 },
    { name: "R31", address: 0x1F, size: 8 },
    { name: "XH", address: 0x1A, size: 8 },
    { name: "XL", address: 0x1B, size: 8 },
    { name: "YH", address: 0x1C, size: 8 },
    { name: "YL", address: 0x1D, size: 8 },
    { name: "ZH", address: 0x1E, size: 8 },
    { name: "ZL", address: 0x1F, size: 8 },
    { name: "SREG", address: 0x3F, size: 8 },
    { name: "SPH", address: 0x3E, size: 8 },
    { name: "SPL", address: 0x3D, size: 8 }
  ],
  peripherals: [
    { name: "PORTA", baseAddress: 0x02, size: 8, interrupts: [] },
    { name: "PORTB", baseAddress: 0x05, size: 8, interrupts: [] },
    { name: "PORTC", baseAddress: 0x08, size: 8, interrupts: [] },
    { name: "PORTD", baseAddress: 0x0B, size: 8, interrupts: [] },
    { name: "PINA", baseAddress: 0x00, size: 8, interrupts: [] },
    { name: "PINB", baseAddress: 0x03, size: 8, interrupts: [] },
    { name: "PINC", baseAddress: 0x06, size: 8, interrupts: [] },
    { name: "PIND", baseAddress: 0x09, size: 8, interrupts: [] },
    { name: "DDRA", baseAddress: 0x01, size: 8, interrupts: [] },
    { name: "DDRB", baseAddress: 0x04, size: 8, interrupts: [] },
    { name: "DDRC", baseAddress: 0x07, size: 8, interrupts: [] },
    { name: "DDRD", baseAddress: 0x0A, size: 8, interrupts: [] },
    { name: "TCCR0A", baseAddress: 0x44, size: 8, interrupts: [] },
    { name: "TCCR0B", baseAddress: 0x45, size: 8, interrupts: [] },
    { name: "TCNT0", baseAddress: 0x46, size: 8, interrupts: [] },
    { name: "OCR0A", baseAddress: 0x47, size: 8, interrupts: [] },
    { name: "OCR0B", baseAddress: 0x48, size: 8, interrupts: [] },
    { name: "TIMSK0", baseAddress: 0x6E, size: 8, interrupts: [] },
    { name: "TIFR0", baseAddress: 0x6F, size: 8, interrupts: [] },
    { name: "TCCR1A", baseAddress: 0x80, size: 8, interrupts: [] },
    { name: "TCCR1B", baseAddress: 0x81, size: 8, interrupts: [] },
    { name: "TCCR1C", baseAddress: 0x82, size: 8, interrupts: [] },
    { name: "TCNT1H", baseAddress: 0x85, size: 8, interrupts: [] },
    { name: "TCNT1L", baseAddress: 0x84, size: 8, interrupts: [] },
    { name: "OCR1AH", baseAddress: 0x87, size: 8, interrupts: [] },
    { name: "OCR1AL", baseAddress: 0x86, size: 8, interrupts: [] },
    { name: "OCR1BH", baseAddress: 0x89, size: 8, interrupts: [] },
    { name: "OCR1BL", baseAddress: 0x88, size: 8, interrupts: [] },
    { name: "ICR1H", baseAddress: 0x85, size: 8, interrupts: [] },
    { name: "ICR1L", baseAddress: 0x86, size: 8, interrupts: [] },
    { name: "UCSR0A", baseAddress: 0xC0, size: 8, interrupts: [] },
    { name: "UCSR0B", baseAddress: 0xC1, size: 8, interrupts: [] },
    { name: "UCSR0C", baseAddress: 0xC2, size: 8, interrupts: [] },
    { name: "UBRR0H", baseAddress: 0xC5, size: 8, interrupts: [] },
    { name: "UBRR0L", baseAddress: 0xC4, size: 8, interrupts: [] },
    { name: "UDR0", baseAddress: 0xC6, size: 8, interrupts: [] },
    { name: "ADCSRA", baseAddress: 0x7A, size: 8, interrupts: [] },
    { name: "ADCSRB", baseAddress: 0x7B, size: 8, interrupts: [] },
    { name: "ADMUX", baseAddress: 0x7C, size: 8, interrupts: [] },
    { name: "DIDR0", baseAddress: 0x7E, size: 8, interrupts: [] },
    { name: "ADC", baseAddress: 0x78, size: 16, interrupts: [] }
  ],
  pcSize: 22,
  stackPointerSize: 16
};

export const AVR_MCU_DEFINITIONS: Record<string, McuDefinition> = {
  "ATmega328P": ATMEGA328P_DEFINITIONS,
  "ATmega2560": ATMEGA2560,
  "ATmega328": ATMEGA328P_DEFINITIONS
};

export function getAvrDefinition(name: string): McuDefinition | undefined {
  return AVR_MCU_DEFINITIONS[name];
}

export function listAvrMcus(): string[] {
  return Object.keys(AVR_MCU_DEFINITIONS);
}