# Estado de validación científica

Fecha de corte: 2026-08-03.

Este documento separa capacidad implementada de capacidad científicamente validada. Una prueba
unitaria que comprueba que el solver devuelve datos no demuestra exactitud física.

## Clasificación actual

| Área | Estado | Alcance que sí puede afirmarse |
|---|---|---|
| DC lineal | Analítica + ngspice en vivo | Divisor resistivo con tensión, residuo KCL y punto de operación externo |
| AC lineal | Analítica + ngspice en vivo | RC externo; RL y RLC analíticos con magnitud, fase y residuos KCL |
| Transitorio lineal | Analítica + ngspice en vivo | RC TRAP externo; RC BE/Gear2 y RL BE analíticos; reloj y extremo exactos |
| Diodo ideal | Analítica + ngspice en vivo | Shockley a 300 K en cinco puntos; no equivale a correlación con dispositivo real |
| Otros dispositivos no lineales | Implementado parcialmente | Pruebas funcionales; falta correlación sistemática externa |
| PSS | Experimental con validación limitada | Shooting con Jacobiano por diferencias finitas; un RC lineal cumple su referencia periódica, pero faltan osciladores y no lineales |
| Polos y ceros | Experimental con validación limitada | Un caso RC analítico y repetibilidad determinista; sigue siendo un modelo reducido, no análisis de ganancia de lazo |
| Márgenes de fase/ganancia | No implementado | Los valores heurísticos anteriores fueron retirados |
| BSIM3/BSIM4 | Experimental y no apto para predicción | La caracterización NMOS BSIM3 contra ngspice difiere 97.9 %–99.3 % en corriente; BSIM4 aún no tiene correlación equivalente |
| MCU 8051/AVR | No simulable | La carga HEX/BIN queda disponible solo para inspección; ERC bloquea simulaciones que contengan estos componentes porque no existe una ISA completa |
| Arduino/ESP32/Pico | Modelo funcional | Comportamiento analógico de alto nivel; no ejecuta firmware real |

## Salvaguardas numéricas de Fase 0

- `dt` debe ser finito y mayor que cero.
- `tMax` debe ser finito y no negativo.
- Una solicitud transitoria no puede exceder 2 000 000 de pasos nominales.
- AC exige `fStart > 0`, `fEnd >= fStart` y entre 1 y 100 000 puntos por década.
- Un barrido AC no puede exceder 1 000 000 de puntos nominales.
- PSS exige periodo, tolerancia e iteraciones válidas.
- PSS no puede exceder 2 000 000 de pasos transitorios estimados por shooting.
- PVT conserva el `dt` solicitado y limita la carga combinada de todas las
  esquinas a 2 000 000 de pasos; ya no degrada silenciosamente cada corrida a
  un máximo arbitrario de 2 000 muestras.
- La tolerancia configurable debe estar en `(0, 1]`.
- Las iteraciones configurables deben estar entre 1 y 10 000.
- El solver rechaza tipos desconocidos, contratos de pines inválidos, valores no finitos,
  más de 10 000 componentes o nodos por encima de 5 000.
- Barridos DC, Monte Carlo, FFT/IMD, ruido, medidas y líneas segmentadas tienen límites
  explícitos de tamaño y validación de datos.
- El fallback TypeScript solo admite la red lineal declarada. No linealiza diodos,
  transistores ni genera curvas AC demostrativas.

Los ajustes de tolerancia e iteraciones de la interfaz se aplican a Newton en DC/transitorio y al
shooting de PSS. No controlan el rango ni la densidad del barrido AC.

## Criterio para abandonar la etiqueta “experimental”

Cada análisis necesita una suite reproducible con:

1. circuito y parámetros versionados;
2. resultado analítico o simulador externo de referencia;
3. métrica de error y tolerancia justificadas;
4. verificación de residuos físicos relevantes;
5. reporte generado automáticamente y conservado como artefacto.

## Infraestructura de Fase 1

La suite vive en `validation/` y se ejecuta con:

```bash
npm run validate:scientific
```

La línea base inicial contiene tres casos: divisor DC, filtro RC en frecuencia de corte y escalón
RC a una constante de tiempo. Genera reportes JSON y Markdown, falla el proceso si una tolerancia
se excede y se ejecuta en CI.

En la Fase 1 `ngspice` no estaba instalado y no participaba en los resultados. Esa limitación
histórica quedó resuelta para los cuatro casos externos añadidos en Fase 4.

## Matriz de Fase 2

La matriz se amplió a 7 casos y 29 observaciones:

- divisor DC y residuo KCL;
- barrido I–V de diodo Shockley a cinco tensiones;
- RC en frecuencia de corte;
- RL en dos décadas;
- RLC serie en resonancia;
- escalón RC y residuo KCL;
- escalón RL entre `0.25τ` y `5τ`.

La Fase 2 detectó un error científico real: el transitorio sumaba los stamps DC de capacitores
e inductores a sus companion models. Esto introducía conductancias paralelas artificiales y
hacía que el RL arrancara casi en régimen permanente. El transitorio ahora usa una base estática
sin aproximaciones reactivas DC y existe una prueba de regresión específica.
La corrección expuso además un signo invertido en el término histórico del capacitor TRAP;
también fue corregido y cubierto por una prueba del stamp y por la regresión LC existente.

