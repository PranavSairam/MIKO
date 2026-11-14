# MIKO — Phase 1

A small desktop puppy for Windows. This phase is the overlay only: a frameless always-on-top window, a placeholder puppy, a local note panel, and a tray menu. The realistic puppy is Phase 2. Notes are not saved and are not sent anywhere.

Development and the production bundle both run on macOS. Windows still needs the smoke test below; this repo does not build an installer.

Requires Node.js 22.12 or newer.

## Try the build

```bash
npm install
npm run build
npm start
```

`npm install` also downloads the Electron binary. `npm start` launches the production bundle in `out/`. Leave this terminal open. Quit from the tray, or press Ctrl+C in the terminal.

For a dev session with reload:

```bash
npm run dev
```

Check types and the layout tests:

```bash
npm run typecheck
npm test
```

## Controls

| Action | What it does |
| --- | --- |
| Click the puppy | A short pet reaction, then the app fan opens above MIKO (macOS). A brief pause lets a double-click cancel it. |
| Tab + Q (macOS) | Opens or closes the app fan: every running app as a card. Click a card or use ←/→ and Enter to switch; type to filter; 1–9 picks directly; × quits an app; Tab (or the Tabs chip) on Chrome/Safari lists its tabs. Esc closes. |
| "open ChatGPT" | Launches or focuses the ChatGPT desktop app; opens chatgpt.com in your default browser if the app isn't installed. MIKO says which happened. |
| Saved chats | Panel → **Saved chats**: Add (name + chatgpt.com conversation, Project or custom GPT link), Open, Rename (✎), Remove (×). Say or type "open my FreshNet chat" or "show saved chats". Links open through the system's normal handler (your default browser unless that's ChatGPT). |
| "ask GPT <question>" | Shows the exact question with **Copy and open ChatGPT** and an optional saved-chat destination. Copies the question and brings ChatGPT forward; you paste it. **Paste reply** brings an answer back. |
| Hold Caps Lock + A (macOS) | Push-to-talk. MIKO listens while both are held and puts the words in the chat box when you let go (not sent). Caps Lock is restored. Needs Accessibility for "MIKO Keys" once. |
| Double-click the puppy | Opens the note panel beside MIKO. The note stays inside the display work area, flipping to the other side of the puppy when the first side does not fit. |
| Esc | Closes the note. MIKO stays visible. The window has to be focused (click the puppy or the note first). |
| Hold Alt (Windows) or Option (macOS) and drag | Moves MIKO. The puppy stays inside the work area of the nearest display, above the taskbar or Dock. |
| Tray → Show | Shows the puppy again. |
| Tray → Hide | Hides the puppy. The tray icon stays. |
| Tray → Quit | Exits. On Windows, Alt+F4 hides MIKO instead of quitting. |

On macOS the Dock icon is hidden. Use the menu-bar paw, or the MIKO menu, for Show, Hide, and Quit. A second launch shows the puppy that is already running.

The text box is a preview. Closing the panel discards nothing on disk because nothing was written.

## Windows smoke test

Run this on a Windows machine after `npm install`, `npm run build`, and `npm start`.

1. MIKO appears at the bottom-right of the primary display's work area, above the taskbar, with no taskbar button and no window frame. The area around the drawing is transparent, not a black or white box.
2. Rest the pointer on the puppy for a moment, then click once. The puppy hops and a heart fades. The desktop underneath does not receive that click.
3. Click the empty padding around the drawing, and click a window behind MIKO. Those clicks reach the window underneath.
4. Double-click the puppy. The note opens beside it and stays fully on screen. Drag MIKO to the left edge, close the note, and double-click again. The note opens on the other side.
5. Type in the note. Esc closes it. The puppy remains. Nothing is written to disk.
6. Hold Alt and drag. MIKO follows the pointer and does not slide under the taskbar or off the screen. Release Alt without dragging and the puppy does not treat that as a pet.
7. Right-click the tray paw (left-click should open the same menu). Hide, then Show. Quit, and confirm the process is gone.
8. Repeat the click-through check on a display set to 150% scale. The clickable area should still match the drawing, not a larger or smaller box.

## Click-through

Hit testing is rectangular, not per-pixel. Transparent pixels inside the puppy's box and inside the note card still belong to MIKO. The padding around the puppy, and the gap between the puppy and the note, pass clicks through.

The main process reads the cursor every 40ms and toggles `setIgnoreMouseEvents`. It does not use `{ forward: true }`. On Windows that option installs a `WH_MOUSE_LL` hook on Electron's UI thread, and a busy main thread can stall the system cursor. The tradeoff is that a click in the first instant after the pointer enters the puppy can fall through. Pause on the puppy, then click.

While an Alt/Option drag is held, the window stays clickable even if the pointer leaves the drawing.

Coordinates are Electron DIP (CSS pixels). The code does not multiply by `scaleFactor`. `BrowserWindow.setOpacity` is not used; on Windows it replaces per-pixel transparency with one alpha for the whole window.

A work area narrower than the puppy (220px) cannot contain it. A work area narrower than the puppy plus the note (about 504px) can force the puppy to shift when the note opens. Dragging onto another monitor snaps the puppy fully into that monitor's work area.

## Layout

```text
src/main        window, tray, IPC
src/preload     the four methods on window.miko
src/renderer    React UI, PetView, local note state
src/shared      window geometry shared by the main process and the UI
resources       tray icons
```

The renderer has `nodeIntegration` off, `contextIsolation` on, and `sandbox` on. `window.miko` exposes `moveBy`, `setPanelOpen`, `setHitRects`, and `setDragActive` only.

Replace `src/renderer/src/components/PetView.tsx` and `src/renderer/src/assets/puppy.svg` when the real puppy arrives. Keep the outer box so the hit target still matches the drawing.
