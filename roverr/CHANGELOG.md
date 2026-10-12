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
