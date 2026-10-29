import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error'

export interface Camera {
  status: CameraStatus
  stream: MediaStream | null
  /** The video inputs the browser offers, empty until the first stream opens. */
  devices: MediaDeviceInfo[]
  /** The camera the live stream comes from, when known. */
  deviceId: string | null
  selectDevice: (id: string) => void
  error: string | null
}

type CameraState = Omit<Camera, 'selectDevice'>

/** Where the last chosen camera is remembered between visits. */
const STORAGE_KEY = 'scriptorium.scan.deviceId'

const SWITCH_FAILED =
  'The chosen camera would not open, so the glass went back to the one before.'

const UNPLUGGED =
  'The camera was unplugged, so the glass went to the one the browser offers.'

const UNSUPPORTED =
  'This browser cannot open a camera here. The scanner needs a secure context such as localhost.'

// Storage can throw (private windows, a blocked site). A throw means the
// scriptorium simply has no memory of a camera.
function recall(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Nothing to do: the choice holds for this visit only.
  }
}

function forget(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do: a stale id only costs one failed request next time.
  }
}

function supported(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/**
 * The name of a getUserMedia rejection. Browsers reject with a DOMException,
 * some older ones with a plain object, so any object with a string name counts.
 */
function errorName(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('name' in err)) return
  return typeof err.name === 'string' ? err.name : undefined
}

function describeError(err: unknown): string {
  switch (errorName(err)) {
    case 'NotAllowedError':
      return 'Camera access was refused. Allow the camera for this site and reload.'
    case 'NotFoundError':
      return 'No camera was found. Plug one in and reload.'
    default:
      return 'The camera could not be started.'
  }
}

function open(deviceId: string | null): Promise<MediaStream> {
  // Most USB webcams default to 640 by 480, which leaves the card title about
  // 14 pixels tall, too small for the scanner's OCR. `ideal` is a preference,
  // so a camera that cannot do 1080p still opens.
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  }
  return navigator.mediaDevices.getUserMedia({ video, audio: false })
}

/**
 * Open the remembered camera, or the default one when nothing is remembered.
 * How a remembered camera fails decides what happens next:
 * - refused (NotAllowedError) is final, because asking again is a second
 *   prompt for an answer already given;
 * - gone (OverconstrainedError, NotFoundError: unplugged, or an id the
 *   browser rotated) is forgotten, then the default is tried once;
 * - anything else, such as a camera another app holds, tries the default
 *   once but keeps the id, so the next visit tries the user's camera again.
 */
async function openFirst(
  remembered: string | null,
): Promise<{ stream: MediaStream; requested: string | null }> {
  if (remembered === null) return { stream: await open(null), requested: null }
  try {
    return { stream: await open(remembered), requested: remembered }
  } catch (err) {
    const name = errorName(err)
    if (name === 'NotAllowedError') throw err
    console.warn('The remembered camera would not open', err)
    if (name === 'OverconstrainedError' || name === 'NotFoundError') forget()
    return { stream: await open(null), requested: null }
  }
}

async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((device) => device.kind === 'videoinput')
  } catch (err) {
    // The stream is already live; a missing list only hides the picker.
    console.error('Listing cameras failed', err)
    return []
  }
}