La Fase 2 dejó documentada una deuda: la primera solución integrada se etiquetaba como `t=0`.
La Fase 3 corrige esa semántica, como se detalla a continuación.

El alcance sigue siendo analítico e interno. El caso de diodo usa la misma ley física que
implementa el solver y sirve como prueba cuantitativa de regresión, no como validación
independiente del modelo. En una ampliación posterior se añadieron un caso PSS lineal y un caso
reducido de polos/ceros. BSIM, ruido, sensibilidad, estabilidad de lazo y MCU permanecen fuera
de la matriz bloqueante principal.

## Matriz temporal de Fase 3

La deuda del eje temporal quedó corregida:

- `t` representa el último estado aceptado;
- las fuentes y modelos se evalúan en `t + dtAceptado`;
- la muestra se publica en esa misma coordenada;
- el `dt` siguiente se calcula después y no desplaza el reloj;
- el último paso se recorta para terminar exactamente en `tMax`;
- la primera muestra integrada aparece en `t=dt`, sin etiquetarla falsamente como `t=0`.

La matriz creció a 9 casos y 35 observaciones. Se añadieron respuestas RC multipunto con TRAP
y Gear2. TRAP usa un paso BE de arranque para formar una historia física antes de aplicar la
regla trapezoidal. Una regresión verifica mallas fijas y adaptativas, tiempos estrictamente
crecientes, evaluación de fuentes en el tiempo publicado y coincidencia exacta con `tMax`.

No se genera todavía un punto de operación inicial separado en `t=0`. Esto es una capacidad
ausente, no una etiqueta incorrecta: el resultado transitorio comienza explícitamente en el
primer tiempo integrado.

## Correlación externa de Fase 4

El arnés ejecuta ngspice en batch durante la validación y analiza su raw ASCII. No consume una
tabla copiada manualmente: las magnitudes esperadas se obtienen de la ejecución externa actual.
El reporte registra la versión exacta del ejecutable.

La matriz contiene 15 casos y 50 observaciones. Once observaciones se correlacionan en vivo:

- punto de operación del divisor resistivo;
- magnitud y fase del RC en frecuencia de corte;
- tensión RC TRAP en `0.25τ`, `τ` y `2τ`;
- corriente del diodo Shockley entre 0.1 V y 0.5 V.

El parser externo valida número de variables, número de puntos e índices consecutivos. Admite
valores reales y complejos; para tiempos adaptativos interpola únicamente dentro del intervalo
cubierto. La ausencia de ngspice hace fallar los casos externos. En Windows existe un bootstrap
portátil con archivo y SHA-256 fijados; CI instala ngspice desde el sistema.

Esta fase no valida modelos de dispositivo reales. El diodo externo comparte los parámetros
ideales `Is`, `N`, `TEMP` y `TNOM`; sirve para detectar diferencias de ecuación, convención de
corriente o continuación, pero no prueba alta inyección, ruptura, parasíticos ni silicio medido.

## Ampliación de estabilidad y caracterización BSIM

La matriz bloqueante incorpora un PSS de RC senoidal y una red RC con polo y cero analíticos.
La extracción de estabilidad ordena sus resultados de forma determinista y una regresión repite
el análisis 32 veces. Esto retira la afirmación de que PSS y polos/ceros carecen por completo de
referencias, pero no justifica retirar la etiqueta experimental.

`npm run characterize:bsim` ejecuta un barrido NMOS BSIM3 versionado contra ngspice. Las cinco
observaciones fallan: el error relativo de corriente va de 97.9 % a 99.3 %. Esta suite separada
debe seguir fallando hasta que el modelo cambie; incorporarla al gate principal fingiría que la
versión está lista o bloquearía toda entrega sin aportar una corrección del modelo.

## Decisión sobre límites operativos

Se retiró el máximo silencioso de 2 000 pasos por esquina PVT. El análisis conserva ahora el
`dt` solicitado y rechaza de forma explícita únicamente cuando el trabajo combinado supera
2 000 000 de pasos. No se retiraron los límites siguientes:

- 10 000 componentes, 5 000 nodos y 64 pines por componente;
- 2 000 000 de pasos transitorios, PSS, PVT combinado, FFT/IMD o medidas;
- 1 000 000 de puntos AC, 100 000 puntos de barrido DC y 10 000 iteraciones;
- 256 corridas y 2 000 000 de muestras combinadas para Monte Carlo;
- 1 000 segmentos por línea de transmisión;
- 10 MiB para SPICE, 50 MiB para esquemas y 100 MiB para importaciones avanzadas;
- cuotas de feedback de 64 KiB por evento, 1 MiB por lote y 250 MiB locales.

Estos topes evitan asignaciones descontroladas, bloqueos prolongados y entradas hostiles. Las
pruebas verifican su rechazo, pero no existe una campaña de escalabilidad que justifique elevarlos.
Pueden convertirse más adelante en presupuestos configurables ligados a memoria disponible,
cancelación y estimación previa; eliminarlos sin esas tres condiciones reduciría estabilidad.
