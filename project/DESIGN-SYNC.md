repo: jorgeleal2002-blip/fantasy-copilot
branch: main

## Last sync
date: 2026-08-12T18:32:02Z

### Updated in this project
- Liga: cuatro modos de orden (Fuerza hoy / Valor a futuro / Fit hoy / Fit a futuro); el Fit de equipo es el promedio de sus titulares óptimos.
- El stack de equipo NFL ahora se mide dentro del roster de cada equipo, no siempre contra el mío.
- TD esperados por mínimos cuadrados sobre oportunidades (Sleeper stats, mismo player_id); el Fit usa esperados en vez de anotados.
- Confirmado en `src/model/usage.ts`: nflverse bloquea lecturas cross-origin — capital de draft y YPRR no entran sin servidor.
- Brought the real brand in: `badge-primary.svg` and `mark-simple.svg` copied from the repo's `brand/`.
- Renamed the prototype from "Fantasy Copilot" to "Doctors Fantasy" (login, canvas label).
- Replaced the ◈ placeholder glyph with the mark on the login screen and in the toast.

## Screen map
| Screen | Repo files |
| --- | --- |
| Shell + tab bar | src/screens/AppShell.tsx, src/App.tsx |
| Equipo | src/screens/TeamTab.tsx, src/screens/TeamSheet.tsx |
| Cambios | src/screens/TradesTab.tsx |
| Draft | src/screens/DraftTab.tsx |
| Liga | src/screens/LeagueTab.tsx |
| Ajustes / You | src/screens/SettingsTab.tsx |
| Onboarding | src/screens/Onboarding.tsx |
| Ficha de jugador | src/screens/PlayerSheet.tsx |
| Motor (fit, lineup, trades) | src/model/*.ts |
| Datos | src/api/sleeper.ts, src/model/market.ts |
| Estilos Nocturne | src/styles/tokens.css, src/styles/global.css |
| Prototipo original | project/Dynasty Assistant.dc.html |
| Marca | brand/badge-primary.svg, brand/mark-simple.svg, src/ui/Mark.tsx |