function stop(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** The device a stream actually opened, which may differ from the request. */
function openedDevice(
  stream: MediaStream,
  requested: string | null,
): string | null {
  const settings = stream.getVideoTracks()[0]?.getSettings?.()
  return settings?.deviceId || requested
}

/**
 * The browser camera for the Scan page. Opens a stream on mount, lists the
 * cameras once permission is granted and again whenever one is plugged in or
 * out, and switches between them on request. Every track is stopped on
 * unmount and whenever a new stream replaces the old one, so the camera light
 * goes out when the page is left. When the live camera is unplugged its
 * track ends, and the hook opens the browser's default camera in its place.
 *
 * While `active` is false the camera rests: the video track is disabled, so
 * it sends black frames, but the stream stays open and comes back without a
 * new request. Browsers differ on the light. Chrome keeps the camera open
 * and its light on for a disabled track; only stopping the track puts it
 * out. Firefox (60 and later) releases the camera for a disabled track and
 * takes it back when the track is enabled again, so the light goes out
 * there and the first frames after waking can be slower to arrive. No UI
 * text claims the light goes out, because on Chrome it does not.
 */
export function useCamera({
  active = true,
}: { active?: boolean } = {}): Camera {
  const [state, setState] = useState<CameraState>(() => ({
    status: supported() ? 'starting' : 'error',
    stream: null,
    devices: [],
    deviceId: null,
    error: supported() ? null : UNSUPPORTED,
  }))
  // The stream this hook owns right now, for cleanup to stop. State would be
  // a render behind.
  const streamRef = useRef<MediaStream | null>(null)
  // Bumped by every request and by unmount. A stream that resolves for an
  // older request is stopped, not shown, so a slow camera can never land
  // after the page is gone or after a newer choice.
  const generation = useRef(0)
  // The device of the last stream that went live, so a failed switch knows
  // which camera to go back to. Null means the browser's default.
  const deviceRef = useRef<string | null>(null)
  // Whether the hook is mounted, for a device list that arrives late. The
  // generation is no use here: a camera switch bumps it too, and the new
  // list is still worth showing then.
  const mountedRef = useRef(false)

  const fail = useCallback((err: unknown) => {
    console.error('The camera could not be started', err)
    setState((prev) => ({
      ...prev,
      status: 'error',
      stream: null,
      error: describeError(err),
    }))
  }, [])

  // Declared together because each calls the other: an adopted stream is
  // watched, and a watched stream that ends adopts its replacement.
  const { adopt, watch } = useMemo(() => {
    /** Adopt a stream if its request is still the latest, else stop it. */
    function adopt(
      request: number,
      stream: MediaStream,
      requested: string | null,
      error: string | null,
    ) {
      if (request !== generation.current) {
        stop(stream)
        return
      }
      streamRef.current = stream
      deviceRef.current = openedDevice(stream, requested)
      setState((prev) => ({
        ...prev,
        status: 'live',
        stream,
        deviceId: deviceRef.current,
        error,
      }))
      watch(stream, request)
    }

    /**
     * Reopen the default camera when this stream's track ends. A track the
     * hook stops itself never fires `ended`, so this only answers an unplug
     * or the system taking the camera away. The listener is never removed:
     * once its request is no longer the latest, the event does nothing.
     */
    function watch(stream: MediaStream, request: number) {
      const track = stream.getVideoTracks()[0]
      if (!track) return
      track.addEventListener('ended', () => {
        if (request !== generation.current) return
        console.warn('The camera went away')
        if (recall() === deviceRef.current) forget()
        const next = ++generation.current
        stop(streamRef.current)
        streamRef.current = null
        setState((prev) => ({
          ...prev,
          status: 'starting',
          stream: null,
          deviceId: null,
          error: null,
        }))
        open(null)
          .then((replacement) => adopt(next, replacement, null, UNPLUGGED))
          .catch((err) => {
            if (next === generation.current) fail(err)
          })
      })
    }

    return { adopt, watch }
  }, [fail])

  useEffect(() => {
    if (!supported()) return
    mountedRef.current = true
    // A camera plugged in after the page opened only gets a picker if the
    // list is read again. The live stream is left as it is.
    const relist = async () => {
      const devices = await listCameras()
      if (!mountedRef.current) return
      // An id missing from the list leaves the picker with nothing to show
      // as chosen. The stream stays: the camera may still be live under an
      // id the browser rotated, and if it is really gone its track ends and
      // the ended handler reopens.
      const gone =
        deviceRef.current !== null &&
        !devices.some((d) => d.deviceId === deviceRef.current)
      setState((prev) => ({
        ...prev,
        devices,
        ...(gone ? { deviceId: null } : {}),
      }))
    }
    // Held here so cleanup unsubscribes from the object it subscribed to.
    const media = navigator.mediaDevices
    media.addEventListener('devicechange', relist)
    const request = ++generation.current
    openFirst(recall())
      .then(async ({ stream, requested }) => {
        if (request !== generation.current) {
          stop(stream)
          return
        }
        streamRef.current = stream
        const devices = await listCameras()
        // Unmount in the meantime has already stopped this stream.
        if (request !== generation.current) return
        deviceRef.current = openedDevice(stream, requested)
        setState({
          status: 'live',
          stream,
          devices,
          deviceId: deviceRef.current,
          error: null,
        })
        watch(stream, request)
      })
      .catch((err) => {
        if (request === generation.current) fail(err)
      })
    return () => {
      mountedRef.current = false
      media.removeEventListener('devicechange', relist)
      // The latest request is the one to retire, so this reads the ref live.
      generation.current += 1
      stop(streamRef.current)
      streamRef.current = null
    }
  }, [fail, watch])

  const selectDevice = useCallback(
    (id: string) => {
      if (!supported()) return
      const request = ++generation.current
      const previous = deviceRef.current
      stop(streamRef.current)
      streamRef.current = null
      setState((prev) => ({
        ...prev,
        status: 'starting',
        stream: null,
        deviceId: id,
        error: null,
      }))

      open(id)
        .then((stream) => {
          // Only a camera that opened is worth opening next visit.
          if (request === generation.current) remember(id)
          adopt(request, stream, id, null)
        })
        .catch(async (err) => {
          if (request !== generation.current) return
          console.error('The chosen camera would not open', err)
          // The old stream is already stopped, so go back to that camera
          // rather than leave the page with no camera at all.
          try {
            adopt(request, await open(previous), previous, SWITCH_FAILED)
          } catch (reopenErr) {
            if (request === generation.current) fail(reopenErr)
          }
        })
    },
    [adopt, fail],
  )

  // Keyed on the stream too, so a stream that opens or is switched to while
  // the camera rests starts out rested.
  const { stream } = state
  useEffect(() => {
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = active
    })
  }, [stream, active])

  return { ...state, selectDevice }
}
