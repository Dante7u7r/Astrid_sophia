import { describe, expect, it } from "vitest";
import {
  createPic16,
  readPicRegister,
  stepPic16,
  writePicRegister,
  PIC_PORTA,
  PIC_PORTB,
  PIC_STATUS,
  STATUS_Z,
  STATUS_C,
} from "./mcu-pic";

describe("mcu-pic (PIC16F84A RISC Emulator)", () => {
  it("ejecuta instrucciones literales MOVLW y ADDLW actualizando flags", () => {
    const pic = createPic16();

    // 0x3025: MOVLW 0x25
    pic.flash[0] = 0x3025;
    stepPic16(pic);
    expect(pic.w).toBe(0x25);
    expect(pic.pc).toBe(1);

    // 0x3E15: ADDLW 0x15 -> W = 0x3A
    pic.flash[1] = 0x3e15;
    stepPic16(pic);
    expect(pic.w).toBe(0x3a);
    expect(pic.ram[PIC_STATUS] & STATUS_Z).toBe(0);
  });

  it("escribe y lee registros de I/O (PORTA, PORTB)", () => {
    const pic = createPic16();

    // MOVLW 0x55
    pic.flash[0] = 0x3055;
    stepPic16(pic);

    // MOVWF PORTB (0x0086)
    pic.flash[1] = 0x0086;
    stepPic16(pic);

    expect(readPicRegister(pic, PIC_PORTB)).toBe(0x55);
  });

  it("ejecuta operaciones orientadas a bits BSF y BCF", () => {
    const pic = createPic16();

    // BSF PORTA, 2 (0x1505)
    pic.flash[0] = 0x1505;
    stepPic16(pic);
    expect(readPicRegister(pic, PIC_PORTA)).toBe(0x04);

    // BCF PORTA, 2 (0x1105)
    pic.flash[1] = 0x1105;
    stepPic16(pic);
    expect(readPicRegister(pic, PIC_PORTA)).toBe(0x00);
  });

  it("maneja saltos condicionales BTFSS y bucles GOTO", () => {
    const pic = createPic16();

    // BSF PORTB, 0 -> PORTB.0 = 1
    pic.flash[0] = 0x1406;
    stepPic16(pic);

    // BTFSS PORTB, 0 (Salta la siguiente instrucción si PORTB.0 es 1) (0x1C06)
    pic.flash[1] = 0x1c06;
    stepPic16(pic);
    expect(pic.pc).toBe(3); // Saltó la instrucción en 2
  });

  it("gestiona llamadas a subrutinas CALL y retorno RETURN con la pila hardware", () => {
    const pic = createPic16();

    // CALL 0x020 (0x2020)
    pic.flash[0] = 0x2020;
    stepPic16(pic);
    expect(pic.pc).toBe(0x020);
    expect(pic.stack.length).toBe(1);
    expect(pic.stack[0]).toBe(1);

    // RETURN (0x0008)
    pic.flash[0x020] = 0x0008;
    stepPic16(pic);
    expect(pic.pc).toBe(1);
    expect(pic.stack.length).toBe(0);
  });
});
