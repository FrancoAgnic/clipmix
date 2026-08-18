# ClipMix 🎬

App web para hacer **collages de video**: junta varios videos en uno solo y expórtalo como un único archivo — todo funciona **en tu navegador**, sin servidores y sin subir tus videos a internet.

## Dos secciones

- **🎬 Video** — collage de videos (todo lo de abajo).
- **🖼️ Fotos** — **moodboard / carrusel panorámico** para Instagram: un lienzo largo horizontal con **color de fondo**. Las fotos que agregas quedan en un **cajón** y las sueltas al lienzo **de a una** (tocando cada una), para no amontonarlas. Tiene **deshacer/rehacer** (↶ ↷). Colocas fotos **libremente** (mover, escalar, rotar, superponer con capas al frente/al fondo). Se corta en varias slides que, al deslizar en IG, se ven **conectadas** — una foto puede quedar entre dos slides y continuar. Te desplazas por el lienzo con una **barra ↔** (arrastrar mueve la foto, no el fondo). Cada foto puede llevar un **marco** (color y grosor). Optimizado para muchas fotos: usa **proxies** de baja resolución y dibuja solo la ventana visible mientras editas (fluido con 30+ fotos), y **exporta en alta**. Descarga una imagen por slide (súbelas en orden 1, 2, 3…). Se autoguarda.

## Qué hace (Video)

- **Modo Cuadrícula** — varios videos se reproducen *al mismo tiempo* en una grilla (2 columnas, 2 filas, 3, 2×2, 1+2…). Estilo pantalla dividida.
- **Efectos / plantillas animadas** (para trends de IG): Zoom lento (Ken Burns), Entrada, Beat, Ola, Balanceo, Parallax, Foco rotativo y **Cambia videos** (las celdas van rotando qué video muestran) — con control de velocidad. Se ven en la vista previa y quedan grabados al exportar.
- **Modo Secuencia** — los videos se unen *uno tras otro* para formar un video más largo.
- **Recorte por clip** — elige desde dónde empieza y dónde termina cada video (in/out).
- **Volumen por clip** — sube o baja el audio de cada video por separado (0–150%).
- **Encuadre manual** — mueve, escala y rota cada video dentro de su celda: arrastra en la vista previa (o pellizca con dos dedos para escalar/rotar), o usa los sliders del editor ⚙.
- **Textos con temporización** — añade uno o varios textos; para cada uno eliges **cuándo aparece** (segundo) y **cuánto dura**, además de posición (arrastrando), tamaño, color y negrita. Ideal para listas en secuencia (“1 Desayuné”, “2 Gym”…).
- **Marco configurable** — color (paleta + selector libre) y grosor de las líneas de la cuadrícula.
- **Presets de cuadrícula propios** — crea tus propias grillas (filas × columnas), ponles nombre y guárdalas; quedan disponibles siempre.
- **Formatos** — 16:9, 9:16 (vertical), 1:1 (cuadrado), 4:5 (retrato), 4:3.
- **Exportar a MP4 (H.264/AAC)** con WebCodecs cuando el dispositivo lo permite (compatible con Instagram, duración correcta, menos recursos que “grabar la pantalla”). Si no hay WebCodecs, usa MediaRecorder como respaldo (y repara la duración del WebM).
- **Deshacer / rehacer** (↶ ↷ y `Ctrl+Z` / `Ctrl+Shift+Z`) en toda la edición.
- **Autoguardado**: el proyecto (videos incluidos) se guarda solo; si refrescas o se cierra, al volver sigue tu edición.
- **Modo proxy**: la vista previa se renderiza a menor resolución para ir fluido; la exportación es siempre en alta.
- **Cancelar** la exportación en cualquier momento (con watchdog anti-cuelgues).
- **Reordenar** clips con ▲▼ y elegir la calidad de exportación.

Es una **PWA** (app instalable): funciona en el navegador y también puede instalarse en el celular con su propio ícono, a pantalla completa y sin conexión.

## En el celular 📱

1. Publica la carpeta en cualquier hosting con HTTPS (GitHub Pages, Netlify, Vercel…). *La instalación como app requiere HTTPS.*
2. Abre la URL en el celular:
   - **Android (Chrome):** menú ⋮ → «Instalar app» / «Añadir a pantalla de inicio», o toca el botón **⬇ Instalar app**.
   - **iPhone (Safari):** botón Compartir → «Añadir a pantalla de inicio».
3. Ábrela desde el ícono: se ve a pantalla completa como una app normal.
4. Toca **+ Añadir** para elegir videos de tu galería, ordénalos con ▲▼, elige modo/formato y **Exportar**.

### Publicar gratis con GitHub Pages
En el repo: *Settings → Pages → Branch: `main` / root → Save*. La app queda en `https://<usuario>.github.io/clipmix/`.

## En el escritorio 💻

### Opción rápida
Abre `index.html` directamente en el navegador.

### Con un servidor local (recomendado)
Algunas funciones se restringen al abrir con `file://`. Para evitarlo:

```bash
python3 -m http.server 8000   # abre http://localhost:8000
# o: npx serve
```

## Cómo funciona (técnico)

- Cada video se carga en un elemento `<video>` en memoria (con `URL.createObjectURL`, nunca sale de tu equipo).
- Un `<canvas>` compone los cuadros de todos los videos en cada frame (`requestAnimationFrame`).
- El audio se mezcla con la **Web Audio API** (`MediaElementSource` → `MediaStreamDestination`).
- La exportación usa `canvas.captureStream()` + `MediaRecorder` para grabar el resultado a un archivo.

## Limitaciones conocidas

- El formato de salida depende del navegador: Chrome/Edge suelen exportar `.mp4` o `.webm`; Firefox y Safari exportan `.webm`.
- La exportación ocurre en tiempo real (graba mientras reproduce), así que dura lo mismo que el video final.
- **iPhone:** la exportación con `MediaRecorder` puede fallar en versiones viejas de iOS; usa Safari actualizado. La edición y la vista previa siempre funcionan. Si tu navegador no puede exportar, la app te lo avisa.
- Videos muy pesados o muchos a la vez pueden exigir bastante al equipo.

## Estructura

```
index.html            — interfaz (mobile-first, con pestañas)
style.css             — estilos + diseño responsive
app.js                — toda la lógica (carga, composición, export, PWA)
manifest.webmanifest  — metadatos de la app instalable
sw.js                 — service worker (uso offline)
icons/                — íconos de la app
```

## Licencia

MIT
