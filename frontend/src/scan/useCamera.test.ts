import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCamera } from './useCamera'

const STORAGE_KEY = 'scriptorium.scan.deviceId'

/** The argument useCamera passes to getUserMedia. */
const constraints = (deviceId?: string) => ({
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  },
  audio: false,
})

type FakeTrack = EventTarget & {
  stop: ReturnType<typeof vi.fn>
  getSettings: () => { deviceId?: string }
  enabled: boolean
}

/**
 * A stream with one video track reporting the device it came from. The track
 * is a real EventTarget, so a test can end it the way an unplug does.
 */
function fakeStream(deviceId: string | undefined) {
  const track: FakeTrack = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    getSettings: () => ({ deviceId }),
    enabled: true,
  })
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
  return { stream, track }
}

function device(
  deviceId: string,
  label: string,
  kind: MediaDeviceKind = 'videoinput',
): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: 'g' } as MediaDeviceInfo
}

const DESK = device('cam-desk', 'Desk camera')
const BUILT_IN = device('cam-built-in', 'FaceTime HD Camera')
const MIC = device('mic-1', 'Microphone', 'audioinput')

/**
 * An in-memory stand-in for localStorage. Node 25 puts its own `localStorage`
 * on the global, which shadows jsdom's and has no methods unless Node is given
 * a storage file, so the tests bring their own.
 */
function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  }
}

let getUserMedia: ReturnType<typeof vi.fn>
let enumerateDevices: ReturnType<typeof vi.fn>
let addEventListener: ReturnType<typeof vi.fn>
let removeEventListener: ReturnType<typeof vi.fn>
// The devicechange handler the hook registered, if any.
let onDeviceChange: (() => void) | null

function installMediaDevices() {
  onDeviceChange = null
  addEventListener = vi.fn((type: string, handler: () => void) => {
    if (type === 'devicechange') onDeviceChange = handler
  })
  removeEventListener = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia,
      enumerateDevices,
      addEventListener,
      removeEventListener,
    },
    configurable: true,
  })
}

/** Tell the hook the browser's cameras changed, as plugging one in does. */
async function fireDeviceChange() {
  await act(async () => onDeviceChange?.())
}

/** End a track as the browser does when its camera is unplugged. */
function endTrack(track: FakeTrack) {
  act(() => {
    track.dispatchEvent(new Event('ended'))
  })
}

function domError(name: string): DOMException {
  return new DOMException(`${name} from the fake camera`, name)
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  getUserMedia = vi.fn()
  enumerateDevices = vi.fn().mockResolvedValue([DESK, MIC])
  installMediaDevices()
})

