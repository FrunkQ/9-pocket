// Camera helpers: starting the right lens with the best focus the browser
// offers, and cutting the framed part of the picture out of a video frame.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The part of the video frame that sits under the on-screen guide.
 * The video is shown with `object-fit: cover` and then magnified by `zoom`
 * about its centre, so one screen pixel covers 1 / (cover scale * zoom) video
 * pixels. `margin` adds spare border around the guide, as a share of its size.
 */
export function guideCrop(view: Box, guide: Box, videoW: number, videoH: number, zoom: number, margin: number): Rect {
  const scale = Math.max(view.width / videoW, view.height / videoH) * zoom;
  const cx = view.left + view.width / 2;
  const cy = view.top + view.height / 2;
  const left = guide.left - guide.width * margin;
  const top = guide.top - guide.height * margin;
  const right = guide.left + guide.width * (1 + margin);
  const bottom = guide.top + guide.height * (1 + margin);
  const x0 = Math.max(0, videoW / 2 + (left - cx) / scale);
  const y0 = Math.max(0, videoH / 2 + (top - cy) / scale);
  const x1 = Math.min(videoW, videoW / 2 + (right - cx) / scale);
  const y1 = Math.min(videoH, videoH / 2 + (bottom - cy) / scale);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(y1 - y0)) };
}

export function cropFrame(video: HTMLVideoElement, rect: Rect): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  canvas.getContext('2d')!.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return canvas;
}

// Focus controls are not in TypeScript's DOM types yet.
type FocusCaps = MediaTrackCapabilities & { focusMode?: string[] };
type FocusConstraint = MediaTrackConstraintSet & { focusMode?: string };

function focusModes(track: MediaStreamTrack): string[] {
  return (track.getCapabilities?.() as FocusCaps | undefined)?.focusMode ?? [];
}

/** Keeps the lens refocusing as the card moves, where the browser allows it. */
export async function keepFocusing(track: MediaStreamTrack): Promise<void> {
  if (!focusModes(track).includes('continuous')) return;
  await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as FocusConstraint] }).catch(() => undefined);
}

/** Forces one fresh focus pass (tap to focus), then goes back to continuous. */
export async function refocus(track: MediaStreamTrack): Promise<void> {
  const modes = focusModes(track);
  if (modes.includes('single-shot')) {
    await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' } as FocusConstraint] }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 900));
  }
  await keepFocusing(track);
}

const SIZE = { width: { ideal: 3840 }, height: { ideal: 2160 } };

/** Opens a rear camera at the highest resolution on offer; `deviceId` picks a specific lens. */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  const video: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId }, ...SIZE } : { facingMode: { ideal: 'environment' }, ...SIZE };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

/** Rear cameras, once permission has been given (labels are blank before that). */
export async function rearCameras(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const cams = all.filter((d) => d.kind === 'videoinput');
  const rear = cams.filter((d) => /back|rear|environment/i.test(d.label));
  return rear.length ? rear : cams;
}

/**
 * Phones with several rear lenses expose a combined camera that switches lens
 * by itself, including to the close-focus lens. That is the best one for
 * photographing a card, so prefer it when it exists.
 */
export function preferredCamera(cameras: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  return cameras.find((d) => /triple/i.test(d.label)) ?? cameras.find((d) => /dual wide/i.test(d.label));
}
