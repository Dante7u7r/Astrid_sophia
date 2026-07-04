# Guion de demostración (15 minutos)

## Preparación (antes de la reunión)

1. Ejecutar `npm run tauri dev` (no usar solo el navegador: el mock IPC no ejecuta el solver Rust real).
2. Verificar que `cargo test` y `npm test` pasan en la máquina de demo.
3. Tener esta carpeta `public/demos/` accesible; usar el botón **Demos** en la barra superior.

## 1. Introducción (2 min)

- Astryd Sophia: editor esquemático + solver MNA en Rust + osciloscopio integrado.
- Stack: Tauri 2, TypeScript/Canvas, co-simulación MCU (transitorio).

## 2. Divisor RC — DC y transitorio (3 min)

1. Clic en **Demos → Divisor RC**.
2. Modo **Análisis CC** → **Simular**: mostrar voltajes en nodos sobre el canvas (~2.5 V en el nodo intermedio).
3. Cambiar a **Transitorio** → **Simular**: abrir osciloscopio, mostrar carga del condensador.
4. Mensaje clave: convergencia básica y visualización en vivo.

## 3. Puente rectificador — no linealidad (3 min)

1. **Demos → Puente rectificador** (modo Transitorio precargado).
2. Simular y mostrar forma de onda rectificada en CH1.
3. Mencionar FFT/THD como capacidad avanzada del motor (opcional si hay tiempo).

## 4. Blink MCU — co-simulación (4 min)

1. **Demos → Blink Arduino**.
2. Explicar cadena: GPIO digital → resistencia → LED.
3. Simular en transitorio; señalar actuador LED y panel MCU si está disponible.
4. Nota: cargar firmware hex en el panel MCU para parpadeo cycle-accurate completo.

## 5. Amplificador BJT — AC / Bode (3 min)

1. **Demos → Amp BJT Bode** (modo AC precargado).
2. Simular y mostrar curva de Bode en el osciloscopio.
3. Cerrar con análisis de estabilidad (botón STB) si el tiempo lo permite.

## Qué evitar en vivo

- Construir circuitos grandes desde cero bajo presión.
- Modos PVT / S-Param / Monte Carlo sin practicarlos antes.
- Abrir la app solo en Vite sin Tauri (solver mock).

## Checklist rápido pre-demo

- [ ] Cada demo abre sin error de deserialización
- [ ] GND presente (ERC verde)
- [ ] Canvas: zoom, pan, cableado responden bien
- [ ] Simular / Detener funciona en DC y TRAN
- [ ] Ventana redimensionada: el canvas no queda en blanco
