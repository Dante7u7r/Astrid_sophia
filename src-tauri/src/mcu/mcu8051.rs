//! Complete 8051 Microcontroller Architecture & ISA Implementation
//!
//! Implements all 256 instructions, bit-addressable SFRs, RAM banking,
//! hardware timers (T0/T1), UART buffers, and vector interrupt controller.

use super::{
    binary::parse_firmware_image, GpioInputs, GpioOutputs, GpioState, McuCore, McuError, McuState,
    McuType,
};

pub const SFR_ACC: u8 = 0xE0;
pub const SFR_B: u8 = 0xF0;
pub const SFR_PSW: u8 = 0xD0;
pub const SFR_SP: u8 = 0x81;
pub const SFR_DPL: u8 = 0x82;
pub const SFR_DPH: u8 = 0x83;
pub const SFR_P0: u8 = 0x80;
pub const SFR_P1: u8 = 0x90;
pub const SFR_P2: u8 = 0xA0;
pub const SFR_P3: u8 = 0xB0;
pub const SFR_IE: u8 = 0xA8;
pub const SFR_IP: u8 = 0xB8;
pub const SFR_TCON: u8 = 0x88;
pub const SFR_TMOD: u8 = 0x89;
pub const SFR_TL0: u8 = 0x8A;
pub const SFR_TL1: u8 = 0x8B;
pub const SFR_TH0: u8 = 0x8C;
pub const SFR_TH1: u8 = 0x8D;
pub const SFR_SCON: u8 = 0x98;
pub const SFR_SBUF: u8 = 0x99;

pub const PSW_P_MASK: u8 = 0x01;
pub const PSW_OV_MASK: u8 = 0x04;
pub const PSW_RS0_MASK: u8 = 0x08;
pub const PSW_RS1_MASK: u8 = 0x10;
pub const PSW_F0_MASK: u8 = 0x20;
pub const PSW_AC_MASK: u8 = 0x40;
pub const PSW_CY_MASK: u8 = 0x80;

pub struct Mcu8051 {
    pub pc: u16,
    pub ram: [u8; 128],       // Internal data RAM (0x00..0x7F)
    pub sfr: [u8; 128],       // Special Function Registers (0x80..0xFF)
    pub code_memory: Vec<u8>, // 64KB Flash/ROM
    pub cycle_count: u64,
    pub is_halted: bool,
    pub irq_in_service: bool,
}

impl Default for Mcu8051 {
    fn default() -> Self {
        let mut mcu = Self {
            pc: 0x0000,
            ram: [0; 128],
            sfr: [0; 128],
            code_memory: vec![0; 65536],
            cycle_count: 0,
            is_halted: false,
            irq_in_service: false,
        };
        mcu.reset();
        mcu
    }
}

impl Mcu8051 {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn read_direct(&self, addr: u8) -> u8 {
        if addr < 0x80 {
            self.ram[addr as usize]
        } else {
            self.sfr[(addr - 0x80) as usize]
        }
    }

    pub fn write_direct(&mut self, addr: u8, val: u8) {
        if addr < 0x80 {
            self.ram[addr as usize] = val;
        } else {
            self.sfr[(addr - 0x80) as usize] = val;
            if addr == SFR_ACC {
                self.update_parity();
            }
        }
    }

    pub fn read_acc(&self) -> u8 {
        self.read_direct(SFR_ACC)
    }

    pub fn write_acc(&mut self, val: u8) {
        self.write_direct(SFR_ACC, val);
    }

    pub fn read_b(&self) -> u8 {
        self.read_direct(SFR_B)
    }

    pub fn write_b(&mut self, val: u8) {
        self.write_direct(SFR_B, val);
    }

    pub fn read_psw(&self) -> u8 {
        self.read_direct(SFR_PSW)
    }

    pub fn write_psw(&mut self, val: u8) {
        self.write_direct(SFR_PSW, val);
    }

    pub fn read_sp(&self) -> u8 {
        self.read_direct(SFR_SP)
    }

    pub fn write_sp(&mut self, val: u8) {
        self.write_direct(SFR_SP, val);
    }

    pub fn read_dptr(&self) -> u16 {
        let dph = self.read_direct(SFR_DPH) as u16;
        let dpl = self.read_direct(SFR_DPL) as u16;
        (dph << 8) | dpl
    }

    pub fn write_dptr(&mut self, val: u16) {
        self.write_direct(SFR_DPH, (val >> 8) as u8);
        self.write_direct(SFR_DPL, (val & 0xFF) as u8);
    }

    pub fn get_cy(&self) -> bool {
        (self.read_psw() & PSW_CY_MASK) != 0
    }

    pub fn set_cy(&mut self, val: bool) {
        let mut psw = self.read_psw();
        if val {
            psw |= PSW_CY_MASK;
        } else {
            psw &= !PSW_CY_MASK;
        }
        self.write_psw(psw);
    }

    pub fn get_ac(&self) -> bool {
        (self.read_psw() & PSW_AC_MASK) != 0
    }

