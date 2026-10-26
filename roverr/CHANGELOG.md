## 4.5.23

- Prepara el interés en segundo plano al cargar el panel, lo guarda en la base de datos y notifica al dashboard: el marco dorado no depende de abrir la ficha y se conserva tras reiniciar.
- Actualiza los votos y la nota de TMDB junto al índice de interés para no combinar datos actuales con valoraciones antiguas.
- Sustituye «Muy popular» por «Interés alto ahora» y aclara que mucha actividad puede coexistir con pocos votos.

## 4.5.22

- Integra las notas y votos de TMDB e IMDb en la tarjeta central de alcance del público; elimina el bloque independiente de valoraciones para ahorrar espacio.
- Mantiene enlaces a las fuentes, carga independiente de IMDb y diseño compacto adaptable a móvil.
- Conserva los nodos de valoración al actualizar el interés para evitar que una respuesta tardía borre una nota ya cargada, incluso si falla TMDB.

## 4.5.21

- Destaca en el panel las películas con popularidad TMDB de 50 o más mediante un marco dorado fino y un pequeño icono de fuego con explicación.
- Funciona sin abrir las fichas, con consultas limitadas a tres simultáneas y caché de seis horas. No bloquea la carga de carátulas ni altera la selección o los estados de copia.
- Descarta respuestas de tarjetas retiradas o que hayan cambiado de película y elimina el marco si el interés deja de ser alto.

## 4.5.20

- Añade a las fichas un bloque compacto «Interés y alcance»: popularidad actual, número de votos y presupuesto/taquilla de TMDB.
- Incluye iconos, explicación de los umbrales orientativos y datos ausentes; no confunde popularidad o presupuesto con calidad ni expectación histórica.
- Consulta independiente con caché de seis horas y conservación del último dato ante fallos, sin bloquear la ficha ni requerir claves adicionales.

## 4.5.19

- Sustituye la lectura del HTML de IMDb (bloqueada por HTTP 403) por su conjunto oficial diario de notas y votos, sin claves adicionales.
- Carga IMDb por separado al abrir una ficha, también para películas ya guardadas; no bloquea la visualización de la película.
- Conserva la última caché si falla la actualización y distingue entre títulos sin votos y un fallo de consulta.
- Traduce los recuentos de votos y muestra su fuente en la ficha.

## 4.5.18

- Guarda inmediatamente en el servidor los cambios al añadir o editar una fuente RSS, incluido el año mínimo; si falla el guardado, mantiene el formulario.
- Aplica el año mínimo también a los reintentos de descarga automática y bloquea las entradas sin año cuando hay un mínimo configurado.
- Las entradas excluidas por año no se añaden permanentemente a ignorados, para que un cambio posterior del límite pueda aplicarse.
- Cada entrada utiliza la configuración de su fuente original, incluso si varias fuentes comparten nombre; no procesa fuentes desactivadas.

## 4.5.17

- Conserva la ficha TMDB elegida al descargar desde el buscador, aunque el torrent use otro idioma.
- Los torrents sin metadatos aparecen en el panel incluso con bases antiguas que exigen valoraciones no nulas.
- Una descarga manual confirmada sale de seguimiento sin perder historial ni decisiones de copia.

# 4.5.16

- El buscador identifica las películas ignoradas en los resultados de TMDB y
  avisa al consultar sus torrents. Ofrece «Restaurar y descargar» en el buscador
  principal y en la búsqueda manual de descargas.
- Requiere una acción explícita para restaurar. Si el estado cambia después de
  buscar, el servidor devuelve el aviso y el botón pide la nueva acción.
- Restaura las versiones ignoradas de la película identificada por TMDB, o por
  título y año cuando no hay identificación, después de aceptar la descarga.
  Conserva metadatos, historial y decisiones independientes de pausa/conflicto.
- Reutiliza el torrent solicitado cuando ya existe y respeta la configuración
  de copia automática de búsquedas manuales. No identifica la descarga por el
  último torrent añadido; informa cuando queda pendiente de confirmación.
- Abrir una ficha deja de quitar incidentalmente el estado de ignorada. Los
  mensajes del flujo de búsqueda están en español y los botones se adaptan al
  móvil. No requiere actualizar el receptor.

Validado con 13 regresiones nuevas de identidad, restauración explícita,
fallos del cliente, versiones, historial, confirmación y configuración de copia;
y prueba de navegador del aviso, botones, errores, cambios posteriores a la
búsqueda, títulos con comillas, actualización del panel y vista móvil.

# 4.5.15

