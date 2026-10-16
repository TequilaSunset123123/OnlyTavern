// The picture behind the glass panels (2026-10-16): the default night room, none, or one
// you upload (Settings, Appearance). Kept in this browser, like the theme: a picture is
// too big for the shared settings. Applied as --app-picture on <html> (index.css body).
import { useCallback, useEffect, useState } from 'react'
import nightRoom from '../assets/backgrounds/night-room.webp'

export type Backdrop = 'default' | 'none' | 'custom'

const KIND_KEY = 'onlytavern:backdrop'
const PICTURE_KEY = 'onlytavern:backdropPicture'
/** Uploads are scaled down to this width and saved as JPEG, so they fit in browser storage. */
const MAX_WIDTH = 1920

function read(): { kind: Backdrop; custom: string | null } {
  try {
    const kind = localStorage.getItem(KIND_KEY)
    const custom = localStorage.getItem(PICTURE_KEY)
    return { kind: kind === 'none' || (kind === 'custom' && custom) ? (kind as Backdrop) : 'default', custom }
  } catch {
    return { kind: 'default', custom: null }
  }
}

function apply({ kind, custom }: { kind: Backdrop; custom: string | null }) {
  const src = kind === 'default' ? nightRoom : kind === 'custom' ? custom : null
  document.documentElement.style.setProperty('--app-picture', src ? `url("${src}")` : 'none')
}

/** Scales a picture file down and returns it as a data URL. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_WIDTH / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file is not a picture this browser can open'))
    }
    img.src = url
  })
}

export function useBackdrop() {
  const [state, setState] = useState(read)
  useEffect(() => apply(state), [state])

  const choose = useCallback((kind: Backdrop) => {
    setState((s) => {
      const next = { ...s, kind: kind === 'custom' && !s.custom ? s.kind : kind }
      try {
        localStorage.setItem(KIND_KEY, next.kind)
      } catch {
        // No storage: it still applies until the app is reopened.
      }
      return next
    })
  }, [])

  /** Use a picture of your own. Throws if it cannot be read or stored. */
  const upload = useCallback(async (file: File) => {
    const custom = await shrink(file)
    try {
      localStorage.setItem(PICTURE_KEY, custom)
      localStorage.setItem(KIND_KEY, 'custom')
    } catch {
      throw new Error('This browser has no room to keep that picture; try a smaller one')
    }
    setState({ kind: 'custom', custom })
  }, [])

  return { kind: state.kind, hasCustom: !!state.custom, choose, upload }
}
