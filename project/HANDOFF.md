# Handoff: Doctors Fantasy (app móvil de dynasty fantasy football)

## Overview
Doctors Fantasy es una app móvil (iOS-first) que se conecta **solo-lectura** a la cuenta de Sleeper del usuario
y convierte los datos de su liga en decisiones: a quién draftear en la pick que viene, cómo alinear,
qué cambios proponer y cómo se ve la liga completa. Todo el cálculo (fit score, lineup óptimo, valor de
mercado, TD esperados) corre en cliente a partir de las APIs públicas de Sleeper.

El repo real de la app es `jorgeleal2002-blip/fantasy-copilot` (branch `main`) — ver `github.md` en este
bundle para el mapa pantalla → archivo y el último estado sincronizado. Este handoff describe el
**diseño** que debe existir en ese código.

## About the Design Files
Los archivos en `design/` son **referencias de diseño hechas en HTML** — prototipos que muestran la
apariencia y el comportamiento buscado, **no código de producción para copiar**. La tarea es
**recrear estos diseños en el entorno del codebase destino** (React + TypeScript en este repo)
usando sus patrones y librerías ya establecidas (`src/screens/*`, `src/model/*`, `src/styles/tokens.css`).
Si algún módulo aún no existe, elegir la estructura que mejor encaje con lo ya presente en el repo.

Los prototipos usan un runtime propio (`support.js`, plantillas `<x-dc>`, `<sc-if>`, `<sc-for>`):
**ignorar ese mecanismo**. Lo que importa es el markup resultante, los valores de estilo, la lógica
de `renderVals()` (que es lógica de negocio real y portable casi 1:1 a hooks/selectores) y los flujos.

Cómo abrir los prototipos: servir la carpeta `design/` con cualquier servidor estático
(`npx serve design`) y abrir `Dynasty Assistant.dc.html` (la app) o `Manual de datos.dc.html`
(el manual imprimible de datos y estadísticas). Necesitan `_ds` → aquí se incluye el stylesheet del
design system en `design-system/styles.css`; ajustar el `<link>` si se quiere ver 1:1.

## Fidelity
**High-fidelity (hifi).** Colores, tipografía, espaciado, radios, animaciones y copy son finales.
Recrear la UI pixel-perfect con las librerías del codebase. El copy está en **español (es-MX)** y es
final: usarlo tal cual. La lógica de scoring también es final — está implementada en el prototipo y
ya portada a `src/model/*` en el repo; cualquier diferencia se resuelve a favor del prototipo.

## Design System: Nocturne
Fuente de verdad: `design-system/styles.css` (tokens + capa de componentes) y `design-system/readme.md`.
Reglas que no se negocian:

- Fondo oscuro casi neutro; **nunca** negro puro ni blanco puro.
- Un solo acento `#9184d9`, usado como **línea y glow**, nunca como relleno grande. Excepción:
  los grounds indigo profundo (`--color-section`) usados en la tarjeta de recomendación y headers.
- Acciones primarias **outlined** (borde 1px acento sobre transparente), no rellenas.
- Inter 400/500/600. Nunca pasar de 500 en headings: la jerarquía es tamaño y espacio.
- `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` en todo elemento interactivo.
- Iconos: Phosphor. Los pocos SVG inline del prototipo (lupa, chevrons) se reemplazan por Phosphor.
- Densidad 0.70× — la app es compacta a propósito.

## Design Tokens (valores usados en el prototipo)
Colores
- `--color-bg` `#161826`; fondo del canvas fuera del device `#0f101a`
- `--color-text` `#e9e9ed`; texto secundario `rgba(233,233,237,.5)`; terciario `rgba(233,233,237,.45)`; cuaternario `rgba(233,233,237,.38)`
- `--color-accent` `#9184d9`; hover/claro `#b3a9e6`; texto sobre tinte acento `#c9c0f0`
- `--color-surface`, `--color-divider` (de `styles.css`)
- Tinte acento de fondo: `rgba(145,132,217,.10)` idle, `.18` chip, `.20` hover
- Ground de sección: gradiente `150deg, #262a60 0%, #232532 62%` + radial `rgba(145,132,217,.32)`
- Header: `linear-gradient(to bottom, rgba(38,42,96,.35), transparent)`
- Error / alerta: texto `#d9a08e`, borde `rgba(217,160,142,.5)`, fondo `rgba(217,160,142,.08)`
- Fondo de página del canvas: `radial-gradient(1200px 600px at 50% -10%, #1c1e30 0%, #0f101a 70%)`

