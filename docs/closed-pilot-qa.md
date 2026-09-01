# Cierre de QA para piloto cerrado

> Registro histórico con corte del 3 de agosto de 2026. Sus cifras de pruebas,
> instalador y rendimiento no describen el árbol actual. La auditoría en curso
> está en [auditoria-2026-08-30.md](auditoria-2026-08-30.md).

Este documento registra la validacion de la aplicacion de escritorio Tauri
preparada para una prueba cerrada con docentes e investigadores. La web y la
version movil permanecen fuera de alcance.

## Matriz ejecutada

- `npm run test:coverage`: 330/330 pruebas TypeScript.
- `npm run build`: compilacion TypeScript y Vite de produccion correcta.
- `cargo fmt --all -- --check`: correcto.
- `cargo clippy -- -D warnings`: correcto.
- `cargo test`: 162/162 pruebas Rust.
- `npm run test:e2e:desktop:run`: 31/31 pruebas sobre la ventana Tauri y el
  backend Rust real.
- `npm run audit:ui`: correcto en desktop, desktop minimo y viewport movil de
  control; el guard de produccion impidio activar utilidades QA.
- `npm run audit:performance`: correcto.
- `npm audit --omit=dev`: 0 vulnerabilidades de produccion.
- `npm audit`: 0 vulnerabilidades, incluidas dependencias de desarrollo.
- `cargo audit`: 0 vulnerabilidades y 18 advertencias permitidas de
  dependencias transitivas.

## Consolidacion de seguridad y honestidad cientifica

Fecha de corte: 2026-08-03.

- El ERC y el backend validan contratos de tipo/pines, IDs, valores finitos y
  limites de tamano antes de estampar matrices.
- La conectividad DC ya no trata todos los pines de un componente como un
  cortocircuito topologico.
- El fallback TypeScript rechaza dispositivos sin modelo y AC sin Rust; se
  elimino el generador de curvas demostrativas.
- Los MCU 8051/AVR se bloquean antes de simular. El panel restante es solo un
  inspector HEX/BIN con checksum y direcciones extendidas.
- La escritura directa de esquemas exige una ruta autorizada por el dialogo.
  La excepcion E2E solo existe con la feature `wdio` y solo admite el directorio
  temporal del sistema.
- Produccion usa CSP estricta y no compila ni autoriza WDIO. La instrumentacion
  vive en la configuracion E2E.
- Cobertura actual: 44.77% statements, 41.57% branches, 52.38% functions y
  45.98% lines. CI aplica pisos 40/35/45/40.

## Cobertura funcional

La suite de escritorio cubre:

- carga, encuadre y simulacion de las cuatro demos;
- insercion y dibujo de toda la biblioteca, dividida en cuatro lotes;
- creacion de un divisor desde cero mediante drag, cableado y solver Rust;
- propiedades, rotacion, reflejo, duplicado, borrado, undo y redo;
- deteccion de lienzo vacio, falta de GND, corto, lazo ideal y pin flotante;
- aislamiento entre pestanas, guardado/carga, archivo corrupto y PDF;
- osciloscopio, generador, analizador logico, FFT y trazador I-V;
- DC, AC, transitorio, sensibilidad, PSS, estabilidad, PVT y parametros S;
- parser SPICE, barrido DC, termico, ruido, Monte Carlo, FFT, IMD, medidas y
  expansion de linea de transmision atravesando IPC;
- doce analisis consecutivos, cancelacion y recuperacion;
- lienzo de 150 componentes y traza de un millon de muestras.

## Referencias numericas

- Divisores resistivos: 216 combinaciones contra solucion analitica.
- Superposicion resistiva y puente balanceado.
- Filtro RC pasa-bajos: cuatro configuraciones contra magnitud y fase cerradas.
- Escalon RC: cuatro configuraciones y cinco puntos temporales por constante de
  tiempo contra la exponencial analitica.
- Carga RF adaptada de 50 ohm: `S11` cercano a cero.
- Ruido Johnson de 10 kohm: referencia de `1.287159e-8 V/sqrt(Hz)`.

## Rendimiento observado

