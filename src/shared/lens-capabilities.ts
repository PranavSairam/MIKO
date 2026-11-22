/**
 * Per-source Lens capabilities — only expose what was verified for that app.
 * Never label every app “Interactive” because media or one app works.
 */

import { isChatGptOwner, isFinderOwner, isSpotifyOwner } from './lens-control.ts'

export type LensCapabilityId = 'view' | 'media' | 'interactive' | 'control-original'

export interface LensCapability {
  id: LensCapabilityId
  /** Short toolbar label. */
  label: string
  available: boolean
  /** Shown beside disabled toggles / as helper text. */
  detail: string
}

export interface LensCapabilityProfile {
  ownerKind: 'spotify' | 'chatgpt' | 'finder' | 'generic'
  capabilities: LensCapability[]
  /** Prefer this mode when opening Lens for the source. */
  defaultMode: 'view' | 'media' | 'control-original'
}

export function lensCapabilityProfile(
  owner: string,
  name: string,
  bundle = '',
  platform: NodeJS.Platform | 'darwin' | 'win32' = 'darwin'
): LensCapabilityProfile {
  if (platform !== 'darwin') {
    return {
      ownerKind: isSpotifyOwner(owner, name, bundle)
        ? 'spotify'
        : isChatGptOwner(owner, name, bundle)
          ? 'chatgpt'
          : isFinderOwner(owner, name, bundle)
            ? 'finder'
            : 'generic',
      defaultMode: 'view',
      capabilities: [
        {
          id: 'view',
          label: 'View',
          available: false,
          detail: 'Lens window capture is not available on Windows yet.'
        },
        {
          id: 'media',
          label: 'Media',
          available: false,
          detail: 'Lens media controls are not available on Windows yet.'
        },
        {
          id: 'interactive',
          label: 'Interactive',
          available: false,
          detail: 'Lens background control is not available on Windows yet.'
        },
        {
          id: 'control-original',
          label: 'Control original',
          available: false,
          detail: 'Lens source handoff is not available on Windows yet.'
        }
      ]
    }
  }
  if (isSpotifyOwner(owner, name, bundle)) {
    return {
      ownerKind: 'spotify',
      defaultMode: 'media',
      capabilities: [
        {
          id: 'view',
          label: 'View',
          available: true,
          detail: 'Live mirror only — zoom/pan/crop do not scroll Spotify.'
        },
        {
          id: 'media',
          label: 'Media',
          available: true,
          detail: 'Play/pause, next, previous, volume via Spotify AppleScript (no focus steal when Automation works).'
        },
        {
          id: 'interactive',
          label: 'Interactive',
          available: false,
          detail:
            'Background clicks/typing into Spotify were not reliable on this Mac (Electron UI ignores non-frontmost HID). Not offered.'
        },
        {
          id: 'control-original',
          label: 'Control original',
          available: true,
          detail: 'One intentional handoff brings Spotify forward; control happens in the real window, not inside the mirror.'
        }
      ]
    }
  }
  if (isChatGptOwner(owner, name, bundle)) {
    return {
      ownerKind: 'chatgpt',
      defaultMode: 'view',
      capabilities: [
        {
          id: 'view',
          label: 'View',
          available: true,
          detail: 'Live mirror of the bound ChatGPT window.'
        },
        {
          id: 'media',
          label: 'Media',
          available: false,
          detail: 'No ChatGPT media adapter.'
        },
        {
          id: 'interactive',
          label: 'Interactive',
          available: false,
          detail: 'In-mirror ChatGPT control is not verified; use Control original or Open ChatGPT.'
        },
        {
          id: 'control-original',
          label: 'Control original',
          available: true,
          detail: 'Brings the real ChatGPT window forward once for interaction.'
        }
      ]
    }
  }
  if (isFinderOwner(owner, name, bundle)) {
    return {
      ownerKind: 'finder',
      defaultMode: 'view',
      capabilities: [
        {
          id: 'view',
          label: 'View',
          available: true,
          detail: 'Live mirror of the bound Finder window.'
        },
        {
          id: 'media',
          label: 'Media',
          available: false,
          detail: 'Finder has no media controls.'
        },
        {
          id: 'interactive',
          label: 'Interactive',
          available: false,
          detail: 'Background Finder clicks are not claimed here — use Control original for a single handoff.'
        },
        {
          id: 'control-original',
          label: 'Control original',
          available: true,
          detail: 'Brings Finder forward once; Files shelf stays available for real paths.'
        }
      ]
    }
  }
  return {
    ownerKind: 'generic',
    defaultMode: 'view',
    capabilities: [
      {
        id: 'view',
        label: 'View',
        available: true,
        detail: 'Live mirror of the bound window.'
      },
      {
        id: 'media',
        label: 'Media',
        available: false,
        detail: 'No media adapter for this app.'
      },
      {
        id: 'interactive',
        label: 'Interactive',
        available: false,
        detail: 'In-mirror interactive control is not verified for this app.'
      },
      {
        id: 'control-original',
        label: 'Control original',
        available: true,
        detail: 'One intentional handoff to the real window — not a background embed.'
      }
    ]
  }
}