Tipografía (Inter)
- H1 login 30px/1.1 w500 `-0.025em` · H2 pantalla 23px w500 `-0.02em` · título header 19px w500 `-0.02em`
- Métrica grande 26px w500 `-0.03em` · nombre destacado 24px w500 `-0.025em`
- Body 13.5px/1.5 · fila 14.5px w500 · meta 11.5–12.5px · kicker 10–10.5px uppercase `letter-spacing .10–.14em`
- Input 16px w500 (evita el zoom de iOS); input de búsqueda 13px w400

Radios: 7px chip · 9–10px botón/fila compacta · 11–12px card/input · 13–14px card destacada · 50% avatar
Espaciado: gaps 5/6/9/10/12/14px; padding de pantalla 18–24px, top 60–78px (safe area)
Alturas mínimas: botón principal 50px; filas táctiles ≥44px

Animaciones (`@keyframes` en el prototipo, reusar duraciones)
- `fadeUp` .3–.4s ease (entrada de pantallas y tabs) — `translateY(10px)` → 0, opacity 0 → 1
- `slideIn` .3s ease (paso onboarding) — `translateX(26px)` → 0
- `pop` (aparición de sheet) — `scale(.96)` → 1
- `pulseGlow` 3s ease-in-out infinite en el badge del login — box-shadow acento 0 → 10px, se desvanece
- `spin` 1s linear infinite en el spinner de carga (44px, borde 2px, `border-top-color` acento)

## Screens / Views
La jerarquía es: **Onboarding (login → elegir liga → carga) → Shell con 5 tabs → sheets modales**.

### 1. Login / conectar Sleeper
- **Propósito**: el usuario escribe su usuario de Sleeper. Solo lectura, sin contraseña.
- **Layout**: columna, padding `78px 24px 26px`. Badge 72px circular con `pulseGlow` → H1 "Doctors Fantasy"
  (30px w500) → párrafo "Conecta tu cuenta de Sleeper. Solo lectura." (13.5px, max 30ch) → label kicker
  "USUARIO DE SLEEPER" → campo con prefijo `@` (surface, borde divider, radio 11px, padding 13/14) →
  spacer flexible → botón full-width outlined acento, min-height 50px, radio 12px.
- **Estados**: error de auth como texto `#d9a08e` 12.5px bajo el campo; Enter en el input dispara conectar;
  el label del botón cambia mientras conecta.

### 2. Elegir liga
- Kicker `@usuario` en acento, H2 "Elige tu liga" 23px, lista de ligas con gap 9px.
- Cada fila: logo 34px (si existe), nombre 14.5px w500 con ellipsis, meta 11.5px, chevron `›` acento.
  Hover: `border-color:#9184d9`. Radio 12px, fondo surface, borde divider.

### 3. Carga
- Spinner 44px + "Leyendo tu liga" (20px w500) + paso actual (13px) + log de pasos con marca acento
  por paso completado. Si falla: tarjeta de error con borde/fondo alerta y botón "Reintentar" (`.btn-secondary`).

### 4. Shell
- **Header** (padding `60px 18px 12px`, gradiente indigo → transparente): logo de liga 34px radio 9px
  (tap = cambiar de liga) · kicker (nombre de liga / contexto) + título de pantalla · avatar 34px circular
  a la derecha (tap = Ajustes), con iniciales como fallback.
- **Contenido** scrollable, padding `0 18px 18px`.
- **Tab bar** inferior con 5 tabs: Draft AI · Equipo · Cambios · Liga · Ajustes. Tab activo en acento,
  inactivo en texto terciario. Hit target ≥44px.
- Títulos por tab: `Draft AI`, `Tu equipo`, `Cambios sugeridos`, `La liga`, `Ajustes`.

### 5. Tab Draft AI (default)
- Barra de estado del draft: punto de color por estado, estado + subtítulo, acción "Actualizar" en acento.
- **Tarjeta de recomendación** (radio 14px, ground de sección + radial glow): kicker
  "RECOMENDACIÓN · PICK x.yy" → nombre del jugador 24px + meta → fit score 26px `#c9c0f0` con label
  "FIT SCORE" → chips de razones (11px, tinte acento, radio 7px) → botón `.btn-primary`
  "Ver desglose del score".
- Sub-tabs de vista (board / plan de picks) como segmented de chips.
- Chips de mis picks; nota del plan de picks en 10.5px terciario.
- Buscador "Buscar cualquier jugador de la NFL" con lupa y clear.
- Lista de jugadores rankeados; tap abre la ficha de jugador.
- **Estrategias** (afectan los pesos del fit): `Balance`, `Piso seguro`, `Explosivos`, cada una con su
  copy explicativo tal como está en el prototipo.