- Panel con búsqueda por título, año y nombre del torrent; filtros por estado,
  año y origen RSS; ordenación por fecha de incorporación, título, año, tamaño
  y posición en la cola. Preferencias guardadas en el navegador.
- Contadores por película única, accesos directos por estado, resultados sin
  coincidencias y carteles compactos opcionales. Estados y filtros se actualizan
  en directo sin perder las preferencias al abrir una ficha.
- Seleccionar visibles respeta los filtros. El contador informa de las películas
  seleccionadas fuera de la vista y mantiene juntas sus distintas versiones.
- Actividad más compacta: copia activa y siguiente pendiente, controles de prioridad
  con ayuda, cola completa desplegable, ayuda y resultados recientes plegados.
  Conserva progreso, velocidad, tiempo estimado, pausa, reanudación y detención.
- Cabecera del panel adaptable a su contenido, navegación reducida en móvil y
  metadatos de carteles legibles. Consulta y cuenta atrás RSS en español.

Validado con pruebas de navegador de búsqueda, filtros, selección, preferencias,
ordenación, actualizaciones en directo, agrupación de versiones, controles de
cola y diseño móvil. No requiere cambios ni reinicio del receptor.

# 4.5.14

- Add Settings → Diagnostics with on-demand qBittorrent authentication and
  receptor health checks, mapped source/destination paths, read/write/delete
  permissions, disk space, SQLite/queue health and automatic copy policy.
- Run filesystem checks where copies actually execute: on Home Assistant for
  local transfers or on the Windows receiver when remote copying is enabled.
- Show clear Spanish results, skipped checks and corrective actions. Use a tiny
  uniquely named destination probe; remove only that probe. Never create a
  missing library root or modify media files during diagnostics.
- Download the completed diagnostic as JSON without rerunning checks. Export
  only allowlisted fields; redact credentials, tokens and URL user information.
  Do not export settings, copy options, torrent history messages or raw logs.
- Allow receptor status/control requests while a diagnostic probe is running.
  Reserve copy hashes atomically to prevent duplicate starts under concurrent
  HTTP requests.

Validated with 114 backend regressions including permission failures, full
disks, missing mappings, unavailable/older receivers, credential redaction,
probe cleanup, cached exports and concurrent copy admission. Browser tests
cover clear actions, escaped paths, JSON download and mobile layout.

Update/restart the PC receptor when current copies finish to enable remote
filesystem diagnostics. Receptor 4.5.13 continues copying normally; the addon
shows a diagnostic compatibility warning until it is updated.

# 4.5.13

- Add an activity panel showing the active transfer, progress, speed, approximate
  remaining transfer time, FIFO positions and recent results. Verification
  remains separate from the transfer time estimate.
- Pause/resume the whole copy queue, including the active local or remote copy,
  at block boundaries without deleting owned partial files. Persist the pause
  in SQLite and restore it before admitting work after a restart.
- Reorder waiting copies with Up, Down and Move first. Save their order and
  update workers atomically without interrupting the active transfer.
- Stop remains distinct: it works during pause and removes incomplete files.
- Require receptor 4.5.13 for pause/resume support. The activity response does
  not expose saved options or credentials.

Validated with 96 backend regressions, including local/remote pause and resume,
stop during pause, completion races, persisted FIFO changes and restoration
of a paused queue in a separate process. Browser tests cover activity, ETA,
queue controls and mobile layout.

Restart the updated PC receptor when existing transfers finish, then update
the addon. A paused queue stays paused until Resume queue is pressed.

# 4.5.12

- Resume an interrupted staged transfer only after matching its saved source
  identity and checking the entire written prefix against the current source.
  Unknown, corrupted or outdated partials restart safely.
- Flush copied data and verify the full source and staged output with SHA-256
  before replacing the final destination or recording success.
- Show Checking partial copy and Verifying copy in the dashboard and details.
  The next queued copy waits for verification to finish.
- Keep owned partials after I/O errors for a validated retry; explicit Stop
  removes partials and metadata, preserving existing final files. Persist
  cleanup requests and recover them after addon or receptor restarts.
- Identify remote attempts separately so an old completed/failed task cannot
  satisfy a new copy request. Require verification confirmation for new jobs.

Validated with 83 backend regressions, including valid/corrupted partials,
source changes, same-size corruption, independent-process resume, remote retry
provenance, cleanup after
restart and disk space accounting. Browser checks cover verification phases,
queue positions and completion refresh.

Update the PC receptor script and restart it when current transfers have
finished, then update the addon. The new addon requests receptor 4.5.12 before
admitting new remote copies. Legacy partials without metadata restart from zero.
Full verification rereads both files and therefore adds disk I/O and time after
the transfer reaches 100%. An interrupted transfer can resume; an explicit Stop
cleans its partial and the next manual start begins from zero.

