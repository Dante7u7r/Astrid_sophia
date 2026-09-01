# Auditoría y correcciones — 30 de agosto de 2026

Continuación y verificaciones adicionales: 31 de agosto de 2026.

## Alcance y estado

Revisión y corrección del árbol de trabajo de Biaani, con pruebas TypeScript,
Rust, navegador y escritorio Windows. Esta auditoría no certifica ausencia de
errores ni equivalencia completa con SPICE. No se generó un commit, no se hizo
push y no se instaló un nuevo release en el equipo del usuario.

El árbol contenía cambios previos: este informe no atribuye todos los archivos
modificados a la auditoría. Los datos de instalación y rendimiento del documento
`closed-pilot-qa.md` pertenecen a su corte histórico; no son resultados del
binario actual.

**Cierre del alcance auditado:** la corrida nativa final aprobó 6/6 suites y
33/33 casos con el ejecutable aislado. Las corridas anteriores de 30/33, 29/33
y 31/33 se conservan como evidencia de los defectos que llevaron a corregir la
navegación de instrumentos, el historial LTE, el coste de feedback y el timeout
del arnés para la demo 02. No se ocultaron ni reclasificaron como aprobadas.

La continuación del 31 de agosto cerró también los fallos que aparecieron al
restaurar pasos adaptativos mayores: localización de cruces mixtos antes de
publicar el paso, coeficientes BDF calculados después del recorte por evento y
orden FIFO para timestamps digitales iguales. La comprobación final aprobó
1.252 pruebas frontend y 319 pruebas Rust, además de las matrices científicas.

## Correcciones cubiertas por regresiones

- Persistencia: validación y round-trip de documentos, conservación de ajustes
  y rechazo de datos corruptos sin sustituir silenciosamente el circuito.
- Parser y topología: validaciones de entradas, expansión SPICE y protección
  de rutas que podían aceptar contratos inválidos o producir un panic.
- Simulación interactiva: identidad de ejecución, descarte de resultados
  obsoletos, cancelación, finalización y distinción entre cálculo y reproducción.
- Instrumentación QA: origen del resultado registrado explícitamente como
  Rust, TypeScript o mock; el texto de un log ya no demuestra qué solver corrió.
  Los análisis DC/AC también notifican el inicio de la ejecución.
- Demos: respeto al modo de análisis guardado, puente Wheatstone en DC y
  activación del osciloscopio sin abrir por accidente una ventana flotante.
- Sintetizador: inserción mediante el contrato de persistencia completo,
  conservación de modo/ajustes/probes, bloqueo de doble inserción, recuperación
  ante errores y protección frente a callbacks tardíos o cambios de pestaña.
- Interfaz: controles funcionales del centro de feedback restaurados, limpieza
  de listeners de modales, selección y propiedades verificadas, y aviso de
  bienvenida apartado de los controles de aplicación de propiedades.
- Osciloscopio: caché y reducción de trazas con regresiones para señales
  diferenciales, extremos y actualización de datos.
- Seguridad: intérprete acotado para sketches ESP32 en lugar de ejecución
  arbitraria de JavaScript, guard del puente E2E en producción y dependencias
  npm sin avisos de vulnerabilidad en la consulta ejecutada.
- Honestidad científica: mensajes BSIM sincronizados con la caracterización
  real; se mantienen la etiqueta experimental y sus límites.

Se retiró `src/simulation/esp32_sketch_interpreter.ts`, un archivo duplicado
sin consumidores. La implementación utilizada sigue en `esp32_runtime.ts`.
El duplicado no estaba versionado: Git no proporciona recuperación de ese
archivo eliminado.

## Evidencia ejecutada

