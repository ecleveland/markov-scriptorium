import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraCapture } from './CameraCapture'
import type { Camera } from './useCamera'

vi.mock('./useCamera', () => ({ useCamera: vi.fn() }))
vi.mock('./capture', () => ({ captureFrame: vi.fn() }))

import { captureFrame } from './capture'
import { useCamera } from './useCamera'

const useCameraMock = vi.mocked(useCamera)
const captureMock = vi.mocked(captureFrame)

function device(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    label,
    kind: 'videoinput',
    groupId: 'g',
  } as MediaDeviceInfo
}

const selectDevice = vi.fn()
const liveStream = {} as MediaStream

function camera(overrides: Partial<Camera> = {}): Camera {
  return {
    status: 'live',
    stream: liveStream,
    devices: [device('cam-desk', 'Desk camera')],
    deviceId: 'cam-desk',
    selectDevice,
    error: null,
    ...overrides,
  }
}

// jsdom has no object URLs.
const createObjectURL = vi.fn(() => 'blob:still')
const originalCreate = URL.createObjectURL

beforeEach(() => {
  URL.createObjectURL = createObjectURL
})

afterEach(() => {
  URL.createObjectURL = originalCreate
  vi.clearAllMocks()
})

/**
 * Let the video show a frame. jsdom has no requestVideoFrameCallback, so the
 * component listens for timeupdate.
 */
function presentFrame() {
  act(() => {
    fireEvent.timeUpdate(screen.getByLabelText('Live camera'))
  })
}

/** Render the active camera and let it paint its first frame. */
function renderLive(onCapture = vi.fn()) {
  const result = render(<CameraCapture active onCapture={onCapture} />)
  presentFrame()
  return result
}

