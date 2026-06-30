# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rong VideoPlayer is a macOS-native-feel desktop video player built with **Electron + HTML5 + FFmpeg**. It imports a local folder as a directory tree, plays virtually all common video formats (MP4, MKV, RMVB, AVI, FLV, WMV, MOV, …), and transparently transcodes formats Chromium cannot play natively via a local ffmpeg stream. It also bundles a Bilibili downloader, an online sharing community, and a screenshot library.

The UI text and code comments are in **Chinese (zh-CN)** — match this convention when adding user-facing strings or comments.

## Commands

```bash
npm install        # install Electron + electron-builder
npm start          # run the dev app (electron .)
npm run pack       # build unsigned .app into dist/mac-arm64/ (electron-builder --dir)
npm run dist       # build distributable .dmg into dist/
./build.sh         # interactive wrapper: app | dmg | all (1/2/3)
```

There is no test suite, linter, or formatter configured.

**Runtime requirement:** `ffmpeg` and `ffprobe` must be resolvable on `PATH` (Homebrew `/opt/homebrew/bin/ffmpeg`). Resolution is dynamic (`which`/`where` → common paths → bundled `bin/`) in `resolveBinaryPath()`; the Bilibili downloader hard-aborts if ffmpeg is missing.

## Architecture

Two-layer Electron app with **`nodeIntegration: true` and `contextIsolation: false`** (`createWindow()` in main.js). The renderer therefore `require`s `electron`/`path` directly and calls `ipcRenderer.invoke` without a preload bridge — do not introduce a preload/context-isolation layer without rewiring every IPC call.

### Main process — `main.js` (~1200 lines, single file)

Holds all Node/system capabilities, exposed exclusively via `ipcMain.handle` channels:

- **Local video server** (`startVideoServer`, port `30032`, hardcoded). Handles two routes:
  - `GET /video?path=<abs>&start=<sec>` — `probeVideoInfo` (ffprobe) → `checkNeedsTranscode` decides:
    - *Native* (`.mp4/.webm/.ogg/.mov/.m4v` with supported codecs h264/vp8/vp9/av1 + aac/mp3/opus/vorbis/flac): HTTP **206 range** streaming via `streamNative`.
    - *Transcode* (everything else, e.g. MKV/RMVB or unsupported codecs): `streamTranscode` spawns `ffmpeg -ss <start> -i … -c:v libx264 -preset ultrafast -tune zerolatency -movflags frag_keyframe+empty_moov+default_base_moof pipe:1`. If a stream is already h264/aac it is `-c copy`'d to save CPU. On client `req.close` (seek/abort) the ffmpeg child is `SIGKILL`'d.
  - `GET /screenshot?path=<abs>` — streams a PNG.
  - `EADDRINUSE` on 30032 is **tolerated** (assumes another app instance is running) rather than fatal.
- **Directory tree** (`buildDirectoryTree`, recursive, max depth 6, filters to video extensions, drops empty folders, sorts dirs-first then `zh-CN` numeric).
- **History persistence** → `userData/playback-history.json` (last directory, per-file playback position, recent list, theme, `autoplayNext`, and Bilibili `sessdata`). `get-history`/`save-history` do a read-merge-write, so partial history objects are safe.
- **Bilibili engine** (large block, ~lines 457–1062): QR-code login → `SESSDATA` extraction → playlist parsing (`fetchBiliPlaylist`: multi-P / UGC season / `__INITIAL_STATE__` HTML scrape / single) → DASH playurl with automatic quality fallback (`fetchBiliPlayurl`) → concurrent download queue (`MAX_CONCURRENT_DOWNLOADS = 3`, `AbortController`-based pause/cancel) → `mergeAudioVideo` via ffmpeg. HEVC sources get `-tag:v hvc1` injected (`probeHEVC`) so they play natively on macOS. Progress/status pushed to renderer via `mainWindow.webContents.send('download-task-update', …)`; completed downloads emit `'rescan-directory'`.
- **Screenshot subsystem** → `userData/Screenshots/` (PNGs) + `userData/screenshots-db.json` (categories + metadata).

App lifecycle: `startVideoServer()` + `createWindow()` on `whenReady`; video server closed on `will-quit`.

### Renderer — `renderer.js` (~3300 lines, single file) + `index.html` + `index.css`

Organized into four feature blocks, each delineated by `// =====…` banner comments and an `init*()` entry point called from the `DOMContentLoaded` handler at the top:

1. **Core player** — directory tree render/search, playback (`playVideo` probes then sets `<video src>` to `http://localhost:30032/video?…`), custom controls, timeline, volume, speed, fullscreen, keyboard shortcuts. For transcoded streams the displayed progress is synthesized from `transcodeStartTime + video.currentTime` (see `playVideo` / `onVideoTimeUpdate`).
2. **Bilibili downloader** — `initBilibiliDownloader()`; renders task list, listens for `download-task-update`.
3. **Online community** — `initOnlineCommunity()`; collection sharing grid, detail modal, and a hidden super-admin audit portal.
4. **Screenshot library** — `initScreenshotsLibrary()`; category sidebar, grid, lightbox.

State lives in module-level `let`s at the top of `renderer.js` (e.g. `currentDirectory`, `currentFilePath`, `isTranscoding`, `transcodeStartTime`, `recentList`, `currentTheme`). The theme system uses named "中国传统色彩" skins (default + 玄天/竹翠/缃叶/黛墨/凝脂) applied via `setTheme()` and persisted in history.

### IPC contract (the API surface between the two layers)

Adding a backend capability means: implement in `main.js` as `ipcMain.handle('<channel>', …)`, then call `ipcRenderer.invoke('<channel>', …)` from `renderer.js`. Push-style updates go the other way via `mainWindow.webContents.send` + `ipcRenderer.on`. Existing channels: `select-directory`, `get-directory-tree`, `open-in-finder`, `probe-video`, `get-history`, `save-history`, `bili-*` (qrcode/poll-login/get-profile/parse-url/start-download/cancel-task/pause-all/start-all/get-tasks), `get-screenshots-db`, `save-screenshots-db`, `save-screenshot`, `delete-screenshot-file`, `open-image-in-finder`, `copy-image-to-clipboard`.

## Platform & build notes

- **macOS-only target.** `titleBarStyle: 'hidden'` with relocated traffic lights; electron-builder produces `dmg` for `mac-arm64`. `app.on('window-all-closed')` quits only on non-darwin (standard macOS keep-alive).
- `ocr_mac.swift` (compiled to `bin/ocr_mac`, an arm64 Mach-O) is a Vision OCR helper (zh-Hans + en-US) bundled via `build.extraResources`. It is **not currently invoked from the renderer** — treat it as a staged/available binary.
- Design docs live in `Docs/` (`screenshot_management_design.md`, `video_sharing_design.md`) and describe intended behavior for the screenshot and community features.
- `dist/` is a build output (gitignored); the source of truth is `index.html` / `index.css` / `main.js` / `renderer.js` at the repo root.
