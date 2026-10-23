/**
 * Grab the frame the video is showing as a JPEG. With `flip` the frame is
 * turned half a circle, for a camera mounted upside down over the desk, so
 * the scanner reads the card the right way up.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  options: { flip: boolean },
): Promise<Blob> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (width === 0 || height === 0) {
    throw new Error('The camera has not delivered a frame yet.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot draw the frame.')

  if (options.flip) {
    context.translate(width, height)
    context.rotate(Math.PI)
  }
  context.drawImage(video, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The frame could not be saved as an image.')),
      'image/jpeg',
      0.92,
    )
  })
}
