# ClipMix 🎬

App web para hacer **collages de video**: junta varios videos en uno solo y expórtalo como un único archivo — todo funciona **en tu navegador**, sin servidores y sin subir tus videos a internet.

## Qué hace

- **Modo Cuadrícula** — varios videos se reproducen *al mismo tiempo* en una grilla (2 columnas, 2 filas, 3, 2×2, 1+2…). Estilo pantalla dividida.
- **Modo Secuencia** — los videos se unen *uno tras otro* para formar un video más largo.
- **Formatos** — 16:9, 9:16 (vertical), 1:1 (cuadrado), 4:5 (retrato), 4:3.
- **Exportar** — genera un solo archivo de video (`.mp4` o `.webm` según el navegador) con audio mezclado.
- **Reordenar** clips arrastrándolos, y elegir la calidad de exportación.

## Cómo usarla

No necesita instalación ni compilación. Basta con abrir la app en un navegador moderno (Chrome o Edge recomendados).

### Opción rápida
Abre `index.html` directamente en el navegador.

### Con un servidor local (recomendado)
Algunos navegadores restringen funciones cuando el archivo se abre con `file://`. Para evitarlo:

```bash
# Con Python
python3 -m http.server 8000
# luego abre http://localhost:8000

# O con Node
npx serve
```

## Cómo funciona (técnico)

- Cada video se carga en un elemento `<video>` en memoria (con `URL.createObjectURL`, nunca sale de tu equipo).
- Un `<canvas>` compone los cuadros de todos los videos en cada frame (`requestAnimationFrame`).
- El audio se mezcla con la **Web Audio API** (`MediaElementSource` → `MediaStreamDestination`).
- La exportación usa `canvas.captureStream()` + `MediaRecorder` para grabar el resultado a un archivo.

## Limitaciones conocidas

- El formato de salida depende del navegador: Chrome/Edge suelen exportar `.mp4` o `.webm`; Firefox exporta `.webm`.
- La exportación ocurre en tiempo real (graba mientras reproduce), así que dura lo mismo que el video final.
- Videos muy pesados o muchos a la vez pueden exigir bastante al equipo.

## Estructura

```
index.html   — interfaz
style.css    — estilos
app.js       — toda la lógica (carga, composición, export)
```

## Licencia

MIT
