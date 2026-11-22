# MIKO private beta — tester guide (zero-budget)

You get a packaged Mac app — **not** this repository. The owner’s passwords, mail tokens, WhatsApp aliases, and ChatGPT/Codex login are **not** inside the build.

**Use build 0.1.1 or newer.** Build **0.1.0** had a broken packaging signature (`identity: null`) that made macOS show **“MIKO is damaged and can’t be opened”** — right-click Open / Open Anyway often could not help. That is fixed in **0.1.1** with a proper **ad-hoc** signature (still not Apple-notarized).

## 1. Install (normal macOS security)

1. Confirm the DMG checksum with the owner if the file was transferred over the internet (SHA-256).
2. Open the DMG. Drag **MIKO** to Applications (or another folder). Prefer **drag from the DMG window**, not unpacking odd ZIP tools that alter the bundle.
3. First launch — you should see an **unverified developer** warning (“Apple could not verify…”), **not** “is damaged”:
   - **macOS 15+:** click Done → **System Settings → Privacy & Security** → scroll to the message about MIKO → **Open Anyway** → confirm.
   - **macOS 14 and earlier:** Finder → **right-click MIKO → Open → Open**.
4. **Do not** turn off Gatekeeper, SIP, or “Allow apps from anywhere.”
5. Summon with the tray icon / shortcut (often ⌘⇧R).

### If you still see “MIKO is damaged and can’t be opened”

That usually means either (a) you still have **0.1.0**, or (b) the copy was altered after download, or (c) quarantine + a bad signature.

1. Delete that `MIKO.app` and the old DMG.
2. Get **0.1.1+** from the owner and compare SHA-256.
3. Optional **app-only** quarantine clear (does **not** disable Gatekeeper globally) after copying to Applications:
   ```bash
   xattr -dr com.apple.quarantine /Applications/MIKO.app
   ```
   Then open MIKO again. If it still says damaged, stop and send the owner the output of:
   ```bash
   codesign --verify --deep --strict --verbose=2 /Applications/MIKO.app
   spctl --assess --type execute -vv /Applications/MIKO.app
   xattr -l /Applications/MIKO.app
   ```

Your settings live in `~/Library/Application Support/MIKO-Beta` and survive replacing the `.app`.

## 2. Permissions

Grant only what you use, in **System Settings → Privacy & Security**:

| Feature | Permission |
| --- | --- |
| Voice input | Microphone |
| Follow / some UI help | Accessibility (MIKO helpers) |
| WhatsApp automation | Accessibility (+ Screen Recording if prompted for those helpers) |

After an **update** (new ad-hoc build), macOS may ask you to approve helpers again — normal without Developer ID notarization.

## 3. Personal accounts (your laptop only)

### MIKO assistant (your ChatGPT — exact steps)

1. On **this** Mac, install [ChatGPT for Mac](https://openai.com/chatgpt/download/) from OpenAI (not from the MIKO DMG).
2. Open **ChatGPT**, sign in with **your** ChatGPT account. Wait until ChatGPT finishes first launch.
3. Leave ChatGPT at `/Applications/ChatGPT.app`. MIKO looks for Codex at  
   `ChatGPT.app/Contents/Resources/codex-cli/bin/codex`.
4. Open MIKO → Preferences until assistant shows ready.
5. Ask in MIKO chat. MIKO does **not** use the developer’s ChatGPT login.

Without ChatGPT/Codex: pet, tray, voice (mic), apps, websites, WhatsApp (macOS), Chrome profiles, feedback export still work; in-MIKO assistant answers do not.

### Other accounts

- **Mail (optional):** your own Google OAuth — nothing from the owner is bundled.
- **WhatsApp:** your WhatsApp Desktop + permissions on this Mac.

## 4. Feedback (export — you send it)

1. Preferences → **Feedback**, or say “give feedback” / “report a problem”.
2. Fill what happened / what you expected. Optional screenshot and last command.
3. **Preview**, then **Export report** → save the file.
4. Send that file to the owner yourself. MIKO will **not** show “Feedback sent” unless a real remote inbox accepts it.

## 5. Manual updates

Automatic install is **off** on ad-hoc / unsigned builds.

1. Preferences → **Check for updates** or ask the owner for a new DMG.
2. **Download latest version** → status **download opened**.
3. Quit MIKO, replace `MIKO.app` from the new DMG, reopen → **update installed** when the version changes.

## Honest limits

- Ad-hoc signature ≠ Apple notarization. Gatekeeper will warn; it must not say “damaged” on a good 0.1.1+ build.
- Not a security boundary against a determined reverse engineer.
- Windows is not labeled ready.
- No paid Apple Developer ID in this free beta.
