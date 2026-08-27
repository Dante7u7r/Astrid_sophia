//! Comprehensive test suite for 8051 and AVR ATmega328P ISA and peripherals

#[cfg(test)]
mod tests {
    use crate::mcu::{
        atmega328p::{Atmega328p, IO_DDRB, IO_PORTB, SREG_C, SREG_Z},
        mcu8051::{Mcu8051, SFR_B},
        GpioInputs, McuCore,
    };

    #[test]
    fn test_8051_arithmetic_add_flags() {
        let mut mcu = Mcu8051::new();
        // MOV A, #0x7F; ADD A, #0x01
        mcu.code_memory[0] = 0x74;
        mcu.code_memory[1] = 0x7F;
        mcu.code_memory[2] = 0x24;
        mcu.code_memory[3] = 0x01;

        let inputs = GpioInputs::default();
        mcu.step(&inputs); // MOV A, #0x7F
        mcu.step(&inputs); // ADD A, #0x01

        assert_eq!(mcu.read_acc(), 0x80);
        assert!(
            mcu.get_ov(),
            "OV flag should be set for positive+positive = negative"
        );
        assert!(mcu.get_ac(), "AC flag should be set for nibble carry");
        assert!(!mcu.get_cy(), "CY should not be set");
    }

    #[test]
    fn test_8051_arithmetic_subb_borrow() {
        let mut mcu = Mcu8051::new();
        // MOV A, #0x00; SETB C; SUBB A, #0x01 => A = 0xFE, CY = 1
        mcu.code_memory[0] = 0x74;
        mcu.code_memory[1] = 0x00;
        mcu.code_memory[2] = 0xD3; // SETB C
        mcu.code_memory[3] = 0x94; // SUBB A, #0x01
        mcu.code_memory[4] = 0x01;

        let inputs = GpioInputs::default();
        mcu.step(&inputs);
        mcu.step(&inputs);
        mcu.step(&inputs);

        assert_eq!(mcu.read_acc(), 0xFE);
        assert!(mcu.get_cy(), "CY should be set on borrow");
    }

    #[test]
    fn test_8051_mul_div() {
        let mut mcu = Mcu8051::new();
        // MOV A, #0x12; MOV B, #0x34; MUL AB
        mcu.code_memory[0] = 0x74;
        mcu.code_memory[1] = 0x12; // MOV A, #18
        mcu.code_memory[2] = 0x75;
        mcu.code_memory[3] = SFR_B;
        mcu.code_memory[4] = 0x34; // MOV B, #52
        mcu.code_memory[5] = 0xA4; // MUL AB (18 * 52 = 936 = 0x03A8)

        let inputs = GpioInputs::default();
        mcu.step(&inputs);
        mcu.step(&inputs);
        mcu.step(&inputs);

        assert_eq!(mcu.read_acc(), 0xA8);
        assert_eq!(mcu.read_b(), 0x03);
        assert!(mcu.get_ov(), "OV should be set for product > 255");
    }

    #[test]
    fn test_8051_call_ret() {
        let mut mcu = Mcu8051::new();
        // 0x0000: LCALL 0x0010
        // 0x0003: MOV A, #0x55
        // 0x0010: MOV R0, #0xAA; RET
        mcu.code_memory[0x0000] = 0x12;
        mcu.code_memory[0x0001] = 0x00;
        mcu.code_memory[0x0002] = 0x10;
        mcu.code_memory[0x0003] = 0x74;
        mcu.code_memory[0x0004] = 0x55;

        mcu.code_memory[0x0010] = 0x78; // MOV R0, #0xAA
        mcu.code_memory[0x0011] = 0xAA;
        mcu.code_memory[0x0012] = 0x22; // RET

        let inputs = GpioInputs::default();
        mcu.step(&inputs); // LCALL 0x0010
        assert_eq!(mcu.pc, 0x0010);

        mcu.step(&inputs); // MOV R0, #0xAA
        assert_eq!(mcu.read_rn(0), 0xAA);

        mcu.step(&inputs); // RET
        assert_eq!(mcu.pc, 0x0003);

        mcu.step(&inputs); // MOV A, #0x55
        assert_eq!(mcu.read_acc(), 0x55);
    }

