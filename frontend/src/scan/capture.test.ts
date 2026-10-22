import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureFrame } from './capture'

// jsdom has no canvas, so the 2D context and toBlob are stand-ins that record
// what captureFrame asks of them.
let context: {
  translate: ReturnType<typeof vi.fn>
  rotate: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
}
let blobOut: Blob | null
let toBlob: ReturnType<typeof vi.fn>
let canvases: HTMLCanvasElement[]

function video(width: number, height: number): HTMLVideoElement {
  const element = document.createElement('video')
  // Read-only getters in jsdom that always answer 0.
  Object.defineProperty(element, 'videoWidth', { value: width })
  Object.defineProperty(element, 'videoHeight', { value: height })
  return element
}

beforeEach(() => {
  context = { translate: vi.fn(), rotate: vi.fn(), drawImage: vi.fn() }
  blobOut = new Blob(['jpeg'], { type: 'image/jpeg' })
  canvases = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as unknown as CanvasRenderingContext2D,
  )
  toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (this: HTMLCanvasElement, callback) {
      canvases.push(this)
      callback(blobOut)
    }) as unknown as ReturnType<typeof vi.fn>
})

afterEach(() => vi.restoreAllMocks())

describe('captureFrame', () => {
  it('draws the frame at the video size and encodes a JPEG', async () => {
    const source = video(1280, 720)
    const blob = await captureFrame(source, { flip: false })

    expect(blob).toBe(blobOut)
    expect(canvases[0].width).toBe(1280)
    expect(canvases[0].height).toBe(720)
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 1280, 720)
    expect(toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      0.92,
    )
  })

  it('leaves the frame upright when flip is off', async () => {
    await captureFrame(video(640, 480), { flip: false })
    expect(context.translate).not.toHaveBeenCalled()
    expect(context.rotate).not.toHaveBeenCalled()
  })

  it('turns the frame half a circle when flip is on', async () => {
    await captureFrame(video(640, 480), { flip: true })
    expect(context.translate).toHaveBeenCalledWith(640, 480)
    expect(context.rotate).toHaveBeenCalledWith(Math.PI)
    // The turn is set up before the frame is drawn through it.
    expect(context.rotate.mock.invocationCallOrder[0]).toBeLessThan(
      context.drawImage.mock.invocationCallOrder[0],
    )
  })

  it('refuses a video that has not delivered a frame yet', async () => {
    await expect(captureFrame(video(0, 480), { flip: false })).rejects.toThrow(
      'The camera has not delivered a frame yet.',
    )
    await expect(captureFrame(video(640, 0), { flip: false })).rejects.toThrow(
      'The camera has not delivered a frame yet.',
    )
    expect(context.drawImage).not.toHaveBeenCalled()
  })

  it('rejects when the canvas cannot encode the frame', async () => {
    blobOut = null
    await expect(
      captureFrame(video(640, 480), { flip: false }),
    ).rejects.toThrow(Error)
  })
})