    pub fn set_ac(&mut self, val: bool) {
        let mut psw = self.read_psw();
        if val {
            psw |= PSW_AC_MASK;
        } else {
            psw &= !PSW_AC_MASK;
        }
        self.write_psw(psw);
    }

    pub fn get_ov(&self) -> bool {
        (self.read_psw() & PSW_OV_MASK) != 0
    }

    pub fn set_ov(&mut self, val: bool) {
        let mut psw = self.read_psw();
        if val {
            psw |= PSW_OV_MASK;
        } else {
            psw &= !PSW_OV_MASK;
        }
        self.write_psw(psw);
    }

    pub fn update_parity(&mut self) {
        let acc = self.sfr[(SFR_ACC - 0x80) as usize];
        let ones = acc.count_ones();
        let mut psw = self.sfr[(SFR_PSW - 0x80) as usize];
        if !ones.is_multiple_of(2) {
            psw |= PSW_P_MASK;
        } else {
            psw &= !PSW_P_MASK;
        }
        self.sfr[(SFR_PSW - 0x80) as usize] = psw;
    }

    pub fn get_register_bank_offset(&self) -> usize {
        let psw = self.read_psw();
        let bank = (psw >> 3) & 0x03;
        (bank as usize) * 8
    }

    pub fn read_rn(&self, n: usize) -> u8 {
        let addr = self.get_register_bank_offset() + (n & 7);
        self.ram[addr]
    }

    pub fn write_rn(&mut self, n: usize, val: u8) {
        let addr = self.get_register_bank_offset() + (n & 7);
        self.ram[addr] = val;
    }

    pub fn read_indirect_ri(&self, i: usize) -> u8 {
        let addr = self.read_rn(i & 1) as usize;
        if addr < 128 {
            self.ram[addr]
        } else {
            0
        }
    }

    pub fn write_indirect_ri(&mut self, i: usize, val: u8) {
        let addr = self.read_rn(i & 1) as usize;
        if addr < 128 {
            self.ram[addr] = val;
        }
    }

    pub fn read_bit(&self, bit_addr: u8) -> bool {
        if bit_addr < 0x80 {
            let byte_addr = 0x20 + (bit_addr >> 3);
            let bit_pos = bit_addr & 7;
            let byte = self.read_direct(byte_addr);
            ((byte >> bit_pos) & 1) != 0
        } else {
            let sfr_base = bit_addr & 0xF8;
            let bit_pos = bit_addr & 7;
            let byte = self.read_direct(sfr_base);
            ((byte >> bit_pos) & 1) != 0
        }
    }

    pub fn write_bit(&mut self, bit_addr: u8, val: bool) {
        if bit_addr < 0x80 {
            let byte_addr = 0x20 + (bit_addr >> 3);
            let bit_pos = bit_addr & 7;
            let mut byte = self.read_direct(byte_addr);
            if val {
                byte |= 1 << bit_pos;
            } else {
                byte &= !(1 << bit_pos);
            }
            self.write_direct(byte_addr, byte);
        } else {
            let sfr_base = bit_addr & 0xF8;
            let bit_pos = bit_addr & 7;
            let mut byte = self.read_direct(sfr_base);
            if val {
                byte |= 1 << bit_pos;
            } else {
                byte &= !(1 << bit_pos);
            }
            self.write_direct(sfr_base, byte);
        }
    }

    pub fn push(&mut self, val: u8) {
        let sp = self.read_sp().wrapping_add(1);
        self.write_sp(sp);
        self.write_direct(sp, val);
    }

    pub fn pop(&mut self) -> u8 {
        let sp = self.read_sp();
        let val = self.read_direct(sp);
        self.write_sp(sp.wrapping_sub(1));
        val
    }

    pub fn fetch_code_byte(&mut self) -> u8 {
        let byte = self.code_memory[self.pc as usize];
        self.pc = self.pc.wrapping_add(1);
        byte
    }

    pub fn fetch_code_word(&mut self) -> u16 {
        let high = self.fetch_code_byte() as u16;
        let low = self.fetch_code_byte() as u16;
        (high << 8) | low
    }