| Verificación | Resultado observado |
|---|---|
| `npm run release:check` | Aprobado: versiones, contratos, cobertura y build de producción |
| Vitest con cobertura | 1.252 pruebas en 219 archivos aprobadas en la corrida final |
| Cobertura | Statements 66,64 %; branches 51,37 %; functions 64,29 %; lines 68,60 % |
| `npm run test:e2e:frontend` | 10/10 flujos aprobados |
| `npm run test:e2e:pw` | 9/9 pruebas Chromium aprobadas |
| `npm run audit:ui` | Aprobado en 1280×720, 900×600 y 390×844; guard de producción aprobado |
| `npm run audit:performance` | Aprobado; 252/480/960 componentes y traza de 1.000.000 de muestras |
| `npm audit --json` | 0 vulnerabilidades |
| Rust: fmt, check all-targets y clippy all-targets con `-D warnings` | Aprobados con `--locked` después de LTE, BDF, cruces y FIFO |
| `cargo test --locked` | 319 aprobadas, 0 fallidas, 0 ignoradas; main y doc-tests sin fallos |
| Pruebas del ejemplo `scientific_validation` | 7/7 aprobadas |
| Matriz científica principal | 15/15 casos, 50/50 observaciones; repetida después de las correcciones finales |
| Campaña de diversidad Fase 5 | 500/500 casos; repetida tras las correcciones finales |
| Caracterización BSIM | 1/1 caso, 5/5 observaciones; repetida tras las correcciones finales |
| E2E nativo, primera corrida completa | 30/33: no constituye cierre aprobado |
| E2E nativo, repetición aislada del 31 de agosto | 29/33; corrida histórica no aprobada |
| E2E nativo, corrida previa a la optimización final | 31/33; fallaron el gate 2,04 % y el timeout de 45 s de demo 02 |
| E2E nativo final | 33/33, 6/6 suites, 4 min 24 s; ejecutable debug aislado |
| QA nativo profundo, repetición tras registrar diagnóstico de apertura | 12/12; no demuestra corrección de la intermitencia |
| E2E nativo del sintetizador | 1/1 aprobado con Tauri/Rust real |
| E2E nativo de edición de propiedades, aislado tras ajustar la preparación | 1/1 aprobado |

La medición de renderizado más reciente, en AMD Ryzen 7 7735H (8 núcleos,
16 procesadores lógicos), obtuvo medianas de 7,9 / 11,7 / 20,9 ms para
252 / 480 / 960 componentes, con 50 / 35 / 30 iteraciones. Hubo compilación
concurrente: no es una comparación controlada de rendimiento entre versiones.
La traza de un millón de muestras tardó 31,4 ms en la primera reducción y
menos de la resolución del temporizador en caché, conservando el pico del
fixture y reduciéndose a 2.000 puntos. No implica que todo circuito sostenga
60 FPS. Los detalles están en `performance-audit-results/summary.json`.

## Investigación final del transitorio

Observación reproducida: la demo 01, configurada para 10 segundos físicos,
seguía ejecutándose tras 45 segundos de pared. Su última muestra estaba en
aproximadamente 0,636 segundos físicos, sin pausa ni error final.

Un diagnóstico temporal sin interfaz, IPC ni pacing reprodujo el coste:
0,05 segundos físicos requirieron 2,24 segundos de pared y 225 pasos;
0,1 segundos físicos requirieron 5,10 segundos y 445 pasos. Los pasos
aceptados estuvieron entre 50 y 250 microsegundos, sin colapso hacia el paso
mínimo. Estas cifras son del perfil debug y no describen el release.

