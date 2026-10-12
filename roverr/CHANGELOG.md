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