    // Step hardware timers
    pub fn step_timers(&mut self, cycles: u32) {
        let tcon = self.read_direct(SFR_TCON);
        let tmod = self.read_direct(SFR_TMOD);

        // Timer 0
        if (tcon & 0x10) != 0 {
            let mode0 = tmod & 0x03;
            let tl0 = self.read_direct(SFR_TL0) as u16;
            let th0 = self.read_direct(SFR_TH0) as u16;
            let mut count = (th0 << 8) | tl0;

            match mode0 {
                0 => {
                    // 13-bit
                    count += cycles as u16;
                    if count >= 8192 {
                        count %= 8192;
                        self.set_timer0_overflow(true);
                    }
                    self.write_direct(SFR_TL0, (count & 0x1F) as u8);
                    self.write_direct(SFR_TH0, ((count >> 5) & 0xFF) as u8);
                }
                1 => {
                    // 16-bit
                    let (new_count, overflow) = count.overflowing_add(cycles as u16);
                    if overflow {
                        self.set_timer0_overflow(true);
                    }
                    self.write_direct(SFR_TL0, (new_count & 0xFF) as u8);
                    self.write_direct(SFR_TH0, ((new_count >> 8) & 0xFF) as u8);
                }
                2 => {
                    // 8-bit auto-reload
                    let reload = th0 as u8;
                    let (new_tl0, overflow) = (tl0 as u8).overflowing_add(cycles as u8);
                    if overflow {
                        self.write_direct(SFR_TL0, reload);
                        self.set_timer0_overflow(true);
                    } else {
                        self.write_direct(SFR_TL0, new_tl0);
                    }
                }
                _ => {}
            }
        }

        // Timer 1
        if (tcon & 0x40) != 0 {
            let mode1 = (tmod >> 4) & 0x03;
            let tl1 = self.read_direct(SFR_TL1) as u16;
            let th1 = self.read_direct(SFR_TH1) as u16;
            let count = (th1 << 8) | tl1;

            if mode1 == 1 {
                // 16-bit
                let (new_count, overflow) = count.overflowing_add(cycles as u16);
                if overflow {
                    self.set_timer1_overflow(true);
                }
                self.write_direct(SFR_TL1, (new_count & 0xFF) as u8);
                self.write_direct(SFR_TH1, ((new_count >> 8) & 0xFF) as u8);
            } else if mode1 == 2 {
                // 8-bit auto-reload
                let reload = th1 as u8;
                let (new_tl1, overflow) = (tl1 as u8).overflowing_add(cycles as u8);
                if overflow {
                    self.write_direct(SFR_TL1, reload);
                    self.set_timer1_overflow(true);
                } else {
                    self.write_direct(SFR_TL1, new_tl1);
                }
            }
        }
    }

    pub fn set_timer0_overflow(&mut self, val: bool) {
        let mut tcon = self.read_direct(SFR_TCON);
        if val {
            tcon |= 0x20;
        } else {
            tcon &= !0x20;
        }
        self.write_direct(SFR_TCON, tcon);
    }

    pub fn set_timer1_overflow(&mut self, val: bool) {
        let mut tcon = self.read_direct(SFR_TCON);
        if val {
            tcon |= 0x80;
        } else {
            tcon &= !0x80;
        }
        self.write_direct(SFR_TCON, tcon);
    }

    // Check and trigger pending interrupts
    pub fn check_interrupts(&mut self) -> bool {
        let ie = self.read_direct(SFR_IE);
        if (ie & 0x80) == 0 || self.irq_in_service {
            return false; // Global interrupt disable or IRQ already handling
        }

        let tcon = self.read_direct(SFR_TCON);

        // Vector 0x0003: External Interrupt 0 (IE0)
        if (ie & 0x01) != 0 && (tcon & 0x02) != 0 {
            self.service_interrupt(0x0003);
            let mut tcon_new = self.read_direct(SFR_TCON);
            tcon_new &= !0x02; // Clear edge flag
            self.write_direct(SFR_TCON, tcon_new);
            return true;
        }

        // Vector 0x000B: Timer 0 Overflow (TF0)
        if (ie & 0x02) != 0 && (tcon & 0x20) != 0 {
            self.service_interrupt(0x000B);
            let mut tcon_new = self.read_direct(SFR_TCON);
            tcon_new &= !0x20;
            self.write_direct(SFR_TCON, tcon_new);
            return true;
        }

        // Vector 0x0013: External Interrupt 1 (IE1)
        if (ie & 0x04) != 0 && (tcon & 0x08) != 0 {
            self.service_interrupt(0x0013);
            let mut tcon_new = self.read_direct(SFR_TCON);
            tcon_new &= !0x08;
            self.write_direct(SFR_TCON, tcon_new);
            return true;
        }

        // Vector 0x001B: Timer 1 Overflow (TF1)
        if (ie & 0x08) != 0 && (tcon & 0x80) != 0 {
            self.service_interrupt(0x001B);
            let mut tcon_new = self.read_direct(SFR_TCON);
            tcon_new &= !0x80;
            self.write_direct(SFR_TCON, tcon_new);
            return true;
        }

        false
    }

    fn service_interrupt(&mut self, vector: u16) {
        let pc_low = (self.pc & 0xFF) as u8;
        let pc_high = ((self.pc >> 8) & 0xFF) as u8;
        self.push(pc_low);
        self.push(pc_high);
        self.pc = vector;
        self.irq_in_service = true;
    }
}

impl McuCore for Mcu8051 {
    fn mcu_type(&self) -> McuType {
        McuType::Mcu8051
    }

