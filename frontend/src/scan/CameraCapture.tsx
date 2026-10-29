import { useEffect, useRef, useState } from 'react'
import { Button, Consulting, Field, Notice, Select, cx } from '../components'
import { captureFrame } from './capture'
import { useCamera } from './useCamera'

interface Props {
  /** False rests the camera while the page shows something else. */
  active: boolean
  /** The captured frame, and an object URL for it that the caller revokes. */
  onCapture: (image: Blob, previewUrl: string) => void
}

/**
 * The live camera with a card-shaped guide over it, a camera picker when
 * there is more than one, a flip for a camera mounted upside down, and the
 * Capture button that grabs the current frame.
 */
export function CameraCapture({ active, onCapture }: Props) {
  const { status, stream, devices, deviceId, selectDevice, error } = useCamera({
    active,
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  const [flip, setFlip] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  // A second click can land before the disabled button re-renders, so the
  // guard is a ref as well as state. Each capture makes an object URL, and a
  // second one would never be revoked.
  const capturingRef = useRef(false)
  // A frame can finish encoding after the page has moved on. Handing it up
  // then would make an object URL that nobody shows or frees.
  const mountedRef = useRef(false)

  useEffect(() => {
    // Set here, not at creation, so StrictMode's second mount sets it again.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // srcObject has no JSX attribute, so the stream is handed over by hand.
  useEffect(() => {
    const video = videoRef.current
    if (video) video.srcObject = stream
  }, [stream])

  async function capture() {
    const video = videoRef.current
    if (!video || capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    setCaptureError(null)
    try {
      const image = await captureFrame(video, { flip })
      if (!mountedRef.current) return
      onCapture(image, URL.createObjectURL(image))
    } catch (err) {
      if (!mountedRef.current) return
      console.error('Capturing the frame failed', err)
      setCaptureError(
        err instanceof Error ? err.message : 'The frame could not be captured.',
      )
    } finally {
      capturingRef.current = false
      if (mountedRef.current) setCapturing(false)
    }
  }

  return (
    <div className="camera-capture">
      <div className="camera">
        <video
          ref={videoRef}
          className={cx('camera__video', flip && 'camera__video--flipped')}
          autoPlay
          playsInline
          muted
          aria-label="Live camera"
        />
        <div className="camera__guide" aria-hidden="true" />
      </div>

      {status === 'starting' && (
        <Consulting role="status">Lighting the glass…</Consulting>
      )}
      {/* An error can sit beside a live stream: a camera that would not open
          after the previous one came back. */}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {captureError && (
        <Notice tone="danger" role="alert">
          {captureError}
        </Notice>
      )}

      <div className="camera__controls">
        {devices.length > 1 && (
          <Field label="Camera">
            <Select
              value={deviceId ?? ''}
              onChange={(event) => selectDevice(event.target.value)}
            >
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {/* A native checkbox: the `control` rules are for text fields. */}
        <label className="camera__flip">
          <input
            type="checkbox"
            checked={flip}
            onChange={(event) => setFlip(event.target.checked)}
          />{' '}
          Flip image
        </label>
        <Button
          variant="primary"
          disabled={status !== 'live' || capturing}
          onClick={capture}
        >
          Capture
        </Button>
      </div>
    </div>
  )
}
