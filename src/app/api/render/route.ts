import { beginRender, getRenderStatus, MAX_RENDER_BODY_BYTES, parseRenderInput, readLimitedJson, RenderError, renderOutfit } from "@/lib/server/render";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  let finish: (() => void) | undefined;
  try {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
      throw new RenderError("This render must be requested from Capsule.", 403);
    }
    if (!getRenderStatus().enabled) throw new RenderError("Image rendering is currently unavailable.", 503);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new RenderError("Send a JSON render request.", 415);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_RENDER_BODY_BYTES) throw new RenderError("Use smaller photos to render this outfit.", 413);
    const input = parseRenderInput(await readLimitedJson(request.body, MAX_RENDER_BODY_BYTES));
    finish = beginRender(input.apiKey);
    return Response.json(await renderOutfit(input), { headers });
  } catch (error) {
    const expected = error instanceof RenderError;
    return Response.json({ error: expected ? error.message : "This outfit could not be rendered." }, {
      status: expected ? error.status : 500,
      headers,
    });
  } finally {
    finish?.();
  }
}
