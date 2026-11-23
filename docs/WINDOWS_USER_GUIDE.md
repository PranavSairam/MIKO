# MIKO for Windows — short user guide

No Git, Node, Cursor, or source code required. Start from the installer file you were given.

## Install

1. Find **`MIKO-0.1.2-win-x64.exe`** (or the version on the file name).
2. Double-click it. A progress bar runs; there is nothing to choose and no administrator prompt (it installs for your Windows account only).
3. MIKO starts by itself when the bar finishes. Later, start it from the **Start menu → MIKO**. A desktop shortcut and "start when I sign in" are optional: tick them in the last setup step or in **Help & Setup**.

Running the installer again (or a newer one) upgrades MIKO and keeps your settings and ChatGPT sign-in. Only one MIKO runs at a time.

### SmartScreen (unsigned build)

Windows may show **Windows protected your PC** because this build is not code-signed.

1. Click **More info**.
2. Click **Run anyway**.

That is expected for this private beta. Do not turn off SmartScreen permanently.

## First launch

- MIKO opens five short steps: **Meet MIKO** (pick a pet), **Try MIKO** (click, drag, show/hide), **Enable voice** (optional microphone test), **Use ChatGPT** (optional Interactive GPT sign-in), **Ready** (three example commands). **Skip for now** closes it and remembers the step; **Help & Setup → Continue setup** picks it up again. The pet and typed commands work without finishing any of it.
- Show / hide with **Ctrl+Shift+R**, or the tray icon → **Show** / **Hide**.
- **Help & Setup** (tray icon menu, or Preferences): test the microphone, see or change the shortcut, reopen the tutorial, open Interactive GPT, see what works on Windows, send feedback (preview first), open the logs folder, desktop shortcut / start at sign-in.
- Settings live in **`%APPDATA%\MIKO-Beta\`** (not inside the installer).

## What works on Windows (core)

- Pet on screen, drag, tray menu  
- Panel commands that open apps / websites when Windows can find them  
- Microphone via the panel mic / tray **Talk to MIKO** (System.Speech) — allow mic privacy if Windows asks. **Help & Setup → Test microphone** shows the microphone Windows is using, listens, and shows the words (they are not run as a command). Windows speech always uses the **Windows default microphone**; "Change microphone…" opens Sound settings to pick another.  
- **Casual mode** (Preferences → Mode, or tray → Mode): a small **Play** button appears when you point at MIKO. **Fetch** (pick Ball or Stick, drag and let go to throw it; MIKO runs, picks it up and brings it back), **Feed** (drag a treat onto MIKO), **Pet** (move the pointer back and forth over MIKO, no click). **Esc** or **Done** stops. Any command stops play first. **Work** mode (the default) has no games. Play sounds are off unless you turn them on.  
- **Hold Shift + A** to talk, let go to stop (a quick tap still types "A")  
- **Tab + Q** opens the app switcher (click an app to switch to it)  
- **Interactive GPT** floating window (separate from the Codex assistant)  
- **WhatsApp contact search:** "Search for Dad in WhatsApp", "Open WhatsApp and find Mukundan". After "Open WhatsApp", just "Open Dad" or "Go to Gayu Sis". Several matches → MIKO shows them and you pick; no match → say the corrected name, or "Cancel". MIKO only opens the chat. It never types in the message box or sends anything.  
- **Web search in Chrome:** "Search Chrome for budget headphones", "Google transfer learning", "Search for weather in Chennai in Chrome", then "Search instead for wireless headphones". "Open YouTube in Chrome" / "Open ChatGPT in Chrome" open those sites. MIKO asks which Chrome profile when you haven't saved a default; "… in Chrome with Work" picks one for that search only.  
- Preferences, feedback export, manual update download link when configured  

## What is macOS-only right now

These features are unavailable or limited on Windows:

- Caps Lock+A voice hold (Windows uses Shift + A) and browser tab lists in the switcher  
- Selected-text assistant shortcut  
- WhatsApp reading, summaries, reply drafts and attachments (contact search and opening a chat do work)  
- Lens / live window control and browser-tab automation  
- Typing into Notes / ChatGPT.app via Accessibility  

If something is unavailable, MIKO should say so instead of pretending it worked.

## Assistant vs Interactive GPT

- **MIKO assistant (Codex)** needs the Codex CLI installed and signed in (`codex login`). Logging into chatgpt.com inside Interactive GPT does **not** sign Codex in.
- **Interactive GPT** is optional and independent.

## Updates

Unsigned Windows builds do **not** auto-install updates, and there is no update service unless one is configured. A new version comes as a new installer file: run it, and MIKO upgrades in place with your settings kept (`%APPDATA%\MIKO-Beta\`). If a download link is configured, Help & Setup shows **Download the update** when one is available.

## Uninstall

Use Windows **Apps → Installed apps → MIKO → Uninstall**. The uninstaller removes MIKO, its Start menu entry, and the desktop shortcut / start-at-sign-in if you turned them on. It then says that your settings and ChatGPT sign-in were **kept** in `%APPDATA%\MIKO-Beta\` (delete that folder to remove them too).

## Feedback

Help & Setup → **Send feedback** (or Preferences → **Feedback**) → preview, then export a report. If no network endpoint is set up, the report stays on your PC for you to send to the owner.