describe('CameraCapture', () => {
  it('shows the live video and the card guide', () => {
    useCameraMock.mockReturnValue(camera())
    const { container } = render(<CameraCapture active onCapture={vi.fn()} />)

    expect(screen.getByLabelText('Live camera').tagName).toBe('VIDEO')
    expect(container.querySelector('.camera__guide')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('rests the camera when it is not active', () => {
    useCameraMock.mockReturnValue(camera())
    const { rerender } = render(
      <CameraCapture active={false} onCapture={vi.fn()} />,
    )
    expect(useCameraMock).toHaveBeenLastCalledWith({ active: false })

    rerender(<CameraCapture active onCapture={vi.fn()} />)
    expect(useCameraMock).toHaveBeenLastCalledWith({ active: true })
  })

  it('hands the stream to the video', () => {
    const stream = {} as MediaStream
    useCameraMock.mockReturnValue(camera({ stream }))
    render(<CameraCapture active onCapture={vi.fn()} />)

    const video = screen.getByLabelText('Live camera') as HTMLVideoElement
    expect(video.srcObject).toBe(stream)
  })

  it('offers no camera picker when there is one camera', () => {
    useCameraMock.mockReturnValue(camera())
    render(<CameraCapture active onCapture={vi.fn()} />)

    expect(screen.queryByLabelText('Camera')).not.toBeInTheDocument()
  })

  it('offers a picker with two cameras and switches on a choice', async () => {
    const user = userEvent.setup()
    useCameraMock.mockReturnValue(
      camera({
        devices: [device('cam-desk', 'Desk camera'), device('cam-2', '')],
      }),
    )
    render(<CameraCapture active onCapture={vi.fn()} />)

    const picker = screen.getByLabelText('Camera')
    expect(picker).toHaveValue('cam-desk')
    // A camera without a label (no permission yet) gets a numbered name.
    expect(screen.getByRole('option', { name: 'Camera 2' })).toBeInTheDocument()

    await user.selectOptions(picker, 'cam-2')
    expect(selectDevice).toHaveBeenCalledWith('cam-2')
  })

  it('asks for a camera when the live one is not in the picker', async () => {
    const user = userEvent.setup()
    useCameraMock.mockReturnValue(
      camera({
        devices: [device('cam-desk', 'Desk camera'), device('cam-2', '')],
        deviceId: null,
      }),
    )
    render(<CameraCapture active onCapture={vi.fn()} />)

    const picker = screen.getByLabelText('Camera')
    // The first camera is not shown as chosen when it is not the live one.
    expect(picker).toHaveValue('')
    expect(
      screen.getByRole('option', { name: 'Choose a camera' }),
    ).toBeDisabled()

    await user.selectOptions(picker, 'cam-2')
    expect(selectDevice).toHaveBeenCalledWith('cam-2')
  })

  it('offers no placeholder when the live camera is listed', () => {
    useCameraMock.mockReturnValue(
      camera({
        devices: [device('cam-desk', 'Desk camera'), device('cam-2', '')],
      }),
    )
    render(<CameraCapture active onCapture={vi.fn()} />)

    expect(
      screen.queryByRole('option', { name: 'Choose a camera' }),
    ).not.toBeInTheDocument()
  })

  it('turns the video over when Flip image is ticked', async () => {
    const user = userEvent.setup()
    useCameraMock.mockReturnValue(camera())
    render(<CameraCapture active onCapture={vi.fn()} />)

    const video = screen.getByLabelText('Live camera')
    const flip = screen.getByLabelText('Flip image')
    expect(flip).not.toBeChecked()
    expect(flip).not.toHaveClass('control')
    expect(video).not.toHaveClass('camera__video--flipped')

    await user.click(flip)
    expect(video).toHaveClass('camera__video--flipped')
    await user.click(flip)
    expect(video).not.toHaveClass('camera__video--flipped')
  })

  it('keeps Capture disabled and lights the glass while starting', () => {
    useCameraMock.mockReturnValue(camera({ status: 'starting', devices: [] }))
    render(<CameraCapture active onCapture={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Lighting the glass…')
  })

  it('holds Capture until the camera paints a frame', () => {
    useCameraMock.mockReturnValue(camera())
    render(<CameraCapture active onCapture={vi.fn()} />)

    const button = screen.getByRole('button', { name: 'Capture' })
    expect(button).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Lighting the glass…')

    presentFrame()
    expect(button).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('holds Capture again after the camera rests and wakes', () => {
    useCameraMock.mockReturnValue(camera())
    const { rerender } = renderLive()
    const button = screen.getByRole('button', { name: 'Capture' })
    expect(button).toBeEnabled()

    rerender(<CameraCapture active={false} onCapture={vi.fn()} />)
    rerender(<CameraCapture active onCapture={vi.fn()} />)
    // The woken camera's first frame can be black.
    expect(button).toBeDisabled()

    presentFrame()
    expect(button).toBeEnabled()
  })

  it('holds Capture after a camera switch', () => {
    useCameraMock.mockReturnValue(camera())
    const { rerender } = renderLive()
    const button = screen.getByRole('button', { name: 'Capture' })
    expect(button).toBeEnabled()

    useCameraMock.mockReturnValue(camera({ stream: {} as MediaStream }))
    rerender(<CameraCapture active onCapture={vi.fn()} />)
    expect(button).toBeDisabled()

    presentFrame()
    expect(button).toBeEnabled()
  })

  it('uses requestVideoFrameCallback when the browser has it', () => {
    // jsdom has none, which is why the other tests take the timeupdate path.
    expect('requestVideoFrameCallback' in HTMLVideoElement.prototype).toBe(
      false,
    )
    const request = vi.fn<HTMLVideoElement['requestVideoFrameCallback']>(
      () => 7,
    )
    const cancel = vi.fn()
    Object.assign(HTMLVideoElement.prototype, {
      requestVideoFrameCallback: request,
      cancelVideoFrameCallback: cancel,
    })
    try {
      useCameraMock.mockReturnValue(camera())
      const { unmount } = render(<CameraCapture active onCapture={vi.fn()} />)
      const video = screen.getByLabelText('Live camera')
      const button = screen.getByRole('button', { name: 'Capture' })

      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.contexts[0]).toBe(video)
      // With the browser's own frame callback, the clock is not the signal.
      presentFrame()
      expect(button).toBeDisabled()

      act(() => {
        request.mock.calls[0][0](0, {} as VideoFrameCallbackMetadata)
      })
      expect(button).toBeEnabled()

      unmount()
      expect(cancel).toHaveBeenCalledWith(7)
    } finally {
      Reflect.deleteProperty(
        HTMLVideoElement.prototype,
        'requestVideoFrameCallback',
      )
      Reflect.deleteProperty(
        HTMLVideoElement.prototype,
        'cancelVideoFrameCallback',
      )
    }
  })

  it('captures the frame, flipped when asked, and hands it up', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
    captureMock.mockResolvedValue(blob)
    useCameraMock.mockReturnValue(camera())
    const onCapture = vi.fn()
    renderLive(onCapture)

    await user.click(screen.getByLabelText('Flip image'))
    await user.click(screen.getByRole('button', { name: 'Capture' }))

    await waitFor(() =>
      expect(onCapture).toHaveBeenCalledWith(blob, 'blob:still'),
    )
    expect(captureMock).toHaveBeenCalledWith(
      screen.getByLabelText('Live camera'),
      { flip: true },
    )
    expect(createObjectURL).toHaveBeenCalledWith(blob)
  })

  it('takes one frame for a double click', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
    let deliver: (value: Blob) => void = () => {}
    captureMock.mockReturnValue(
      new Promise<Blob>((resolve) => {
        deliver = resolve
      }),
    )
    useCameraMock.mockReturnValue(camera())
    const onCapture = vi.fn()
    renderLive(onCapture)

    const button = screen.getByRole('button', { name: 'Capture' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    await act(async () => deliver(blob))

    expect(captureMock).toHaveBeenCalledTimes(1)
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    // Ready for the next card once the frame is handed up.
    expect(button).toBeEnabled()
  })

  it('drops a frame that arrives after the camera is gone', async () => {
    let deliver: (value: Blob) => void = () => {}
    captureMock.mockReturnValue(
      new Promise<Blob>((resolve) => {
        deliver = resolve
      }),
    )
    useCameraMock.mockReturnValue(camera())
    const onCapture = vi.fn()
    const { unmount } = renderLive(onCapture)

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    unmount()
    await act(async () => deliver(new Blob(['jpeg'], { type: 'image/jpeg' })))

    expect(onCapture).not.toHaveBeenCalled()
    // No object URL is made for a frame nobody will show or free.
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('says so when a chosen camera failed and the previous one is back', () => {
    useCameraMock.mockReturnValue(
      camera({
        status: 'live',
        error:
          'The chosen camera would not open, so the glass went back to the one before.',
      }),
    )
    renderLive()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The chosen camera would not open, so the glass went back to the one before.',
    )
    // The camera is live again, so capturing still works.
    expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled()
  })

  it('shows why a capture failed', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    captureMock.mockRejectedValue(
      new Error('The camera has not delivered a frame yet.'),
    )
    useCameraMock.mockReturnValue(camera())
    const onCapture = vi.fn()
    renderLive(onCapture)

    await user.click(screen.getByRole('button', { name: 'Capture' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The camera has not delivered a frame yet.',
    )
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('shows the camera error as an alert and keeps Capture disabled', () => {
    useCameraMock.mockReturnValue(
      camera({
        status: 'error',
        devices: [],
        deviceId: null,
        error: 'No camera was found. Plug one in and reload.',
      }),
    )
    render(<CameraCapture active onCapture={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No camera was found. Plug one in and reload.',
    )
    expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled()
  })
})
