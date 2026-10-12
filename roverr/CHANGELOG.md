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
