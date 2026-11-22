/** Platform-aware user-facing copy. Avoid Mac-only wording on Windows. */

export type UiPlatform = 'darwin' | 'win32' | string

export function isWindowsPlatform(platform: UiPlatform): boolean {
  return platform === 'win32' || /^win/i.test(String(platform))
}

export function deviceNoun(platform: UiPlatform): string {
  return isWindowsPlatform(platform) ? 'this PC' : 'this Mac'
}

export function settingsFolderLabel(platform: UiPlatform): string {
  return isWindowsPlatform(platform) ? 'AppData\\Roaming\\MIKO-Beta' : 'Application Support/MIKO-Beta'
}

export function fileBrowserName(platform: UiPlatform): string {
  return isWindowsPlatform(platform) ? 'File Explorer' : 'Finder'
}

export function installerNoun(platform: UiPlatform): string {
  return isWindowsPlatform(platform) ? '.exe installer' : 'DMG'
}

export function appBundleNoun(platform: UiPlatform): string {
  return isWindowsPlatform(platform) ? 'MIKO' : 'MIKO.app'
}

/** Unsigned manual-update instructions. */
export function unsignedUpdateInstructions(platform: UiPlatform): string {
  if (isWindowsPlatform(platform)) {
    return `This build is unsigned. Automatic install is disabled. Use Download latest version, quit MIKO, run the new .exe installer, then reopen. Windows SmartScreen may warn on first launch — choose More info → Run anyway. Settings stay under ${settingsFolderLabel(platform)}.`
  }
  return 'This build is unsigned. Automatic install is disabled. Use Download latest version, then replace MIKO.app (do not turn off Gatekeeper).'
}

export function downloadOpenedMessage(platform: UiPlatform): string {
  if (isWindowsPlatform(platform)) {
    return `Download opened. Quit MIKO, run the new .exe installer, then reopen. SmartScreen may warn on first launch — More info → Run anyway. Settings stay under ${settingsFolderLabel(platform)}.`
  }
  return 'Download opened. Quit MIKO, install/replace from the new DMG, then reopen. Do not disable Gatekeeper — use Finder → right-click → Open if macOS blocks the first launch. Settings stay under Application Support/MIKO-Beta.'
}

export function replaceAppReminder(platform: UiPlatform): string {
  if (isWindowsPlatform(platform)) {
    return `A shared release folder is configured. Use Download latest version, quit MIKO, run the new .exe installer, then reopen. Settings stay under ${settingsFolderLabel(platform)}.`
  }
  return 'A shared release folder is configured. Use Download latest version, quit MIKO, replace the app from the new DMG, then reopen. Settings stay in Application Support.'
}

export function restartBlockedReason(platform: UiPlatform): string {
  if (isWindowsPlatform(platform)) {
    return 'Automatic install is disabled on unsigned builds. Use Download latest version, then run the new .exe installer.'
  }
  return 'Automatic install is disabled on unsigned builds. Use Download latest version, then replace MIKO.app from the DMG.'
}

export function installedKeptSettingsMessage(platform: UiPlatform, version: string): string {
  return `Update installed — now running ${version}. Settings and drafts in ${settingsFolderLabel(platform)} were kept.`
}

export function assistantUnavailableMessage(platform: UiPlatform): string {
  if (isWindowsPlatform(platform)) {
    return 'Assistant needs the Codex CLI on this PC (PATH or MIKO_CODEX_PATH). Install and sign in with “codex login”, or use Interactive GPT — web login does not sign Codex in.'
  }
  return 'Assistant needs ChatGPT.app’s Codex CLI on this Mac. Install ChatGPT and sign in — no developer login is bundled. Interactive GPT web login does not satisfy Codex sign-in.'
}

export function assistantNotSignedInMessage(platform: UiPlatform): string {
  if (isWindowsPlatform(platform)) {
    return 'Codex was found but is not signed in. Run “codex login” in a terminal, then retry. Interactive GPT login is separate.'
  }
  return 'ChatGPT is installed; sign in there so MIKO’s assistant can use Codex on your account. Interactive GPT web login is separate.'
}

export function prefsStoredOnlyMessage(platform: UiPlatform): string {
  return `MIKO preferences — stored only on ${deviceNoun(platform)}. These are approved preferences and aliases, not trained model weights. Separate from ChatGPT's memory.`
}

export function prefsUpdateHelp(platform: UiPlatform, mode: 'manual' | 'auto'): string {
  if (mode !== 'manual') {
    return isWindowsPlatform(platform)
      ? 'Signed builds may download in the background. A ready update installs on Restart now or a normal tray quit — not force-quit.'
      : 'Signed builds may download in the background. On macOS, a ready update installs on Restart now or a normal tray quit — not force-quit.'
  }
  if (isWindowsPlatform(platform)) {
    return `Unsigned builds never auto-install. Status means: update available → download opened → after you run the new .exe and reopen, update installed. Preferences stay in ${settingsFolderLabel(platform)}. SmartScreen may warn on first launch — More info → Run anyway.`
  }
  return 'Unsigned builds never auto-install. Status means: update available → download opened → after you replace the app and reopen, update installed. Preferences stay in Application Support/MIKO-Beta. Do not disable Gatekeeper — use Finder → right-click → Open if macOS warns on first launch.'
}

export function releaseLinkLabel(platform: UiPlatform): string {
  return isWindowsPlatform(platform) ? 'Shared release link (.exe or folder)' : 'Shared release link (DMG or folder)'
}

export function showInFileBrowserLabel(platform: UiPlatform): string {
  return `Show in ${fileBrowserName(platform)}`
}

export function chromeProfilesMissingMessage(platform: UiPlatform): string {
  return `Chrome has no readable profiles on ${deviceNoun(platform)}. Nothing was invented.`
}

export function unsupportedOnDeviceMessage(platform: UiPlatform, feature = 'that'): string {
  return `I can’t do ${feature} on ${deviceNoun(platform)} yet.`
}
