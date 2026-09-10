import { createHash } from "node:crypto";
import { CATEGORIES, type Category } from "@/lib/types";

export const MAX_RENDER_BODY_BYTES = 4_000_000;
export const MAX_RENDER_IMAGE_BYTES = 1_500_000;
export const MAX_RENDER_NOTES_LENGTH = 300;
const MAX_RESULT_BYTES = 3_000_000;
const MAX_PROVIDER_ERROR_BYTES = 16_000;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class RenderError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RenderError";
    this.status = status;
  }
}

type Raster = { bytes: Buffer; mime: string; extension: string };
export type RenderInput = {
  apiKey: string;
  referencePhoto: Raster;
  items: { id: string; name: string; category: Category | null; image: Raster }[];
  notes: string;
};

export function getRenderStatus() {
  return {
    enabled: process.env.OUTFIT_RENDERING_ENABLED !== "false",
    provider: "openai",
    model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2",
    requiresApiKey: true,
  };
}

export function parseRaster(value: unknown, maxBytes = MAX_RENDER_IMAGE_BYTES): Raster {
  if (typeof value !== "string") throw new RenderError("Choose a JPEG, PNG, or WebP image.");
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 40) {
    throw new RenderError("Each image must be under 1.5 MB.", 413);
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(value);
  if (!match || !match[2] || !BASE64.test(match[2])) {
    throw new RenderError("Use a JPEG, PNG, or WebP image.");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > maxBytes) throw new RenderError("The image is too large.", 413);
  const mime = match[1];
  const valid = bytes.length >= 12 && (
    (mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (mime === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
  );
  if (!valid) throw new RenderError("An image could not be read. Use a JPEG, PNG, or WebP image.");
  return { bytes, mime, extension: mime === "image/jpeg" ? "jpg" : mime.slice(6) };
}

export function parseRenderInput(value: unknown): RenderInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RenderError("The render request is invalid.");
  }
  const body = value as Record<string, unknown>;
  // Require a user-owned key: supplied for a guest session, or resolved on the
  // server for an authenticated account. Never use a deployment OpenAI key.
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!/^sk-[A-Za-z0-9_-]{16,500}$/.test(apiKey)) {
    throw new RenderError("Enter your OpenAI API key to render.", 401);
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 6) {
    throw new RenderError("Select between 1 and 6 owned pieces.");
  }
  const referencePhoto = parseRaster(body.referencePhoto);
  const ids = new Set<string>();
  const items = body.items.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new RenderError("A selected piece is invalid.");
    const piece = item as Record<string, unknown>;
    if (typeof piece.id !== "string" || !piece.id.trim() || piece.id.length > 100 || ids.has(piece.id)) {
      throw new RenderError("Each selected piece must have a unique ID.");
    }
    ids.add(piece.id);
    if (typeof piece.name !== "string" || !piece.name.trim() || piece.name.length > 500) {
      throw new RenderError("A selected piece needs a name.");
    }
    if (piece.category !== undefined && !(CATEGORIES as readonly unknown[]).includes(piece.category)) {
      throw new RenderError("A selected piece has an unknown category.");
    }
    return { id: piece.id, name: piece.name.trim(), category: (piece.category as Category | undefined) ?? null, image: parseRaster(piece.imageData) };
  });
  return { apiKey, referencePhoto, items, notes: parseNotes(body.notes) };
}

// Styling notes are typed by the person rendering their own photo with their
// own key, so they may shape the prompt. They are still bounded and flattened
// to one line so they cannot masquerade as separate instructions.
function parseNotes(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RenderError("Styling notes must be text.");
  if (value.length > MAX_RENDER_NOTES_LENGTH * 2) throw new RenderError(`Keep styling notes under ${MAX_RENDER_NOTES_LENGTH} characters.`);
  const flat = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim();
  if (flat.length > MAX_RENDER_NOTES_LENGTH) throw new RenderError(`Keep styling notes under ${MAX_RENDER_NOTES_LENGTH} characters.`);
  return flat;
}

const categoryLabels: Readonly<Record<Category, string>> = {
  tops: "a top",
  jackets: "a jacket or outer layer",
  bottoms: "bottoms",
  accessories: "an accessory",
  shoes: "shoes",
};