### 6. Tab Equipo
- Sub-tabs (roster / lineup óptimo). Stats del equipo: `Jugadores`, `Edad promedio`, `Próxima pick`
  (en acento), `Posición más floja`. Roster agrupado por posición; tap abre ficha.

### 7. Tab Cambios
- Barra superior con contexto + acción. Lista de cambios sugeridos: qué doy / qué recibo, delta de fit,
  y razón. Tap abre el detalle del cambio.

### 8. Tab Liga
- Chips de modo de orden: **Fuerza hoy · Valor a futuro · Fit hoy · Fit a futuro**.
- Tabla/lista de equipos ordenada por el modo elegido (el Fit de equipo = promedio de sus titulares óptimos).
- `leagueFacts`: Equipos, Tipo (Dynasty/Keeper/Redraft), Draft (tipo · rondas), Titulares, Temporada.
- `leagueRules`: Recepción, Bonus TE, 1er down terrestre, 1er down aéreo, Pase TD/yarda, QB iniciables,
  Taxi/keepers, Draft rookies + FAAB.

### 9. Tab Ajustes
- Tarjeta de cuenta (avatar + usuario), cambio de liga, actualizar datos
  ("Actualizando…" / "Actualizar ahora" + "Datos de HH:MM · rosters, picks cambiadas y mercado"),
  fuentes de datos, desconectar.

### 10. Ficha de jugador (sheet modal)
Entrada con `pop`. Encabezado con nombre/posición/equipo, fit score y desglose de pesos, y filas de
métricas: `Disponibilidad`, `Temporadas medidas`, `Snap %`, `Target share` (o el share de su posición),
`Mercado vs producción`, `Yardas por balón tocado`, `TD de distancia`, `Cuota zona roja`, `TD por juego`,
`TD esperados`. Cada valor cae a "sin dato" cuando falta — **ese fallback es parte del diseño**.

## Interactions & Behavior
- Navegación por tabs sin cambio de ruta; el detalle (ficha, cambio) es un sheet sobre el shell.
- Toast efímero con la marca (`mark-simple.svg`) para confirmaciones; se auto-oculta.
- Pull/tap "Actualizar" re-lee Sleeper y re-calcula; estado `syncing` con label propio.
- Cambiar de estrategia o de modo de orden re-ordena en vivo, sin recargar.
- Loading: spinner + log de pasos; Error: tarjeta de alerta + Reintentar; Empty: `noPicks`, `emptyRoster`
  con copy propio, nunca una lista vacía muda.
- Hover donde exista puntero: borde acento en filas, tinte acento en botones. Pressed: un paso de la rampa.
- Todo en un ancho de 402px (iPhone). No hay layout desktop.

## State Management
Estado principal (del prototipo, portable a store/hooks):
`username`, `authError`, `leagueOptions` + liga elegida, `booting`/`bootStep`/`bootLog`/`error`,
`ready`, `tab` (`draft|team|trades|league|settings`), sub-vista por tab, `strategy`
(`balanced|floor|upside`), `searchQ`, `detail` (jugador o cambio abierto), `syncing`/`syncedAt`,
`toast`, `usage` (métricas derivadas por jugador).

Datos: APIs públicas de Sleeper (usuario, ligas, rosters, draft, picks, players, stats) + mercado.
Los cálculos derivados (fit, lineup óptimo, TD esperados por mínimos cuadrados sobre oportunidades,
valor de mercado) viven en `src/model/*`.
**Restricción confirmada**: nflverse bloquea lecturas cross-origin — capital de draft y YPRR
no entran sin un servidor propio. No prometerlos en UI.

## Assets
- `assets/badge-primary.svg` — badge de marca (login 72px, portada del manual 54px), circular.
- `assets/mark-simple.svg` — marca compacta (header del canvas 24px, toast, encabezado del manual 13pt).
Ambos vienen de `brand/` en el repo; usar los del repo, no re-dibujarlos.
Fotografías: si se agregan, van con el wrapper `.lighten` de Nocturne y sobre fondo oscuro.

## Files
- `design/Dynasty Assistant.dc.html` — el prototipo completo de la app (todas las pantallas y la lógica).
- `design/Manual de datos.dc.html` — manual imprimible de datos y estadísticas (marca Doctors Fantasy).
- `design/ios-frame.jsx`, `design/support.js`, `design/doc-page.js` — andamiaje del prototipo, **no portar**.
- `design-system/styles.css`, `design-system/readme.md` — tokens y guía Nocturne.
- `github.md` — repo, branch, último sync y mapa pantalla → archivos del codebase.