afterEach(() => {
  delete (navigator as { mediaDevices?: unknown }).mediaDevices
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useCamera', () => {
  it('opens the default camera and goes live with one device', async () => {
    const { stream } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useCamera())
    expect(result.current.status).toBe('starting')

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(getUserMedia).toHaveBeenCalledWith(constraints())
    expect(result.current.stream).toBe(stream)
    // The microphone is not a camera.
    expect(result.current.devices).toEqual([DESK])
    expect(result.current.deviceId).toBe('cam-desk')
    expect(result.current.error).toBeNull()
  })

  it('lists every camera when there are two', async () => {
    getUserMedia.mockResolvedValue(fakeStream('cam-desk').stream)
    enumerateDevices.mockResolvedValue([DESK, MIC, BUILT_IN])

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.devices).toEqual([DESK, BUILT_IN])
  })

  it('lists a camera plugged in after the page opened', async () => {
    const { stream } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.devices).toEqual([DESK])

    enumerateDevices.mockResolvedValue([DESK, MIC, BUILT_IN])
    await fireDeviceChange()

    await waitFor(() =>
      expect(result.current.devices).toEqual([DESK, BUILT_IN]),
    )
    // The live stream is left alone.
    expect(result.current.stream).toBe(stream)
    expect(result.current.deviceId).toBe('cam-desk')
    expect(result.current.status).toBe('live')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it("drops the device id when the camera's id leaves the list", async () => {
    const { stream } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.deviceId).toBe('cam-desk')

    enumerateDevices.mockResolvedValue([BUILT_IN])
    await fireDeviceChange()

    await waitFor(() => expect(result.current.devices).toEqual([BUILT_IN]))
    expect(result.current.deviceId).toBeNull()
    // The id may only have rotated, so the stream is left alone.
    expect(result.current.stream).toBe(stream)
    expect(result.current.status).toBe('live')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('keeps the device id when the list still has it', async () => {
    getUserMedia.mockResolvedValue(fakeStream('cam-desk').stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    await fireDeviceChange()

    expect(result.current.devices).toEqual([DESK, BUILT_IN])
    expect(result.current.deviceId).toBe('cam-desk')
  })

  it('reopens the default camera when the live one is unplugged', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEY, 'cam-desk')
    const first = fakeStream('cam-desk')
    const second = fakeStream('cam-built-in')
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    endTrack(first.track)

    expect(getUserMedia).toHaveBeenLastCalledWith(constraints())
    await waitFor(() => expect(result.current.stream).toBe(second.stream))
    expect(result.current.status).toBe('live')
    expect(result.current.deviceId).toBe('cam-built-in')
    expect(result.current.error).toBe(
      'The camera was unplugged, so the glass went to the one the browser offers.',
    )
    // A camera that is gone is not tried first next visit.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('reports it when no camera will open after an unplug', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = fakeStream('cam-desk')
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockRejectedValueOnce(domError('NotFoundError'))

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    endTrack(first.track)

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.stream).toBeNull()
    expect(result.current.error).toBe(
      'No camera was found. Plug one in and reload.',
    )
  })

  it('ignores an ended event from a stream it already replaced', async () => {
    const first = fakeStream('cam-desk')
    const second = fakeStream('cam-built-in')
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))
    act(() => result.current.selectDevice('cam-built-in'))
    await waitFor(() => expect(result.current.stream).toBe(second.stream))

    endTrack(first.track)

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(result.current.stream).toBe(second.stream)
    expect(result.current.status).toBe('live')
  })

  it('ignores an ended event after unmount', async () => {
    const { stream, track } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)

    const { result, unmount } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    unmount()
    endTrack(track)

    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('stops listening for device changes on unmount', async () => {
    getUserMedia.mockResolvedValue(fakeStream('cam-desk').stream)

    const { result, unmount } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))
    const handler = onDeviceChange
    expect(handler).toBeInstanceOf(Function)

    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('devicechange', handler)
  })

  it('rests the video track while inactive and wakes it on return', async () => {
    const { stream, track } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)

    const { result, rerender } = renderHook(
      ({ active }) => useCamera({ active }),
      { initialProps: { active: true } },
    )
    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(track.enabled).toBe(true)

    rerender({ active: false })
    expect(track.enabled).toBe(false)
    // Rested, not released: the same stream comes back.
    expect(track.stop).not.toHaveBeenCalled()

    rerender({ active: true })
    expect(track.enabled).toBe(true)
    expect(result.current.stream).toBe(stream)
  })

  it('rests a stream that opens while inactive', async () => {
    const { stream, track } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)

    const { result } = renderHook(() => useCamera({ active: false }))

    await waitFor(() => expect(result.current.stream).toBe(stream))
    expect(track.enabled).toBe(false)
  })

  it('rests a camera switched to while inactive', async () => {
    const first = fakeStream('cam-desk')
    const second = fakeStream('cam-built-in')
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera({ active: false }))
    await waitFor(() => expect(result.current.status).toBe('live'))

    act(() => result.current.selectDevice('cam-built-in'))

    await waitFor(() => expect(result.current.stream).toBe(second.stream))
    expect(second.track.enabled).toBe(false)
  })

  it('falls back to the requested id when the track reports none', async () => {
    localStorage.setItem(STORAGE_KEY, 'cam-desk')
    getUserMedia.mockResolvedValue(fakeStream(undefined).stream)

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.deviceId).toBe('cam-desk')
  })

  it('switches cameras, stopping the old track and remembering the choice', async () => {
    const first = fakeStream('cam-desk')
    const second = fakeStream('cam-built-in')
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    act(() => result.current.selectDevice('cam-built-in'))

    expect(first.track.stop).toHaveBeenCalled()
    expect(getUserMedia).toHaveBeenLastCalledWith(constraints('cam-built-in'))
    await waitFor(() => expect(result.current.stream).toBe(second.stream))
    // Remembered only once the camera has opened.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('cam-built-in')
    expect(result.current.status).toBe('live')
    expect(result.current.deviceId).toBe('cam-built-in')
    expect(second.track.stop).not.toHaveBeenCalled()
  })

  it('reopens the previous camera when a switch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = fakeStream('cam-desk')
    const reopened = fakeStream('cam-desk')
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockResolvedValueOnce(reopened.stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    act(() => result.current.selectDevice('cam-built-in'))

    await waitFor(() => expect(result.current.stream).toBe(reopened.stream))
    expect(getUserMedia).toHaveBeenLastCalledWith(constraints('cam-desk'))
    expect(result.current.status).toBe('live')
    expect(result.current.deviceId).toBe('cam-desk')
    expect(result.current.error).toBe(
      'The chosen camera would not open, so the glass went back to the one before.',
    )
    // A camera that would not open is not remembered.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(result.current.devices).toEqual([DESK, BUILT_IN])
  })

  it('reopens the default when the camera before a failed switch was the default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getUserMedia
      .mockResolvedValueOnce(fakeStream(undefined).stream)
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockResolvedValueOnce(fakeStream(undefined).stream)
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.deviceId).toBeNull()

    act(() => result.current.selectDevice('cam-built-in'))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(getUserMedia).toHaveBeenLastCalledWith(constraints())
    expect(result.current.status).toBe('live')
    expect(result.current.deviceId).toBeNull()
  })

  it('reports an error when a switch fails and the previous camera will not reopen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getUserMedia
      .mockResolvedValueOnce(fakeStream('cam-desk').stream)
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockRejectedValueOnce(domError('NotReadableError'))
    enumerateDevices.mockResolvedValue([DESK, BUILT_IN])

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    act(() => result.current.selectDevice('cam-built-in'))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(getUserMedia).toHaveBeenCalledTimes(3)
    expect(result.current.stream).toBeNull()
    expect(result.current.error).toBe('The camera could not be started.')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    // The picker stays, so another camera can still be chosen.
    expect(result.current.devices).toEqual([DESK, BUILT_IN])
  })

  it('keeps the last choice when two switches settle out of order', async () => {
    const first = fakeStream('cam-desk')
    const toA = fakeStream('cam-a')
    const toB = fakeStream('cam-b')
    let deliverA: (stream: MediaStream) => void = () => {}
    let deliverB: (stream: MediaStream) => void = () => {}
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockReturnValueOnce(
        new Promise<MediaStream>((resolve) => {
          deliverA = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise<MediaStream>((resolve) => {
          deliverB = resolve
        }),
      )

    const { result } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    act(() => result.current.selectDevice('cam-a'))
    act(() => result.current.selectDevice('cam-b'))
    await act(async () => deliverB(toB.stream))
    await act(async () => deliverA(toA.stream))

    expect(toA.track.stop).toHaveBeenCalled()
    expect(toB.track.stop).not.toHaveBeenCalled()
    expect(result.current.stream).toBe(toB.stream)
    expect(result.current.deviceId).toBe('cam-b')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('cam-b')
  })

  it('opens the remembered camera on mount', async () => {
    localStorage.setItem(STORAGE_KEY, 'cam-built-in')
    getUserMedia.mockResolvedValue(fakeStream('cam-built-in').stream)

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledWith(constraints('cam-built-in'))
    expect(result.current.deviceId).toBe('cam-built-in')
  })

  it('forgets a remembered camera that is gone and opens the default', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEY, 'cam-unplugged')
    const fallback = fakeStream('cam-desk')
    getUserMedia
      .mockRejectedValueOnce(domError('OverconstrainedError'))
      .mockResolvedValueOnce(fallback.stream)

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(getUserMedia).toHaveBeenNthCalledWith(2, constraints())
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(result.current.stream).toBe(fallback.stream)
    expect(result.current.deviceId).toBe('cam-desk')
  })

  it('also falls back when a remembered camera answers NotFoundError', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEY, 'cam-unplugged')
    getUserMedia
      .mockRejectedValueOnce(domError('NotFoundError'))
      .mockResolvedValueOnce(fakeStream('cam-desk').stream)

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('opens the default when the remembered camera is busy, and keeps it for next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEY, 'cam-busy')
    const fallback = fakeStream('cam-desk')
    getUserMedia
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockResolvedValueOnce(fallback.stream)

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(getUserMedia).toHaveBeenNthCalledWith(2, constraints())
    expect(result.current.stream).toBe(fallback.stream)
    // Busy is not gone: the next visit tries the user's camera again.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('cam-busy')
    expect(warn).toHaveBeenCalled()
  })

  it('asks only once when a remembered camera is refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEY, 'cam-desk')
    getUserMedia.mockRejectedValue(domError('NotAllowedError'))

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('error'))
    // A second request would be a second prompt.
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe(
      'Camera access was refused. Allow the camera for this site and reload.',
    )
    expect(localStorage.getItem(STORAGE_KEY)).toBe('cam-desk')
  })

  it('reports the default camera failing after a remembered one did', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem(STORAGE_KEY, 'cam-busy')
    getUserMedia
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockRejectedValueOnce(domError('NotAllowedError'))

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBe(
      'Camera access was refused. Allow the camera for this site and reload.',
    )
    expect(localStorage.getItem(STORAGE_KEY)).toBe('cam-busy')
  })

  it('falls back on an error named by any object, not only a DOMException', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Older engines reject with a plain object carrying the name.
    localStorage.setItem(STORAGE_KEY, 'cam-unplugged')
    getUserMedia
      .mockRejectedValueOnce({
        name: 'OverconstrainedError',
        constraint: 'deviceId',
      })
      .mockResolvedValueOnce(fakeStream('cam-desk').stream)

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('goes live without a picker when the cameras cannot be listed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { stream } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)
    enumerateDevices.mockRejectedValue(new Error('enumeration failed'))

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.stream).toBe(stream)
    expect(result.current.devices).toEqual([])
  })

  it('explains a refused camera', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    getUserMedia.mockRejectedValue(domError('NotAllowedError'))

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe(
      'Camera access was refused. Allow the camera for this site and reload.',
    )
    expect(result.current.stream).toBeNull()
    expect(consoleError).toHaveBeenCalled()
  })

  it('explains a missing camera', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getUserMedia.mockRejectedValue(domError('NotFoundError'))

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe(
      'No camera was found. Plug one in and reload.',
    )
    // With nothing remembered there is no other camera to try.
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('reports any other failure plainly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getUserMedia.mockRejectedValue(domError('NotReadableError'))

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('The camera could not be started.')
  })

  it('explains a browser with no camera interface at all', () => {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices

    const { result } = renderHook(() => useCamera())

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe(
      'This browser cannot open a camera here. The scanner needs a secure context such as localhost.',
    )
  })

  it('opens the default camera when storage cannot be read', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage is off')
    })
    getUserMedia.mockResolvedValue(fakeStream('cam-desk').stream)

    const { result } = renderHook(() => useCamera())

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(getUserMedia).toHaveBeenCalledWith(constraints())
  })

  it('stops the tracks on unmount', async () => {
    const { stream, track } = fakeStream('cam-desk')
    getUserMedia.mockResolvedValue(stream)

    const { result, unmount } = renderHook(() => useCamera())
    await waitFor(() => expect(result.current.status).toBe('live'))

    unmount()
    expect(track.stop).toHaveBeenCalled()
  })

  it('stops a stream that arrives after unmount', async () => {
    const { stream, track } = fakeStream('cam-desk')
    let deliver: (value: MediaStream) => void = () => {}
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        deliver = resolve
      }),
    )

    const { unmount } = renderHook(() => useCamera())
    unmount()
    await act(async () => deliver(stream))

    expect(track.stop).toHaveBeenCalled()
  })

  it('keeps only the second stream when StrictMode mounts twice', async () => {
    const first = fakeStream('cam-desk')
    const second = fakeStream('cam-desk')
    getUserMedia
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)

    const { result } = renderHook(() => useCamera(), { wrapper: StrictMode })

    await waitFor(() => expect(result.current.status).toBe('live'))
    expect(result.current.stream).toBe(second.stream)
    expect(first.track.stop).toHaveBeenCalled()
    expect(second.track.stop).not.toHaveBeenCalled()
  })
})