export function buildRenderPrompt(input: Pick<RenderInput, "items" | "notes">): string {
  const pieces = input.items.map((item, index) => `Image ${index + 2} is ${item.category ? categoryLabels[item.category] : "an owned piece"}.`);
  const hasAccessory = input.items.some((item) => item.category === "accessories" || item.category === null);
  return [
    "Create one photographic wardrobe try-on image.",
    "Image 1 is the person's reference photograph. Preserve their identity, face, body proportions, pose, and background.",
    `Images 2 through ${input.items.length + 1} show the exact owned pieces selected by this person.`,
    ...pieces,
    "Dress the person in every one of those pieces, preserving their colors, textures, cut, details, and branding. Every supplied piece must be clearly visible and worn on the person; none may be omitted.",
    ...(hasAccessory ? ["Accessories must be worn where they belong: sunglasses and glasses on the face, hats on the head, belts through the waistband, jewelry on the neck, ears, wrists, or hands, bags carried or shouldered."] : []),
    "Use only the supplied pieces. Retain the person's original clothing only where no replacement piece was supplied. Do not add any pieces or accessories that were not supplied, and do not redesign the garments.",
    ...(input.notes ? [`The person's styling notes, describing how to wear and style the supplied pieces: "${input.notes.replaceAll('"', "'")}". Apply them only as far as they do not conflict with the instructions above.`] : []),
    "Render realistic fabric, layering, and fit. Output only the photograph. Do not add text, captions, ratings, suggestions, or commentary.",
  ].join(" ");
}

export async function readLimitedJson(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) throw new RenderError("The request is empty.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new RenderError("The image request is too large. Use smaller photos.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RenderError("The image request could not be read.");
  }
}

// Best-effort per-instance throttling. BYOK, rather than this in-memory limit,
// is what prevents anonymous callers from spending deployment credentials.
const renderRequests = new Map<string, { started: number; active: boolean }>();
export function beginRender(apiKey: string): () => void {
  const fingerprint = createHash("sha256").update(apiKey).digest("hex");
  const now = Date.now();
  for (const [key, state] of renderRequests) {
    if (now - state.started > 180_000) renderRequests.delete(key);
  }
  const current = renderRequests.get(fingerprint);
  if (current && (current.active || now - current.started < 15_000)) {
    throw new RenderError("Wait for the current render before trying again.", 429);
  }
  if (renderRequests.size >= 2_000) throw new RenderError("Rendering is busy. Try again shortly.", 429);
  const state = { started: now, active: true };
  renderRequests.set(fingerprint, state);
  return () => { state.active = false; };
}

const providerLimits: Readonly<Record<string, string>> = {
  credit_balance_exhausted: "Your OpenAI API credit balance is exhausted. Check your API billing to add credits.",
  organization_spend_limit_exceeded: "Your OpenAI organization’s spending limit was reached. Check its API billing and spending limits.",
  project_spend_limit_exceeded: "Your OpenAI project’s spending limit was reached. Check this project’s API spending limit.",
  billing_hard_limit_reached: "Your OpenAI API spending limit was reached. Check your API billing and spending limits.",
  organization_usage_limit_exceeded: "Your OpenAI organization’s approved usage limit was reached. Check its API usage limits.",
  insufficient_quota: "Your OpenAI API quota was reached. Check your API credit balance and usage limits.",
  slow_down: "OpenAI’s temporary request limit was reached. Wait a little, then try again.",
  rate_limit_error: "OpenAI’s temporary request limit was reached. Wait a little, then try again.",
  rate_limit_exceeded: "OpenAI’s temporary request limit was reached. Wait a little, then try again.",
};

const providerCodes = new Set([...Object.keys(providerLimits), "unsupported_parameter", "unknown_parameter", "invalid_parameter", "invalid_value", "invalid_request_error", "model_not_found", "content_policy_violation", "server_error"]);
const providerTypes = new Set([...Object.keys(providerLimits), "invalid_request_error", "authentication_error", "permission_error", "server_error"]);
const settingsParameters = new Set(["model", "input_fidelity", "size", "quality", "n", "output_format", "output_compression", "background"]);
const providerParameters = new Set([...settingsParameters, "image", "image[]", "mask", "prompt"]);
type ProviderError = { code?: string; type?: string; param?: string };