# 4.5.11

- Group torrents with the same movie identity into one dashboard card, keeping
  each torrent, copy job and history intact. Prefer active copy/queue status.
- Show versions, sizes, states and blockers in the movie details; select a
  version to manage its torrent. Bulk copy selects one representative per movie,
  while bulk stop/removal includes every version of selected movies.
- Preserve selection when the active version changes. Keep movies with different
  TMDB IDs or ambiguous unidentified matches separate.
- Translate movie actions, RSS controls, common messages and saved download
  rejection reasons into Spanish.
- Manual search no longer removes the existing real torrent record.

Validated with 62 backend regressions, JavaScript status and identity tests,
and browser checks for grouped versions, preserved selection, stopping every
version, queue positions and completion refresh without F5.

# 4.5.10

- Preserve the original download rejection reason, including RSS size limits,
  for undownloaded movies even when they carry a copy hold.
- Show Stopped / Resume copy only for completed downloads with an explicit
  manual copy pause. A legacy hold alone no longer implies cancellation.
- Do not classify undownloaded RSS movies as destination conflicts or failed
  copies.

# 4.5.9

- Unify dashboard and details status labels in Spanish. Distinguish stopped
  copies, destination conflicts and recovery from ordinary pending work.
- Show the reason in the movie details as well as the dashboard tooltip, with
  contextual Resume, Review destination and Retry copy buttons.
- Refresh details when the reason or manual hold changes even if the internal
  scheduler status stays the same. Preserve live recovery and queue tooltips.
- Keep scheduler states and persistent queue semantics unchanged.

# 4.5.8

- Persist copy jobs, their FIFO order, source/path snapshot and confirmed
  overwrite decision in SQLite before acknowledging admission. The saved queue
  is restored before automatic work starts and deduplicated by torrent hash.
- Reattach to a receptor task that is still copying or completed while the addon
  was offline. Query its status before dispatching; never start a duplicate task.
  An unreachable receptor holds the transfer slot until its state is known.
- Persist stop requests and cancellations across restarts. Link completion
  history to its copy job so another torrent's history cannot complete a job.
- Stage normal copies as well as overwrites. Local interrupted jobs safely
  restart their owned temporary file from the beginning; changed originals or
  destinations require a fresh manual decision. Existing destination files are
  preserved until the temporary copy has completed.
- Store no torrent passwords, API keys or notification tokens in copy jobs.

Validated with 62 regression tests, including restoration from an independent
Python process/SQLite connection, FIFO recovery, remote reattachment without a
new copy request, offline recovery blocking the queue, persistent cancellation,
temporary-file restart, history provenance and migration of existing history.
Browser checks cover queue positions and completion updates without F5.

## First upgrade to 4.5.8

The older version's in-memory queue cannot be restored retroactively. Finish
the active copy and stop the waiting queue before this first upgrade, replace
and restart the PC's `roverr_receptor.py`, then update the addon. Re-select the
old waiting movies manually once. From 4.5.8 onward, newly admitted jobs and
their order survive addon updates and restarts.

Updating this addon does not update or restart the standalone receptor on the
PC. Remote recovery requires the receptor to be reachable eventually; if the PC
receptor itself restarted and forgot its tasks, the addon compares the saved
files again and preserves conflicting destinations for a manual decision.

# 4.5.7

- Fix the background scheduler's missing `sync_movies` import, which caused a
  NameError outside browser-driven synchronization and prevented headless copy
  admission. Validate the real scheduler/client/sync/queue path end to end.
- Reconcile a synthetic RSS entry with its real torrent using TMDB identity or
  matching title/year; retain user holds and watchlist choices, preserve ignored
  entries, and leave ambiguous matches untouched. Existing RSS duplicates are
  repaired during normal torrent synchronization.
- Reuse an exact torrent already in qBittorrent instead of treating it as a
  failed addition. Allow up to 15 seconds for confirmation, never assign an
  unrelated newly added torrent, and retry uncertain RSS confirmations later.
- Record RSS feed origin so automatic copy does not depend only on torrent tags.
  Reconcile completed downloads every 10 seconds independently of WebSocket
  clients, including downloads already complete on first discovery.
- Automatically admit eligible completed movies to the existing FIFO copy queue:
  one copies while the rest show their queue positions. TMDB availability does
  not gate background processing of completed downloads.