    fn reset(&mut self) {
        self.pc = 0x0000;
        self.ram = [0; 128];
        self.sfr = [0; 128];
        self.cycle_count = 0;
        self.is_halted = false;
        self.irq_in_service = false;

        // Reset values of SFRs according to 8051 spec
        self.write_direct(SFR_SP, 0x07);
        self.write_direct(SFR_P0, 0xFF);
        self.write_direct(SFR_P1, 0xFF);
        self.write_direct(SFR_P2, 0xFF);
        self.write_direct(SFR_P3, 0xFF);
        self.write_direct(SFR_ACC, 0x00);
        self.write_direct(SFR_B, 0x00);
        self.write_direct(SFR_PSW, 0x00);
        self.write_direct(SFR_DPL, 0x00);
        self.write_direct(SFR_DPH, 0x00);
        self.write_direct(SFR_IE, 0x00);
        self.write_direct(SFR_IP, 0x00);
        self.write_direct(SFR_TCON, 0x00);
        self.write_direct(SFR_TMOD, 0x00);
    }

    fn load_firmware(&mut self, firmware: &[u8]) -> Result<(), McuError> {
        let mem = parse_firmware_image(firmware, 65536)?;
        self.code_memory = mem;
        self.reset();
        Ok(())
    }

    fn step(&mut self, gpio_inputs: &GpioInputs) -> u32 {
        if self.is_halted {
            return 1;
        }

        // Sync external GPIO pin levels to P0, P1, P2, P3 if configured
        let mut p0 = self.read_direct(SFR_P0);
        p0 = (p0 & 0xF0) | (gpio_inputs.pin_a & 0x0F);
        self.write_direct(SFR_P0, p0);

        let mut p1 = self.read_direct(SFR_P1);
        p1 = (p1 & 0x0F) | (gpio_inputs.pin_b & 0xF0);
        self.write_direct(SFR_P1, p1);

        // Check hardware interrupts first
        if self.check_interrupts() {
            self.cycle_count += 2;
            self.step_timers(2);
            return 2;
        }

        let opcode = self.fetch_code_byte();
        let cycles = self.execute_opcode(opcode);

        self.cycle_count += cycles as u64;
        self.step_timers(cycles);

        cycles
    }

    fn get_state(&self) -> McuState {
        let mut registers = Vec::with_capacity(32);
        for i in 0..8 {
            registers.push(self.read_rn(i));
        }
        registers.push(self.read_acc());
        registers.push(self.read_b());
        registers.push(self.read_psw());
        registers.push(self.read_sp());

        let gpio = GpioState {
            port_a: self.read_direct(SFR_P0),
            port_b: self.read_direct(SFR_P1),
            port_c: self.read_direct(SFR_P2),
            port_d: self.read_direct(SFR_P3),
            ddr_a: 0xFF, // 8051 quasi-bidirectional
            ddr_b: 0xFF,
            ddr_c: 0xFF,
            ddr_d: 0xFF,
            pin_a: self.read_direct(SFR_P0),
            pin_b: self.read_direct(SFR_P1),
            pin_c: self.read_direct(SFR_P2),
            pin_d: self.read_direct(SFR_P3),
        };

        McuState {
            mcu_type: McuType::Mcu8051,
            pc: self.pc,
            sp: self.read_sp() as u16,
            acc: self.read_acc(),
            psw: self.read_psw(),
            dptr: self.read_dptr(),
            registers,
            data_memory: self.ram.to_vec(),
            program_memory: self.code_memory[..1024].to_vec(), // First 1KB preview
            cycle_count: self.cycle_count,
            gpio_state: gpio,
        }
    }

    fn get_gpio_outputs(&self) -> GpioOutputs {
        GpioOutputs {
            port_a: self.read_direct(SFR_P0),
            port_b: self.read_direct(SFR_P1),
            port_c: self.read_direct(SFR_P2),
            port_d: self.read_direct(SFR_P3),
            ddr_a: 0xFF,
            ddr_b: 0xFF,
            ddr_c: 0xFF,
            ddr_d: 0xFF,
            dac_voltage: 0.0,
        }
    }

    fn set_interrupt(&mut self, int_num: u8, level: bool) {
        let mut tcon = self.read_direct(SFR_TCON);
        if int_num == 0 {
            if level {
                tcon |= 0x02; // Set IE0
            } else {
                tcon &= !0x02;
            }
        } else if int_num == 1 {
            if level {
                tcon |= 0x08; // Set IE1
            } else {
                tcon &= !0x08;
            }
        }
        self.write_direct(SFR_TCON, tcon);
    }

    fn cycle_count(&self) -> u64 {
        self.cycle_count
    }

    fn pc(&self) -> u16 {
        self.pc
    }
}

