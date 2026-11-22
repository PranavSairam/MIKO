# MIKO for Windows — short user guide

No Git, Node, Cursor, or source code required. Start from the installer file you were given.

## Install

1. Find **`MIKO-0.1.1-win-x64.exe`** (or the version on the file name).
2. Double-click it. Choose the defaults if asked.
3. Start **MIKO** from the Start menu or desktop shortcut.

### SmartScreen (unsigned build)

Windows may show **Windows protected your PC** because this build is not code-signed.

1. Click **More info**.
2. Click **Run anyway**.

That is expected for this private beta. Do not turn off SmartScreen permanently.

## First launch

- MIKO may open a short **Setup & Help** walkthrough. You can skip any step — the pet and tray still work.
- Show / hide with **Ctrl+Shift+R**, or the tray icon → **Show** / **Hide**.
- Settings live in **`%APPDATA%\MIKO-Beta\`** (not inside the installer).

## What works on Windows (core)

- Pet on screen, drag, tray menu  
- Panel commands that open apps / websites when Windows can find them  
- Microphone via **Try microphone** / panel mic / tray **Talk to MIKO** (System.Speech) — allow mic privacy if Windows asks  
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

Unsigned Windows builds do **not** auto-install updates. If a download link is provided: quit MIKO, run the new `.exe`, reopen. Settings in `%APPDATA%\MIKO-Beta\` are kept.

## Uninstall

Use Windows **Apps → Installed apps → MIKO → Uninstall**. App data under `%APPDATA%\MIKO-Beta\` may remain unless you delete that folder yourself.

## Feedback

Preferences → **Feedback** → export a report. If no network endpoint is set up, the report stays on your PC for you to send to the owner.