- Distinguish explicit manual holds from destination conflicts and show why a
  pending movie cannot start. Recover legacy unclassified recovery holds only
  for eligible pending movies without cancellation/error history; preserve
  explicit holds and registered cancellations. Existing destinations still
  require a manual overwrite/keep decision.

No receptor script change is required for 4.5.7.

Validated with 49 regression tests, including the real background scheduler
admitting three complete downloads with zero WebSocket clients, FIFO positions,
RSS reconciliation/retries, existing-torrent confirmation and preservation of
manual holds. Browser checks cover live completion refresh and queue details.

# 4.5.6

- Refresh completed copies immediately without F5. Notify the server event loop
  safely from copy worker threads and serialize full movie broadcasts.
- Export the card/series render functions consumed by WebSocket full updates;
  those messages previously failed before refreshing any cards.
- Do not send a progress snapshot captured before completion after publishing
  the newer final state; exclude terminal copy states from active progress.
- Process WebSocket messages in order and reconcile jobs missing from progress
  with their actual success/cancellation/error state. Refresh open movie details
  when a full update changes their status.
- Suppress recursive notifications caused by the broadcast's own database sync.

No receptor script change is required for 4.5.6.

Validated with 32 regression tests and a browser simulation of one movie
finishing while the next starts, including recovery from a missing final-state
message without reloading the page.

# 4.5.5

- Show **En cola** in movie details, with the current position among waiting
  movies instead of a misleading copying percentage or transfer speed.
- Hover over the status in cards/details to see the position, number waiting,
  currently active movie and explanation that position 1 is next to start.
- Use FIFO admission so the displayed queue order matches execution. Cancelled
  waiting copies leave immediately and remaining positions update live through
  WebSocket or polling. The active transfer is not counted as a waiting movie.

No receptor script change is required for 4.5.5.

# 4.5.4

- Compare source/destination files before manual copying. When a destination
  exists, show a dialog with real paths, exact sizes, modification times and the
  size difference for each file. Equal sizes do not imply verified integrity.
- Offer **Sobrescribir**, **Conservar y marcar como copiada** and **Cancelar**.
  The same dialog is used for individual and selected movie copies, including
  retries of movies currently marked as errors.
- Overwrite through temporary files and replace the destination after copying
  finishes; cancelling preserves an existing destination. Recheck the comparison
  before queued work starts and before replacing files so stale decisions cannot
  overwrite a changed file.
- Detect conflicts on the PC via a new Receptor inspection endpoint. Automatic
  copies hold existing-file conflicts for a manual decision instead of overwriting.

Update and restart the PC's `roverr_receptor.py` before using 4.5.4. The addon
reports an actionable message if the running receptor lacks file comparison.

Validated with 29 regression tests, including local/remote conflict inspection,
HTTP routes, retaining files, overwrite completion/cancellation and stale
comparisons. Browser smoke tests cover desktop/mobile layout and all three
dialog actions. Install `httpx` alongside addon dependencies to run the HTTP
route tests.

# 4.5.3

- Monitor download completion with no browser connected. Automatic copy no
  longer relies on a dashboard refresh or a WebSocket subscriber.
- Queue transfers and run only one copy at a time, including remote copies.
- Add **Detener copias** to the dashboard selection toolbar. It cancels active
  and queued copies and holds selected pending movies for manual copying.
- Persist cancellation across synchronization and restarts. Use **Copy Selected**
  or the individual copy action to release a movie's hold.
- Propagate cancellation instead of recording a cancelled transfer as successful.
  Remove files created by the cancelled task and remove the destination movie
  directory if it is empty. Preserve source files and existing destination files.
- On the first successful nonempty torrent synchronization after upgrading to
  4.5.3, hold movies already fully downloaded for manual recovery. Later download
  completions retain the configured RSS/manual-search automatic copy behavior.
- Run RSS fetching outside the web server event loop.

## Upgrade

Update Roverr to **4.5.3**. The already downloaded backlog stays pending so you
can select it and press **Detener copias**, then start chosen movies manually.
Copies initiated manually also run one at a time.

If **Receptor** is enabled, stop the old receptor process on the PC, replace
`scripts/roverr_receptor.py` with this version and restart it before starting
Roverr. The updated receptor confirms cancellation only after removing its
incomplete output. Updating the Home Assistant addon does not replace a script
running on another computer.

Files left by transfers interrupted before this upgrade are not automatically
removed: the new cleanup tracks files created by each running task so it cannot
delete unrelated files from an existing library.

## Validation

Run `python -m unittest discover -s roverr/tests -v` with the addon dependencies
installed. Tests use temporary SQLite databases and media files with mocked
qBittorrent/TMDB/network calls; no Home Assistant instance is required.