    #[test]
    fn test_8051_djnz_loop() {
        let mut mcu = Mcu8051::new();
        // MOV R2, #0x03
        // LOOP: DJNZ R2, LOOP (-2)
        mcu.code_memory[0] = 0x7A;
        mcu.code_memory[1] = 0x03;
        mcu.code_memory[2] = 0xDA;
        mcu.code_memory[3] = 0xFE; // -2 relative

        let inputs = GpioInputs::default();
        mcu.step(&inputs); // MOV R2, #3
        assert_eq!(mcu.read_rn(2), 3);

        mcu.step(&inputs); // DJNZ -> R2 = 2, jump
        assert_eq!(mcu.read_rn(2), 2);
        assert_eq!(mcu.pc, 2);

        mcu.step(&inputs); // DJNZ -> R2 = 1, jump
        assert_eq!(mcu.read_rn(2), 1);
        assert_eq!(mcu.pc, 2);

        mcu.step(&inputs); // DJNZ -> R2 = 0, fall through
        assert_eq!(mcu.read_rn(2), 0);
        assert_eq!(mcu.pc, 4);
    }

    #[test]
    fn test_avr_ldi_mov_add() {
        let mut mcu = Atmega328p::new();
        // LDI R16, 0x10 (0xE100)
        // LDI R17, 0x20 (0xE210)
        // ADD R16, R17 (0x0F01)
        mcu.flash[0] = 0x00;
        mcu.flash[1] = 0xE1;
        mcu.flash[2] = 0x10;
        mcu.flash[3] = 0xE2;
        mcu.flash[4] = 0x01;
        mcu.flash[5] = 0x0F;

        let inputs = GpioInputs::default();
        mcu.step(&inputs); // LDI R16, 0x10
        mcu.step(&inputs); // LDI R17, 0x20
        mcu.step(&inputs); // ADD R16, R17

        assert_eq!(mcu.regs[16], 0x30);
        assert!(!mcu.get_flag(SREG_C));
        assert!(!mcu.get_flag(SREG_Z));
    }

    #[test]
    fn test_avr_subi_flags() {
        let mut mcu = Atmega328p::new();
        // LDI R16, 0x05 (0xE005)
        // SUBI R16, 0x05 (0x5005)
        mcu.flash[0] = 0x05;
        mcu.flash[1] = 0xE0;
        mcu.flash[2] = 0x05;
        mcu.flash[3] = 0x50;

        let inputs = GpioInputs::default();
        mcu.step(&inputs);
        mcu.step(&inputs);

        assert_eq!(mcu.regs[16], 0x00);
        assert!(mcu.get_flag(SREG_Z), "Zero flag should be set for 5 - 5");
        assert!(!mcu.get_flag(SREG_C));
    }

    #[test]
    fn test_avr_gpio_out_in() {
        let mut mcu = Atmega328p::new();
        // LDI R16, 0xFF
        // OUT DDRB, R16 (0xBB04)
        // OUT PORTB, R16 (0xBB05)
        mcu.flash[0] = 0x0F;
        mcu.flash[1] = 0xEF; // LDI R16, 0xFF
        mcu.flash[2] = 0x04;
        mcu.flash[3] = 0xB9; // OUT 0x04, R16 (DDRB)
        mcu.flash[4] = 0x05;
        mcu.flash[5] = 0xB9; // OUT 0x05, R16 (PORTB)

        let inputs = GpioInputs::default();
        mcu.step(&inputs);
        mcu.step(&inputs);
        mcu.step(&inputs);

        assert_eq!(mcu.io[IO_DDRB as usize], 0xFF);
        assert_eq!(mcu.io[IO_PORTB as usize], 0xFF);
    }

    #[test]
    fn test_avr_rcall_ret() {
        let mut mcu = Atmega328p::new();
        // Word 0: RCALL +2 (0xD002 -> jumps to word 3)
        // Word 1: NOP (0x0000)
        // Word 2: NOP (0x0000)
        // Word 3: LDI R16, 0x77 (0xE707)
        // Word 4: RET (0x9508)
        mcu.flash[0] = 0x02;
        mcu.flash[1] = 0xD0;
        mcu.flash[2] = 0x00;
        mcu.flash[3] = 0x00;
        mcu.flash[4] = 0x00;
        mcu.flash[5] = 0x00;
        mcu.flash[6] = 0x07;
        mcu.flash[7] = 0xE7;
        mcu.flash[8] = 0x08;
        mcu.flash[9] = 0x95;

        let inputs = GpioInputs::default();
        mcu.step(&inputs); // RCALL
        assert_eq!(mcu.pc, 3);

        mcu.step(&inputs); // LDI R16, 0x77
        assert_eq!(mcu.regs[16], 0x77);

        mcu.step(&inputs); // RET
        assert_eq!(mcu.pc, 1);
    }
}
