import { AutoModel, AutoProcessor, RawImage, env, type Tensor } from "@huggingface/transformers";
import type { BackgroundRequest, BackgroundResponse } from "./background-removal-types";

// MIT weights, pinned independently of the runtime. See THIRD_PARTY_NOTICES.md.
const MODEL = "studioludens/birefnet-lite-512";
const REVISION = "4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7";
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;
env.cacheKey = "capsule-background-model-v1";
// The app remains compatible with ordinary hosting and Google OAuth popups;
// CPU work is already isolated in this worker and needs no shared-memory threads.
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;

type Runtime = { model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>; processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>; gpu: boolean };
let runtime: Runtime | null = null;
const scope = self as unknown as { postMessage: (value: BackgroundResponse) => void; onmessage: ((event: MessageEvent<BackgroundRequest>) => void) | null };

async function supportsGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: { has: (name: string) => boolean }; limits: { maxStorageBuffersPerShaderStage: number } } | null> } }).gpu;
  try {
    const adapter = await gpu?.requestAdapter();
    return !!adapter && adapter.features.has("shader-f16") && adapter.limits.maxStorageBuffersPerShaderStage >= 10;
  } catch { return false; }
}

async function load(id: string, gpu: boolean): Promise<Runtime> {
  scope.postMessage({ id, type: "progress", value: { stage: "download" } });
  const model = await AutoModel.from_pretrained(MODEL, {
    revision: REVISION, device: gpu ? "webgpu" : "wasm", dtype: gpu ? "fp16" : "fp32",
    progress_callback: (event) => {
      if (event.status === "progress_total" || (event.status === "progress" && event.file.endsWith(".onnx"))) {
        scope.postMessage({ id, type: "progress", value: { stage: "download", progress: Math.round(event.progress) } });
      }
    },
  });
  try {
    const processor = await AutoProcessor.from_pretrained(MODEL, { revision: REVISION });
    return { model, processor, gpu };
  } catch (error) { await model.dispose(); throw error; }
}

async function foreground(image: RawImage, current: Runtime): Promise<RawImage> {
  const { pixel_values } = await current.processor(image.clone().rgb());
  let outputs: Record<string, Tensor> | undefined;
  try {
    const result = await current.model({ input_image: pixel_values }) as Record<string, Tensor>;
    outputs = result;
    const logits = result.logits ?? result.output_image ?? Object.values(result)[0];
    if (!logits || logits.dims.at(-1) !== 512 || logits.dims.at(-2) !== 512) throw new Error("Unexpected mask dimensions.");
    const mask = await RawImage.fromTensor(logits.squeeze(0).sigmoid().mul(255).to("uint8")).resize(image.width, image.height);
    const cutout = image.clone().rgba();
    for (let i = 0; i < mask.data.length; i++) cutout.data[i * 4 + 3] = Math.round(cutout.data[i * 4 + 3] * mask.data[i] / 255);
    return cutout;
  } finally {
    pixel_values.dispose();
    if (outputs) Object.values(outputs).forEach((tensor) => tensor.dispose());
  }
}

scope.onmessage = async ({ data: { id, image: source } }) => {
  try {
    const bitmap = await createImageBitmap(source);
    let image: RawImage;
    try {
      if (bitmap.width * bitmap.height > 64_000_000) throw new Error("Photo too large.");
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image processing is unavailable.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      image = RawImage.fromCanvas(canvas);
    } finally { bitmap.close(); }

    if (!runtime) {
      const gpu = await supportsGPU();
      try { runtime = await load(id, gpu); }
      catch (error) { if (!gpu) throw error; runtime = await load(id, false); }
    }
    scope.postMessage({ id, type: "progress", value: { stage: "processing" } });
    let cutout: RawImage;
    try { cutout = await foreground(image, runtime); }
    catch (error) {
      if (!runtime.gpu) throw error;
      await runtime.model.dispose().catch(() => {});
      runtime = await load(id, false);
      scope.postMessage({ id, type: "progress", value: { stage: "processing" } });
      cutout = await foreground(image, runtime);
    }
    const result: Blob = await cutout.toBlob("image/webp", 0.9);
    scope.postMessage({ id, type: "complete", image: result });
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.error("Background removal:", error instanceof Error ? error.message : "Model failed");
    scope.postMessage({ id, type: "error", message: navigator.onLine ? "Background removal could not finish on this device. Try a smaller photo, or keep the original." : "Connect to the internet once to download background removal, then try again." });
  }
};