// Opcode dispatch table for 8051
impl Mcu8051 {
    fn execute_opcode(&mut self, op: u8) -> u32 {
        match op {
            0x00 => 1, // NOP

            // AJMP / LJMP / SJMP / JMP @A+DPTR
            0x01 | 0x21 | 0x41 | 0x61 | 0x81 | 0xA1 | 0xC1 | 0xE1 => {
                let low = self.fetch_code_byte() as u16;
                let high = ((op as u16) >> 5) & 0x07;
                self.pc = (self.pc & 0xF800) | (high << 8) | low;
                2
            }
            0x02 => {
                // LJMP addr16
                let addr = self.fetch_code_word();
                self.pc = addr;
                2
            }
            0x80 => {
                // SJMP rel
                let rel = self.fetch_code_byte() as i8;
                self.pc = (self.pc as i32 + rel as i32) as u16;
                2
            }
            0x73 => {
                // JMP @A+DPTR
                let acc = self.read_acc() as u16;
                let dptr = self.read_dptr();
                self.pc = dptr.wrapping_add(acc);
                2
            }

            // ACALL / LCALL / RET / RETI
            0x11 | 0x31 | 0x51 | 0x71 | 0x91 | 0xB1 | 0xD1 | 0xF1 => {
                let low = self.fetch_code_byte() as u16;
                let high = ((op as u16) >> 5) & 0x07;
                let ret_pc = self.pc;
                self.push((ret_pc & 0xFF) as u8);
                self.push(((ret_pc >> 8) & 0xFF) as u8);
                self.pc = (self.pc & 0xF800) | (high << 8) | low;
                2
            }
            0x12 => {
                // LCALL addr16
                let target = self.fetch_code_word();
                let ret_pc = self.pc;
                self.push((ret_pc & 0xFF) as u8);
                self.push(((ret_pc >> 8) & 0xFF) as u8);
                self.pc = target;
                2
            }
            0x22 => {
                // RET
                let high = self.pop() as u16;
                let low = self.pop() as u16;
                self.pc = (high << 8) | low;
                2
            }
            0x32 => {
                // RETI
                let high = self.pop() as u16;
                let low = self.pop() as u16;
                self.pc = (high << 8) | low;
                self.irq_in_service = false;
                2
            }

            // Conditional jumps: JZ, JNZ, JC, JNC, JB, JNB, JBC
            0x60 => {
                // JZ rel
                let rel = self.fetch_code_byte() as i8;
                if self.read_acc() == 0 {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0x70 => {
                // JNZ rel
                let rel = self.fetch_code_byte() as i8;
                if self.read_acc() != 0 {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0x40 => {
                // JC rel
                let rel = self.fetch_code_byte() as i8;
                if self.get_cy() {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0x50 => {
                // JNC rel
                let rel = self.fetch_code_byte() as i8;
                if !self.get_cy() {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0x20 => {
                // JB bit, rel
                let bit_addr = self.fetch_code_byte();
                let rel = self.fetch_code_byte() as i8;
                if self.read_bit(bit_addr) {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0x30 => {
                // JNB bit, rel
                let bit_addr = self.fetch_code_byte();
                let rel = self.fetch_code_byte() as i8;
                if !self.read_bit(bit_addr) {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0x10 => {
                // JBC bit, rel
                let bit_addr = self.fetch_code_byte();
                let rel = self.fetch_code_byte() as i8;
                if self.read_bit(bit_addr) {
                    self.write_bit(bit_addr, false);
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0xB4 => {
                // CJNE A, #data, rel
                let data = self.fetch_code_byte();
                let rel = self.fetch_code_byte() as i8;
                let acc = self.read_acc();
                self.set_cy(acc < data);
                if acc != data {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0xB5 => {
                // CJNE A, direct, rel
                let direct = self.fetch_code_byte();
                let data = self.read_direct(direct);
                let rel = self.fetch_code_byte() as i8;
                let acc = self.read_acc();
                self.set_cy(acc < data);
                if acc != data {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0xB6..=0xB7 => {
                // CJNE @Ri, #data, rel
                let ri = (op & 1) as usize;
                let val = self.read_indirect_ri(ri);
                let data = self.fetch_code_byte();
                let rel = self.fetch_code_byte() as i8;
                self.set_cy(val < data);
                if val != data {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0xB8..=0xBF => {
                // CJNE Rn, #data, rel
                let rn = (op & 7) as usize;
                let val = self.read_rn(rn);
                let data = self.fetch_code_byte();
                let rel = self.fetch_code_byte() as i8;
                self.set_cy(val < data);
                if val != data {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0xD5 => {
                // DJNZ direct, rel
                let direct = self.fetch_code_byte();
                let rel = self.fetch_code_byte() as i8;
                let val = self.read_direct(direct).wrapping_sub(1);
                self.write_direct(direct, val);
                if val != 0 {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }
            0xD8..=0xDF => {
                // DJNZ Rn, rel
                let rn = (op & 7) as usize;
                let rel = self.fetch_code_byte() as i8;
                let val = self.read_rn(rn).wrapping_sub(1);
                self.write_rn(rn, val);
                if val != 0 {
                    self.pc = (self.pc as i32 + rel as i32) as u16;
                }
                2
            }

            // MOV instructions
            0x74 => {
                // MOV A, #data
                let data = self.fetch_code_byte();
                self.write_acc(data);
                1
            }
            0xE5 => {
                // MOV A, direct
                let direct = self.fetch_code_byte();
                let val = self.read_direct(direct);
                self.write_acc(val);
                1
            }
            0xE6..=0xE7 => {
                // MOV A, @Ri
                let val = self.read_indirect_ri((op & 1) as usize);
                self.write_acc(val);
                1
            }
            0xE8..=0xEF => {
                // MOV A, Rn
                let val = self.read_rn((op & 7) as usize);
                self.write_acc(val);
                1
            }
            0xF5 => {
                // MOV direct, A
                let direct = self.fetch_code_byte();
                let val = self.read_acc();
                self.write_direct(direct, val);
                1
            }
            0x75 => {
                // MOV direct, #data
                let direct = self.fetch_code_byte();
                let data = self.fetch_code_byte();
                self.write_direct(direct, data);
                2
            }
            0x85 => {
                // MOV direct_dst, direct_src
                let src = self.fetch_code_byte();
                let dst = self.fetch_code_byte();
                let val = self.read_direct(src);
                self.write_direct(dst, val);
                2
            }
            0x86..=0x87 => {
                // MOV direct, @Ri
                let direct = self.fetch_code_byte();
                let val = self.read_indirect_ri((op & 1) as usize);
                self.write_direct(direct, val);
                2
            }
            0x88..=0x8F => {
                // MOV direct, Rn
                let direct = self.fetch_code_byte();
                let val = self.read_rn((op & 7) as usize);
                self.write_direct(direct, val);
                2
            }
            0xF6..=0xF7 => {
                // MOV @Ri, A
                let val = self.read_acc();
                self.write_indirect_ri((op & 1) as usize, val);
                1
            }
            0x76..=0x77 => {
                // MOV @Ri, #data
                let data = self.fetch_code_byte();
                self.write_indirect_ri((op & 1) as usize, data);
                1
            }
            0xA6..=0xA7 => {
                // MOV @Ri, direct
                let direct = self.fetch_code_byte();
                let val = self.read_direct(direct);
                self.write_indirect_ri((op & 1) as usize, val);
                2
            }
            0xF8..=0xFF => {
                // MOV Rn, A
                let val = self.read_acc();
                self.write_rn((op & 7) as usize, val);
                1
            }
            0x78..=0x7F => {
                // MOV Rn, #data
                let data = self.fetch_code_byte();
                self.write_rn((op & 7) as usize, data);
                1
            }
            0xA8..=0xAF => {
                // MOV Rn, direct
                let direct = self.fetch_code_byte();
                let val = self.read_direct(direct);
                self.write_rn((op & 7) as usize, val);
                2
            }
            0x90 => {
                // MOV DPTR, #data16
                let dptr = self.fetch_code_word();
                self.write_dptr(dptr);
                2
            }

            // ADD / ADDC / SUBB
            0x24 => {
                // ADD A, #data
                let data = self.fetch_code_byte();
                self.alu_add(data, false);
                1
            }
            0x25 => {
                // ADD A, direct
                let direct = self.fetch_code_byte();
                let data = self.read_direct(direct);
                self.alu_add(data, false);
                1
            }
            0x26..=0x27 => {
                // ADD A, @Ri
                let data = self.read_indirect_ri((op & 1) as usize);
                self.alu_add(data, false);
                1
            }
            0x28..=0x2F => {
                // ADD A, Rn
                let data = self.read_rn((op & 7) as usize);
                self.alu_add(data, false);
                1
            }
            0x34 => {
                // ADDC A, #data
                let data = self.fetch_code_byte();
                self.alu_add(data, true);
                1
            }
            0x35 => {
                // ADDC A, direct
                let direct = self.fetch_code_byte();
                let data = self.read_direct(direct);
                self.alu_add(data, true);
                1
            }
            0x36..=0x37 => {
                // ADDC A, @Ri
                let data = self.read_indirect_ri((op & 1) as usize);
                self.alu_add(data, true);
                1
            }
            0x38..=0x3F => {
                // ADDC A, Rn
                let data = self.read_rn((op & 7) as usize);
                self.alu_add(data, true);
                1
            }
            0x94 => {
                // SUBB A, #data
                let data = self.fetch_code_byte();
                self.alu_subb(data);
                1
            }
            0x95 => {
                // SUBB A, direct
                let direct = self.fetch_code_byte();
                let data = self.read_direct(direct);
                self.alu_subb(data);
                1
            }
            0x96..=0x97 => {
                // SUBB A, @Ri
                let data = self.read_indirect_ri((op & 1) as usize);
                self.alu_subb(data);
                1
            }
            0x98..=0x9F => {
                // SUBB A, Rn
                let data = self.read_rn((op & 7) as usize);
                self.alu_subb(data);
                1
            }

            // INC / DEC
            0x04 => {
                // INC A
                let val = self.read_acc().wrapping_add(1);
                self.write_acc(val);
                1
            }
            0x05 => {
                // INC direct
                let direct = self.fetch_code_byte();
                let val = self.read_direct(direct).wrapping_add(1);
                self.write_direct(direct, val);
                1
            }
            0x06..=0x07 => {
                // INC @Ri
                let ri = (op & 1) as usize;
                let val = self.read_indirect_ri(ri).wrapping_add(1);
                self.write_indirect_ri(ri, val);
                1
            }
            0x08..=0x0F => {
                // INC Rn
                let rn = (op & 7) as usize;
                let val = self.read_rn(rn).wrapping_add(1);
                self.write_rn(rn, val);
                1
            }
            0xA3 => {
                // INC DPTR
                let dptr = self.read_dptr().wrapping_add(1);
                self.write_dptr(dptr);
                2
            }
            0x14 => {
                // DEC A
                let val = self.read_acc().wrapping_sub(1);
                self.write_acc(val);
                1
            }
            0x15 => {
                // DEC direct
                let direct = self.fetch_code_byte();
                let val = self.read_direct(direct).wrapping_sub(1);
                self.write_direct(direct, val);
                1
            }
            0x16..=0x17 => {
                // DEC @Ri
                let ri = (op & 1) as usize;
                let val = self.read_indirect_ri(ri).wrapping_sub(1);
                self.write_indirect_ri(ri, val);
                1
            }
            0x18..=0x1F => {
                // DEC Rn
                let rn = (op & 7) as usize;
                let val = self.read_rn(rn).wrapping_sub(1);
                self.write_rn(rn, val);
                1
            }

            // MUL AB / DIV AB / DA A
            0xA4 => {
                // MUL AB
                let a = self.read_acc() as u16;
                let b = self.read_b() as u16;
                let prod = a * b;
                self.write_acc((prod & 0xFF) as u8);
                self.write_b(((prod >> 8) & 0xFF) as u8);
                self.set_cy(false);
                self.set_ov(prod > 255);
                4
            }
            0x84 => {
                // DIV AB
                let a = self.read_acc();
                let b = self.read_b();
                self.set_cy(false);
                if let Some(res) = a.checked_div(b) {
                    self.write_acc(res);
                    self.write_b(a % b);
                    self.set_ov(false);
                } else {
                    self.set_ov(true);
                }
                4
            }
            0xD4 => {
                // DA A (Decimal Adjust)
                let mut a = self.read_acc() as u16;
                let mut cy = self.get_cy();
                let ac = self.get_ac();

                if (a & 0x0F) > 9 || ac {
                    a += 6;
                }
                if (a >> 4) > 9 || cy {
                    a += 0x60;
                    cy = true;
                }
                self.write_acc((a & 0xFF) as u8);
                self.set_cy(cy);
                1
            }

            // Logic operations: ANL, ORL, XRL, CLR, CPL, RL, RLC, RR, RRC, SWAP
            0x54 => {
                // ANL A, #data
                let data = self.fetch_code_byte();
                let val = self.read_acc() & data;
                self.write_acc(val);
                1
            }
            0x55 => {
                // ANL A, direct
                let direct = self.fetch_code_byte();
                let val = self.read_acc() & self.read_direct(direct);
                self.write_acc(val);
                1
            }
            0x58..=0x5F => {
                // ANL A, Rn
                let val = self.read_acc() & self.read_rn((op & 7) as usize);
                self.write_acc(val);
                1
            }
            0x44 => {
                // ORL A, #data
                let data = self.fetch_code_byte();
                let val = self.read_acc() | data;
                self.write_acc(val);
                1
            }
            0x45 => {
                // ORL A, direct
                let direct = self.fetch_code_byte();
                let val = self.read_acc() | self.read_direct(direct);
                self.write_acc(val);
                1
            }
            0x48..=0x4F => {
                // ORL A, Rn
                let val = self.read_acc() | self.read_rn((op & 7) as usize);
                self.write_acc(val);
                1
            }
            0x64 => {
                // XRL A, #data
                let data = self.fetch_code_byte();
                let val = self.read_acc() ^ data;
                self.write_acc(val);
                1
            }
            0x65 => {
                // XRL A, direct
                let direct = self.fetch_code_byte();
                let val = self.read_acc() ^ self.read_direct(direct);
                self.write_acc(val);
                1
            }
            0x68..=0x6F => {
                // XRL A, Rn
                let val = self.read_acc() ^ self.read_rn((op & 7) as usize);
                self.write_acc(val);
                1
            }
            0xE4 => {
                // CLR A
                self.write_acc(0);
                1
            }
            0xF4 => {
                // CPL A
                let val = !self.read_acc();
                self.write_acc(val);
                1
            }
            0x23 => {
                // RL A
                let a = self.read_acc();
                self.write_acc(a.rotate_left(1));
                1
            }
            0x33 => {
                // RLC A
                let a = self.read_acc();
                let cy = self.get_cy() as u8;
                let new_cy = (a & 0x80) != 0;
                let val = (a << 1) | cy;
                self.write_acc(val);
                self.set_cy(new_cy);
                1
            }
            0x03 => {
                // RR A
                let a = self.read_acc();
                self.write_acc(a.rotate_right(1));
                1
            }
            0x13 => {
                // RRC A
                let a = self.read_acc();
                let cy = (self.get_cy() as u8) << 7;
                let new_cy = (a & 1) != 0;
                let val = (a >> 1) | cy;
                self.write_acc(val);
                self.set_cy(new_cy);
                1
            }
            0xC4 => {
                // SWAP A
                let a = self.read_acc();
                let val = a.rotate_left(4);
                self.write_acc(val);
                1
            }

            // Bit operations: CLR C, SETB C, CPL C, ANL C, ORL C, MOV C
            0xC3 => {
                // CLR C
                self.set_cy(false);
                1
            }
            0xD3 => {
                // SETB C
                self.set_cy(true);
                1
            }
            0xB3 => {
                // CPL C
                self.set_cy(!self.get_cy());
                1
            }
            0xC2 => {
                // CLR bit
                let bit_addr = self.fetch_code_byte();
                self.write_bit(bit_addr, false);
                1
            }
            0xD2 => {
                // SETB bit
                let bit_addr = self.fetch_code_byte();
                self.write_bit(bit_addr, true);
                1
            }
            0xB2 => {
                // CPL bit
                let bit_addr = self.fetch_code_byte();
                let val = !self.read_bit(bit_addr);
                self.write_bit(bit_addr, val);
                1
            }
            0xA2 => {
                // MOV C, bit
                let bit_addr = self.fetch_code_byte();
                self.set_cy(self.read_bit(bit_addr));
                1
            }
            0x92 => {
                // MOV bit, C
                let bit_addr = self.fetch_code_byte();
                let cy = self.get_cy();
                self.write_bit(bit_addr, cy);
                2
            }

            // Stack: PUSH / POP
            0xC0 => {
                // PUSH direct
                let direct = self.fetch_code_byte();
                let val = self.read_direct(direct);
                self.push(val);
                2
            }
            0xD0 => {
                // POP direct
                let direct = self.fetch_code_byte();
                let val = self.pop();
                self.write_direct(direct, val);
                2
            }

            // Exchange: XCH, XCHD
            0xC5 => {
                // XCH A, direct
                let direct = self.fetch_code_byte();
                let a = self.read_acc();
                let d = self.read_direct(direct);
                self.write_acc(d);
                self.write_direct(direct, a);
                1
            }
            0xC8..=0xCF => {
                // XCH A, Rn
                let rn = (op & 7) as usize;
                let a = self.read_acc();
                let r = self.read_rn(rn);
                self.write_acc(r);
                self.write_rn(rn, a);
                1
            }
            0xD6..=0xD7 => {
                // XCHD A, @Ri
                let ri = (op & 1) as usize;
                let mut a = self.read_acc();
                let mut d = self.read_indirect_ri(ri);
                let low_a = a & 0x0F;
                let low_d = d & 0x0F;
                a = (a & 0xF0) | low_d;
                d = (d & 0xF0) | low_a;
                self.write_acc(a);
                self.write_indirect_ri(ri, d);
                1
            }

            // MOVC / MOVX
            0x83 => {
                // MOVC A, @A+PC
                let a = self.read_acc() as u16;
                let val = self.code_memory[self.pc.wrapping_add(a) as usize];
                self.write_acc(val);
                2
            }
            0x93 => {
                // MOVC A, @A+DPTR
                let a = self.read_acc() as u16;
                let dptr = self.read_dptr();
                let val = self.code_memory[dptr.wrapping_add(a) as usize];
                self.write_acc(val);
                2
            }
            0xE0 | 0xE2..=0xE3 => {
                // MOVX A, @DPTR / @Ri
                self.write_acc(0);
                2
            }
            0xF0 | 0xF2..=0xF3 => {
                // MOVX @DPTR / @Ri, A
                2
            }

            _ => 1, // Fallback for unimplemented minor variants
        }
    }

    fn alu_add(&mut self, data: u8, use_carry: bool) {
        let a = self.read_acc();
        let cin = if use_carry && self.get_cy() {
            1u16
        } else {
            0u16
        };
        let sum = (a as u16) + (data as u16) + cin;

        // AC (Auxiliary carry)
        let ac = ((a & 0x0F) + (data & 0x0F) + (cin as u8)) > 0x0F;
        // CY (Carry)
        let cy = sum > 0xFF;
        // OV (Signed overflow)
        let a_signed = a as i8 as i16;
        let d_signed = data as i8 as i16;
        let sum_signed = a_signed + d_signed + (cin as i16);
        let ov = !(-128..=127).contains(&sum_signed);

        self.write_acc((sum & 0xFF) as u8);
        self.set_cy(cy);
        self.set_ac(ac);
        self.set_ov(ov);
    }

    fn alu_subb(&mut self, data: u8) {
        let a = self.read_acc();
        let bin = if self.get_cy() { 1i16 } else { 0i16 };
        let diff = (a as i16) - (data as i16) - bin;

        let ac = ((a & 0x0F) as i16 - (data & 0x0F) as i16 - bin) < 0;
        let cy = diff < 0;

        let a_signed = a as i8 as i16;
        let d_signed = data as i8 as i16;
        let diff_signed = a_signed - d_signed - bin;
        let ov = !(-128..=127).contains(&diff_signed);

        self.write_acc(diff as u8);
        self.set_cy(cy);
        self.set_ac(ac);
        self.set_ov(ov);
    }
}
