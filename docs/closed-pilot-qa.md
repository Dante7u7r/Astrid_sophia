# Cierre de QA para piloto cerrado

Este documento registra la validacion de la aplicacion de escritorio Tauri
preparada para una prueba cerrada con docentes e investigadores. La web y la
version movil permanecen fuera de alcance.

## Matriz ejecutada

- `npm run test:coverage`: 292/292 pruebas TypeScript.
- `npm run build`: compilacion TypeScript y Vite de produccion correcta.
- `cargo fmt --all -- --check`: correcto.
- `cargo clippy -- -D warnings`: correcto.
- `cargo test`: 152/152 pruebas Rust.
- `npm run test:e2e:desktop:run`: 30/30 pruebas sobre la ventana Tauri y el
  backend Rust real.
- `npm run audit:ui`: correcto en desktop, desktop minimo y viewport movil de
  control; el guard de produccion impidio activar utilidades QA.
- `npm run audit:performance`: correcto.
- `npm audit --omit=dev`: 0 vulnerabilidades de produccion.
- `npm audit`: 23 alertas altas en la cadena WDIO de desarrollo, sin correccion
  disponible en el arbol actual; WDIO no se incluye en el binario normal.
- `cargo audit`: 0 vulnerabilidades y 18 advertencias permitidas de
  dependencias transitivas.

## Consolidacion de seguridad y honestidad cientifica

Fecha de corte: 2026-07-30.

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
- Cobertura actual: 43.55% statements, 39.73% branches, 49.07% functions y
  44.69% lines. CI aplica pisos 40/35/45/40.

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

- Escenario de 252 componentes: mediana 2.20 ms, maximo 5.10 ms.
- Escenario de 480 componentes: mediana 2.70 ms, maximo 5.70 ms.
- Escenario LOD de 960 componentes: mediana 2.00 ms, maximo 5.20 ms.
- Traza transitoria de 1,000,000 muestras: 23.30 ms inicial y 0.10 ms en cache,
  reducida a 2,560 puntos de dibujo.

## Release instalado

- Instalador:
  `src-tauri/target/release/bundle/nsis/Astryd Sophia_0.1.0_x64-setup.exe`
- Tamano: 3,256,243 bytes.
- SHA-256:
  `34C4A20F30A569A82EFFDCE8F4A977099E2D3D22D86AD41FABDA709322F710D0`
- Reinstalacion silenciosa verificada con codigo de salida 0.
- Ejecutable instalado: 10,106,880 bytes; SHA-256
  `31BD427154065CA07571DBC7494C9EDDDA9BC1D69BBB10328B40EA8FD756574E`.
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

## Riesgos residuales

- El instalador no esta firmado digitalmente.
- `cargo audit` conserva 18 advertencias transitivas, principalmente GTK3 sin
  mantenimiento y una advertencia de solidez en `glib`; no son
  vulnerabilidades reportadas para este binario Windows.
- No se ha ejecutado una prueba continua de muchas horas ni una matriz de
  multiples equipos, GPU, DPI y versiones de Windows.
- Las referencias analiticas cubren circuitos representativos, pero no
  equivalen a una certificacion completa contra ngspice, LTspice o Proteus.
- La automatizacion E2E usa un binario debug instrumentado; el release final se
  valido adicionalmente mediante instalacion limpia y prueba viva, pero no
  expone los hooks QA internos.
