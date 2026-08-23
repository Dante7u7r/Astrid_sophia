//! MCU Emulation Cores - Native Rust implementation for co-simulation
//!
//! Provides cycle-accurate emulation of 8051 and AVR (ATmega328P) microcontrollers
//! with peripheral support for mixed-signal co-simulation with MNA solvers.

pub mod mcu8051;
pub mod atmega328p;
pub mod binary;
#[cfg(test)]
pub mod test_instructions;

use serde::{Deserialize, Serialize};

/// Error types for MCU operations
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum McuError {
    InvalidFirmwareFormat(String),
    MemoryOutOfBounds(u32),
    UnsupportedInstruction(u16),
    ExecutionError(String),
}

impl std::fmt::Display for McuError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            McuError::InvalidFirmwareFormat(msg) => write!(f, "Invalid firmware format: {}", msg),
            McuError::MemoryOutOfBounds(addr) => write!(f, "Memory access out of bounds at 0x{:04X}", addr),
            McuError::UnsupportedInstruction(op) => write!(f, "Unsupported instruction opcode: 0x{:04X}", op),
            McuError::ExecutionError(msg) => write!(f, "MCU execution error: {}", msg),
        }
    }
}

impl std::error::Error for McuError {}

/// MCU architecture type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McuType {
    Mcu8051,
    Atmega328p,
}

/// Common MCU state snapshot for debugging and UI inspection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McuState {
    pub mcu_type: McuType,
    pub pc: u16,
    pub sp: u16,
    pub acc: u8,
    pub psw: u8,
    pub dptr: u16,
    pub registers: Vec<u8>,       // R0-R7 + SFRs for 8051, R0-R31 for AVR
    pub data_memory: Vec<u8>,     // Internal RAM
    pub program_memory: Vec<u8>,  // Flash/ROM
    pub cycle_count: u64,
    pub gpio_state: GpioState,
}

/// GPIO digital state for 8-bit ports
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GpioState {
    pub port_a: u8,
    pub port_b: u8,
    pub port_c: u8,
    pub port_d: u8,
    pub ddr_a: u8,
    pub ddr_b: u8,
    pub ddr_c: u8,
    pub ddr_d: u8,
    pub pin_a: u8,
    pub pin_b: u8,
    pub pin_c: u8,
    pub pin_d: u8,
}

/// GPIO logic inputs from analog solver (quantized voltages)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GpioInputs {
    pub pin_a: u8,
    pub pin_b: u8,
    pub pin_c: u8,
    pub pin_d: u8,
    pub adc_channels: [f64; 8], // Analog input voltages (0.0 to VREF)
}

/// GPIO outputs driving the analog solver matrix
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GpioOutputs {
    pub port_a: u8,
    pub port_b: u8,
    pub port_c: u8,
    pub port_d: u8,
    pub ddr_a: u8,
    pub ddr_b: u8,
    pub ddr_c: u8,
    pub ddr_d: u8,
    pub dac_voltage: f64, // DAC output voltage (if present)
}

/// MCU Core trait - all MCU architectures must implement this interface
pub trait McuCore: Send + Sync {
    /// Get the MCU architecture type
    fn mcu_type(&self) -> McuType;
    
    /// Reset CPU to its initial state
    fn reset(&mut self);
    
    /// Load firmware (Intel HEX format or raw binary bytes)
    fn load_firmware(&mut self, firmware: &[u8]) -> Result<(), McuError>;
    
    /// Execute one instruction, return CPU machine cycles consumed
    fn step(&mut self, gpio_inputs: &GpioInputs) -> u32;
    
    /// Execute multiple instruction cycles for a given delta time
    fn run_cycles(&mut self, cycles: u32, gpio_inputs: &GpioInputs) -> u32 {
        let mut total = 0;
        while total < cycles {
            let c = self.step(gpio_inputs);
            total += c.max(1);
        }
        total
    }
    
    /// Get current state snapshot for UI and telemetry
    fn get_state(&self) -> McuState;
    
    /// Get GPIO output states and direction masks for the analog solver
    fn get_gpio_outputs(&self) -> GpioOutputs;
    
    /// Trigger or update a hardware interrupt line
    fn set_interrupt(&mut self, int_num: u8, level: bool);
    
    /// Get total elapsed machine cycles
    fn cycle_count(&self) -> u64;
    
    /// Get current Program Counter
    fn pc(&self) -> u16;
}