async function readProviderError(response: Response): Promise<ProviderError> {
  try {
    if (Number(response.headers.get("content-length")) > MAX_PROVIDER_ERROR_BYTES) {
      await response.body?.cancel();
      return {};
    }
    const data = await readLimitedJson(response.body, MAX_PROVIDER_ERROR_BYTES);
    if (!data || typeof data !== "object" || Array.isArray(data) || !("error" in data)) return {};
    const error = data.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return {};
    const fields = error as Record<string, unknown>;
    // Provider prose can contain caller data. Only known identifiers may reach
    // our messages or logs; never include the provider's message or request body.
    return {
      ...(typeof fields.code === "string" && providerCodes.has(fields.code) ? { code: fields.code } : {}),
      ...(typeof fields.type === "string" && providerTypes.has(fields.type) ? { type: fields.type } : {}),
      ...(typeof fields.param === "string" && providerParameters.has(fields.param) ? { param: fields.param } : {}),
    };
  } catch { /* A malformed or oversized error must not mask its HTTP status. */ }
  return {};
}

export async function renderOutfit(input: RenderInput, fetcher: typeof fetch = fetch) {
  const status = getRenderStatus();
  if (!status.enabled) throw new RenderError("Image rendering is currently unavailable.", 503);

  const form = new FormData();
  form.set("model", status.model);
  form.set("n", "1");
  form.set("size", "1024x1536");
  form.set("quality", "medium");
  // GPT Image 2 handles every input at high fidelity and rejects this setting.
  // Only send it to the older models that support explicitly selecting it.
  if (/^gpt-image-1(?:\.5)?(?:-\d{4}-\d{2}-\d{2})?$/.test(status.model)) form.set("input_fidelity", "high");
  form.set("output_format", "jpeg");
  form.set("output_compression", "85");
  form.set("prompt", buildRenderPrompt(input));
  const images = [input.referencePhoto, ...input.items.map((item) => item.image)];
  images.forEach((image, index) => {
    form.append("image[]", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `${index + 1}.${image.extension}`);
  });

  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(110_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new RenderError("The image service did not respond. Try again shortly.", 502);
  }
  if (!response.ok) {
    const error = await readProviderError(response);
    const requestId = response.headers.get("x-request-id");
    console.warn("capsule.render.provider_error", {
      status: response.status,
      ...error,
      ...(requestId && /^req_[A-Za-z0-9_-]{1,100}$/.test(requestId) ? { requestId } : {}),
    });
    const limitMessage = providerLimits[error.code ?? ""] ?? providerLimits[error.type ?? ""];
    if (limitMessage) throw new RenderError(limitMessage, 429);
    if (response.status === 401 || response.status === 403) {
      throw new RenderError("Check your API key and image-model access.", 401);
    }
    if (response.status === 429) throw new RenderError("OpenAI returned a limit error. Check your API usage and billing, or try again later.", 429);
    if (error.code === "model_not_found") throw new RenderError("The configured image model is unavailable to your OpenAI project. Check its model access.", 403);
    if (error.code === "content_policy_violation") throw new RenderError("OpenAI declined this render under its content policy.", 400);
    if (response.status === 400 || response.status === 422) {
      if (settingsParameters.has(error.param ?? "")) throw new RenderError("OpenAI rejected Capsule’s render settings. Please report this error.", 500);
      if (error.param === "image" || error.param === "image[]" || error.param === "mask") throw new RenderError("OpenAI could not process one of the photos. Try another photo.", 400);
      throw new RenderError("OpenAI rejected this render request. Please report this error.", 400);
    }
    if (response.status >= 500) throw new RenderError("OpenAI could not complete this render. Try again shortly.", 502);
    throw new RenderError("The image service could not complete this render.", 502);
  }
  try {
    const result = await readLimitedJson(response.body, MAX_RENDER_BODY_BYTES + 10_000) as { data?: { b64_json?: unknown }[] };
    const encoded = result?.data?.[0]?.b64_json;
    if (typeof encoded !== "string") throw new Error("Missing image");
    parseRaster(`data:image/jpeg;base64,${encoded}`, MAX_RESULT_BYTES);
    return { imageData: `data:image/jpeg;base64,${encoded}` };
  } catch {
    throw new RenderError("The image service did not return a usable image.", 502);
  }
}