- Escenario de 252 componentes: mediana 2.70 ms, maximo 12.10 ms.
- Escenario de 480 componentes: mediana 2.40 ms, maximo 6.70 ms.
- Escenario LOD de 960 componentes: mediana 1.80 ms, maximo 5.10 ms.
- Traza transitoria de 1,000,000 muestras: 19.00 ms inicial y 0.00 ms en cache,
  reducida a 2,560 puntos de dibujo.

## Release instalado

- Instalador:
  `src-tauri/target/release/bundle/nsis/Astryd Sophia_0.1.0_x64-setup.exe`
- Tamano: 4,893,765 bytes.
- SHA-256:
  `6A4CD49EB781AE3B8F9AA998291A4BFE9D90A852E8ADECB83A955DCEBE92E8E1`
- Reinstalacion silenciosa verificada con codigo de salida 0.
- Ejecutable instalado: 15,159,808 bytes; SHA-256
  `36CC9BCB9BA254AD01A8B4788441B2AEFBE24DF64F48D500A0A80E420E309E88`.
  La comparacion con el ejecutable release mostro solo tres bytes distintos en
  el marcador que modifica el empaquetado NSIS.
- Smoke test del release instalado: el proceso permanecio vivo durante ocho
  segundos y se cerro de forma controlada.
- Instalacion limpia verificada: solo `astryd-sophia.exe` y `uninstall.exe`.
- Smoke test instalado: demo de puente rectificador dibujada y simulada en
  transitorio hasta `0.049969 s`; osciloscopio con `Vpp=8.60 V`,
  `Vrms=7.79 V` y `F=20 Hz`.

## Defecto encontrado y corregido

La prueba IPC encontro que el parser aceptaba `V1 1 0 DC 5`, pero dejaba la
fuente en 0 V. Ahora reconoce `DC 5` y `DC=5` tanto en el netlist raiz como
dentro de subcircuitos. Hay regresiones Rust y E2E para esta sintaxis.

La ronda adversarial posterior detecto y corrigio otros cinco defectos:

- una instancia `X... PARAMS:` incompleta podia provocar `panic` en el parser;
- la extraccion reducida de polos/ceros dependia del orden aleatorio de `HashSet`;
- `fetchWord` del runtime MCU leia dos veces el mismo byte;
- el limite MCU total de ciclos podia ignorarse al reanudar;
- una interrupcion MCU inyectada no se atendia desde `runCycles`.

El gate E2E de rendimiento tambien confundia variacion del solver con coste de
feedback. Ahora conserva la regresion cruda como diagnostico y bloquea por el
tramo sincrono medido; la corrida final obtuvo 0.24% y 0.25%, respectivamente.

## Riesgos residuales

- El instalador no esta firmado digitalmente.
- `cargo audit` conserva 18 advertencias transitivas, principalmente GTK3 sin
  mantenimiento y una advertencia de solidez en `glib`; no son
  vulnerabilidades reportadas para este binario Windows.
- No se ha ejecutado una prueba continua de muchas horas ni una matriz de
  multiples equipos, GPU, DPI y versiones de Windows.
- La matriz cientifica principal aprueba 15 casos y 50 observaciones, pero no
  equivale a una certificacion completa contra ngspice, LTspice o Proteus.
- La [caracterización BSIM3 separada](../validation/reports/bsim-characterization.md)
  aprueba 5/5 puntos DC de un único caso NMOS BSIM3 frente a ngspice 47, con errores
  relativos de corriente entre 1.27 % y 6.89 % y tolerancia relativa del 25 %.
  El caso fija VGS=0.8–1.6 V en pasos de 0.2 V, VDS=1 V, W=10 µm, L=0.18 µm
  y 27 °C, con los parámetros del fixture versionado. No certifica BSIM completo
  ni BSIM4; la familia permanece experimental.
- MCU 8051/AVR conserva infraestructura temporal, pero no implementa una ISA ni
  perifericos completos; no es instruction-accurate ni cycle-accurate.
- La automatizacion E2E usa un binario debug instrumentado; el release final se
  valido adicionalmente mediante instalacion limpia y prueba viva, pero no
  expone los hooks QA internos.
