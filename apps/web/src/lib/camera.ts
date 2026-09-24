type CameraDevices = Pick<MediaDevices, "getUserMedia">;

export function stopCameraStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* Release the remaining tracks too. */ }
  }
}

/** Permission is requested by the caller's explicit camera action only. */
export async function requestCameraStream(signal: AbortSignal, devices?: CameraDevices): Promise<MediaStream> {
  signal.throwIfAborted();
  const camera = devices ?? (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
  if (!camera?.getUserMedia) throw new Error("The camera is unavailable in this browser. Choose a photo from your library or files.");
  const stream = await camera.getUserMedia({ audio: false, video: { facingMode: { ideal: "user" }, width: { ideal: 1600 }, height: { ideal: 1200 } } });
  // getUserMedia cannot be cancelled while its permission prompt is open.
  // A late grant must never leave a camera running after the picker closes.
  if (signal.aborted) { stopCameraStream(stream); signal.throwIfAborted(); }
  signal.addEventListener("abort", () => stopCameraStream(stream), { once: true });
  return stream;
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was blocked. Allow it in your browser, or choose a photo from your library.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found. Choose a photo from your library or files.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is in use or could not start. Close other camera apps and try again.";
  return error instanceof Error && error.message ? error.message : "The camera could not start. Choose a photo from your library or files.";
}

export async function captureCameraPhoto(video: HTMLVideoElement): Promise<File> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error("Wait for the camera preview, then try again.");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not capture a photo. Choose a photo from your library.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The photo could not be captured. Try again.")), "image/jpeg", 0.9));
  return new File([blob], `capsule-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
}