La comparación release, sin UI ni pacing, terminó con 44.005 pasos y 10 s
físicos en 2,376 s de pared; 0,1 s físicos requirieron 0,0268 s. La compilación
usó el perfil release existente, con optimización 3 y LTO. Es una medición
diagnóstica de esta demo, no un SLA de tiempo real para cualquier circuito.
Se midió y configuró `profile.dev.package.biaani.opt-level=2`, conservando
`debug-assertions=true` y `overflow-checks=true`. Optimizar el paquete que
instancia los genéricos evita depender de que el compilador optimice solamente
la dependencia ([reglas de Cargo para genéricos](https://doc.rust-lang.org/cargo/reference/profiles.html#overrides-and-generics)).
La nueva medición debug obtuvo 0,130 s de pared para 0,1 s físicos y avanzó
7,865 s físicos antes del corte diagnóstico de 10 s de pared. No se modificaron
ecuaciones, tolerancias, paso temporal ni duración de las demos. La finalización
con UI se verificó primero para la demo 01: 10 s físicos en 14,463 s de pared.
Antes de corregir LTE, la demo 02 no terminó: tras 45 s de pared alcanzó
0,634584 s físicos, con 28.036 muestras
recibidas y sin pausa. Las muestras recibidas no equivalen al número total de
pasos aceptados: el transporte realiza submuestreo y reducción de lotes.

Los objetos `FaerFactorizedReal` y `FaerFactorizedComplex` conservaban la matriz,
pero repetían la factorización LU en cada RHS. Ahora conservan y comparten una
LU inmutable; siete regresiones cubren RHS múltiples, Clone, Send/Sync,
singularidad, pivoteo y escalas. Ese defecto no explicaba por sí solo la demo 01,
que toma la ruta no lineal de Newton.

También se reprodujo una invalidación ausente: con pasos fijos de 1 ms, un
divisor de 5 V y dos resistencias de 1 kΩ seguía dando 2,5 V tras cambiar R2
a 2 kΩ. La regresión falló antes del cambio y ahora exige 10/3 V desde el
paso siguiente, con tolerancia de 1e-8 V y residuo KCL menor de 1e-11 A.
Se invalida la caché cuando entra una mutación distinta de la corrida propia,
sin reiniciar el tiempo ni los estados físicos. Reenviar el mismo valor no
provoca invalidaciones sucesivas.

En la entrada IPC había un segundo problema: se sustituía el `runId` recibido
por el activo. Ahora se conserva la identidad del productor y se rechazan
peticiones ausentes, obsoletas o de otra corrida. La prueba con `runId=0`
también falló antes de corregirlo; las pruebas de rechazo, aceptación de la
corrida propia y parada pasan en la suite Rust conjunta.

### Error del historial LTE en mallas no uniformes

Una prueba Rust reprodujo un error normalizado de 250 para la rampa exacta
V(t)=1000t V, usando intervalos de 0,1 / 0,2 / 0,1 ms. Su tercera derivada es
cero. El estimador dividía dos diferencias históricas por el mismo intervalo,
aunque las muestras correspondían a intervalos distintos.

La reproducción sin UI, IPC ni pacing de la demo 02 necesitó 6,120 s de pared
y 121.150 pasos aceptados para llegar a 0,1 s físicos; 121.091 pasos fueron
menores de 10 µs. Con duración objetivo de 10 s y corte diagnóstico de 10 s de
pared, alcanzó sólo 0,160317 s físicos tras 196.295 pasos. El paso mínimo del
caso de 0,1 s incluía el recorte final: no se confunde con una violación del
mínimo adaptativo durante el resto de la corrida.

La corrección usa el intervalo propio de cada par de muestras y el historial
de pasos aceptados; los intentos rechazados no lo adelantan. Los cinco nuevos
casos de rampa, cuadrática, cúbica, malla uniforme y rechazo/reintento aprobaron
junto a los cuatro tests existentes del controlador. Una regresión adicional
del integrador completo, fuente PWL de 1.000 V/s y capacitor de 1 µF, comprueba
V(t), corriente de fuente de −1 mA, KCL e historial temporal no uniforme.
No se relajaron tolerancias ni se cambiaron los coeficientes de integración.
Estas pruebas no certifican el estimador completo de los métodos Gear de
orden 3–6.

La repetición de la misma demo 02 sin UI, IPC ni pacing, con el mismo perfil
debug optimizado y sin compilación concurrente, llegó a 0,1 s físicos en
0,360 s de pared y 5.250 pasos aceptados. Es aproximadamente 17 veces menos
tiempo que los 6,120 s anteriores para ese fragmento. Con el mismo corte de
10 s de pared avanzó 2,665068 s físicos y 148.072 pasos, con resultados finitos.
Esto aún no prueba la finalización de sus 10 s físicos con la aplicación nativa.

La suite conjunta detectó a continuación un fallo real: el inversor excitado
por una senoide de 1 kHz y amplitud 5 V, umbral 2,5 V y retardo 20 ns conmutó
en el intervalo 86,142–86,167 µs; el instante analítico es 83,353333 µs.
La causa era que se publicaba el paso antes de detectar el evento interpolado
dentro de él. Ahora se evalúa un scheduler de prueba y se acota por bisección
un bracket de un mismo paso no aceptado; solo entonces se publican el estado,
los historiales y el callback. Hay límite de 64 intentos y error explícito si
no existe progreso. La regresión cubre los dos flancos analíticos y exige un
intervalo de localización menor o igual a 1 µs.

Otro caso usa una rampa PWL de 1.000 V/s, un capacitor de 1 µF y un evento MCU
en 100 µs que recorta el segundo paso Gear2 de 60 a 40 µs. Antes de mover el
cálculo BDF, la prueba roja observó −0,5 mA en la fuente y residuo KCL de
+0,5 mA; después exige −1 mA y KCL menor de 1e-10 A en 60/100/120 µs.

Finalmente, una prueba roja demostró que dos eventos con el mismo timestamp
salían como `second, first`. La cola inserta ahora después de los empates y
conserva FIFO. Una regresión end-to-end comprueba que dos entradas simultáneas
HIGH dejan correctamente HIGH la salida de una AND.

## Coste de feedback y navegación de instrumentos

El resumen de circuito recorría los componentes siete veces y leía los pines
tres veces; ahora obtiene contadores, nodos e histograma en una sola pasada.
Las regresiones comprueban el mismo payload y fingerprint, privacidad de los
datos y actualización de objetos mutados. No se añadió una caché basada en
identidad de objetos mutables. La canonicalización final evita crear y ordenar
480 objetos intermedios, pero conserva exactamente el fingerprint anterior.

La primera medición final falló honestamente: 1,874 % de tramo síncrono y
2,044 % de instrumentación directa, frente a límites de 3 % y 2 %. Después del
cambio, dos bloques predefinidos aprobaron con 1,667/1,833 % y 1,296/1,372 %;
la corrida completa final obtuvo 1,037/1,185 %. Las cuatro mediciones crudas,
incluida la fallida, quedaron en `desktop-e2e-results/performance/`.

El benchmark conserva ahora todas las muestras crudas y sus métricas en archivos
fechados bajo `desktop-e2e-results/performance/`, también cuando falla. Sus doce
muestras hacen que el p95 por rango más cercano coincida con el máximo. El gate
solo mide el tramo síncrono instrumentado y usa como denominador la llamada al
solver, incluyendo IPC/espera: no certifica el coste total del feedback ni un
p95 poblacional estable.

En la corrida final con interfaz, la demo 01 completó 10 s físicos en 16,644 s
de pared y la demo 02 en 47,386 s; las demos 03/04/05 tardaron 0,279/0,428/0,606 s.
El timeout del arnés pasó de 45 a 60 s para coincidir con la prueba transitoria
ya existente; no se cambiaron duración física, `dt`, tolerancias ni iteraciones.
Estas cifras son una corrida en este equipo, no percentiles ni un SLA.

La navegación profunda ahora fija el centro de instrumentos mediante su control
real durante el caso que abre ventanas flotantes, y restaura la preferencia al
terminar. Dos pruebas con reloj controlado comprueban que abrir una ventana
programa el auto-ocultado a 400 ms y que fijar el centro cancela ese temporizador.
No se cambió el comportamiento de auto-ocultado del producto. La hipótesis de
interferencia del temporizador explica el setup, pero la causa exacta del fallo
nativo original no quedó capturada; se conserva diagnóstico de estado en el
helper. La corrida final completa aprobó este caso y los otros 32.

## Límites y riesgos que permanecen

- La cobertura de ramas es aproximadamente 51 %: pasar las pruebas no prueba
  todas las rutas del programa.
- `cargo audit` terminó sin vulnerabilidades bloqueantes, pero con 18 avisos
  transitivos: 17 de mantenimiento y uno de solidez de `glib`
  ([RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)).
  `glib` no aparece en el grafo Windows compilado; sí afecta al árbol de
  dependencias GTK usado en Linux. No se certificó Linux en este equipo.
- La correlación BSIM corresponde a un NMOS BSIM3, cinco puntos DC,
  VGS de 0,8 a 1,6 V, VDS=1 V, W=10 µm, L=0,18 µm y 27 °C frente a ngspice 47.
  El error relativo observado de corriente fue 1,27–6,89 %, con tolerancia
  relativa del 25 % y absoluta de 1e-8 A. No valida BSIM completo, PMOS ni BSIM4.
- PSS, polos/ceros y otros dispositivos no lineales conservan validación
  limitada. Los MCU y los sketches funcionales no equivalen a emulación
  completa de instrucciones, periféricos y temporización.
- No se realizó una prueba de muchas horas, una matriz de otros equipos/GPU/DPI
  ni una nueva validación del instalador de producción.
- El overlay E2E usa `com.biaani.desktop.wdio`, distinto de
  `com.biaani.desktop`, y la identidad del ejecutable se comprobó por IPC antes
  de cada suite. La base de feedback normal mantuvo 593.920 bytes y fecha UTC
  2026-08-31 04:56:32 antes y después de la corrida aislada. Los tests anteriores
  sí compartían la ruta normal de feedback y pudieron modificarla. La corrida
  actual mostró además un WebView en un directorio temporal propio de EdgeDriver;
  no se demostró que modificara preferencias o autoguardado del WebView normal.
  No se ha demostrado pérdida de archivos de esquemas guardados y no se borró
  ni limpió el perfil normal.

## Aislamiento y cierre de procesos del arnés

La configuración de escritorio tiene regresiones que comprueban identidad
separada y ausencia de permisos WDIO en producción. La limpieza global por
nombre de ejecutable se sustituyó por selección de descendientes del launcher
actual, con revalidación de PID, fecha de creación y cadena de padres. Una
cadena incompleta, un ciclo o un PID reutilizado no autorizan cerrar el proceso.
La lectura CIM real se ejecutó en Windows sin terminar ningún proceso ajeno;
los casos de selección y cierre se cubrieron con mocks. Las 14 pruebas locales
de configuración y limpieza aprobaron. Tras la corrida nativa aislada no quedaron
procesos `biaani.exe`, `tauri-driver.exe` ni `msedgedriver.exe`.

El servicio WDIO emite avisos de deprecación de Node y de limpieza de mocks
después de finalizar la sesión. No se silencian ni se confunden con fallos del
solver; el cierre de procesos se comprobó independientemente.
