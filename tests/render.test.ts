import assert from "node:assert/strict";
import test from "node:test";
import { beginRender, getRenderStatus, MAX_RENDER_BODY_BYTES, MAX_RENDER_IMAGE_BYTES, parseRaster, parseRenderInput, readLimitedJson, RenderError, renderOutfit } from "../src/lib/server/render";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
const jpeg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217]).toString("base64")}`;
const key = "sk-test-render-only-not-a-real-key";
const request = () => ({ apiKey: key, referencePhoto: png, items: [{ id: "owned-shirt", name: "Shirt", imageData: png }] });

test("rendering requires a caller key even if a deployment key exists", () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = key;
  try {
    assert.throws(() => parseRenderInput({ ...request(), apiKey: undefined }), (error) => error instanceof RenderError && error.status === 401);
    assert.equal(getRenderStatus().requiresApiKey, true);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("render inputs reject URL images, disguised SVGs, duplicate pieces, and excess pieces", () => {
  assert.throws(() => parseRaster("https://example.com/photo.jpg"), /JPEG, PNG, or WebP/);
  assert.throws(() => parseRaster(`data:image/png;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64")}`), /could not be read/);
  assert.throws(() => parseRenderInput({ ...request(), items: [] }), /between 1 and 6/);
  assert.throws(() => parseRenderInput({ ...request(), items: Array(7).fill(request().items[0]) }), /between 1 and 6/);
  assert.throws(() => parseRenderInput({ ...request(), items: [request().items[0], request().items[0]] }), /unique ID/);
  assert.throws(() => parseRaster(`data:image/png;base64,${"A".repeat(Math.ceil(MAX_RENDER_IMAGE_BYTES / 3) * 4 + 40)}`), (error) => error instanceof RenderError && error.status === 413);
});

test("body limit applies to streamed requests without content-length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_RENDER_BODY_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readLimitedJson(stream, MAX_RENDER_BODY_BYTES), (error) => error instanceof RenderError && error.status === 413);
  assert.equal(cancelled, true);
});

test("the caller key is only sent to the fixed provider with person first and selected pieces", async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    assert.equal(options?.redirect, "error");
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${key}`);
    const form = options?.body as FormData;
    assert.equal(form.get("n"), "1");
    assert.equal(form.get("output_format"), "jpeg");
    assert.equal(form.get("input_fidelity"), "high");
    const images = form.getAll("image[]") as File[];
    assert.equal(images.length, 2);
    assert.equal(images[0].name, "1.png");
    assert.equal(images[1].name, "2.png");
    assert.ok(String(form.get("prompt")).includes("Output only the photograph"));
    assert.ok(!String(form.get("prompt")).includes("untrusted product instructions"));
    return Response.json({ data: [{ b64_json: jpeg.split(",")[1] }] });
  };
  const input = request();
  input.items[0].name = "untrusted product instructions";
  assert.deepEqual(await renderOutfit(parseRenderInput(input), fetcher), { imageData: jpeg });
});

test("provider errors are sanitized and invalid images are rejected", async () => {
  await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ error: { message: key } }, { status: 401 })), (error) => error instanceof RenderError && error.status === 401 && !error.message.includes(key));
  await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ data: [{ b64_json: Buffer.from("<svg>not an image</svg>").toString("base64") }] })), /usable image/);
});

test("provider limit codes distinguish credits, spend ceilings, and approved usage without exposing provider prose", async () => {
  for (const [code, expected] of [
    ["credit_balance_exhausted", /credit balance is exhausted/],
    ["organization_spend_limit_exceeded", /organization’s spending limit/],
    ["project_spend_limit_exceeded", /project’s spending limit/],
    ["billing_hard_limit_reached", /API spending limit/],
    ["organization_usage_limit_exceeded", /approved usage limit/],
    ["insufficient_quota", /API quota was reached/],
  ] as const) {
    await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ error: { code, type: "insufficient_quota", message: `Private provider detail ${key}` } }, { status: 429 })), (error) => {
      assert.ok(error instanceof RenderError);
      assert.equal(error.status, 429);
      assert.match(error.message, expected);
      assert.ok(!error.message.includes(key) && !error.message.includes("Private provider detail"));
      assert.ok(!error.message.includes("try again later"));
      return true;
    });
  }
});

test("a recognized specific code takes precedence over the generic provider error type", async () => {
  await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ error: { code: "project_spend_limit_exceeded", type: "insufficient_quota" } }, { status: 400 })), (error) => error instanceof RenderError && error.status === 429 && error.message.includes("project’s spending limit"));
  await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ error: { code: "slow_down", type: "insufficient_quota" } }, { status: 429 })), (error) => error instanceof RenderError && error.status === 429 && error.message.includes("temporary request limit"));
});

test("temporary rate-limit codes and types suggest waiting rather than adding credits", async () => {
  for (const error of [{ code: "rate_limit_exceeded", message: key }, { code: "slow_down" }, { code: null, type: "rate_limit_error" }]) {
    await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ error }, { status: 429 })), (cause) => cause instanceof RenderError && cause.status === 429 && cause.message.includes("Wait a little") && !cause.message.includes("credits") && !cause.message.includes(key));
  }
});

test("generic quota types remain actionable when the provider omits a specific code", async () => {
  for (const code of [undefined, null, "future_quota_code"]) {
    await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ error: { code, type: "insufficient_quota", message: key } }, { status: 429 })), (error) => error instanceof RenderError && error.status === 429 && error.message.includes("API quota was reached") && !error.message.includes(key));
  }
});

test("unknown or malformed 429 errors never infer a diagnosis from upstream messages", async () => {
  for (const body of [
    { error: { code: "future_limit", type: "unknown", message: `insufficient_quota rate_limit_error ${key}` } },
    { error: { code: key, type: { insufficient_quota: true } } },
    { error: { code: "constructor", type: "__proto__" } },
    { error: [] }, { error: null }, {}, [], null,
  ]) {
    await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json(body, { status: 429 })), (error) => error instanceof RenderError && error.status === 429 && error.message === "OpenAI returned a limit error. Check your API usage and billing, or try again later.");
  }
  await assert.rejects(renderOutfit(parseRenderInput(request()), async () => new Response(`<html>${key}</html>`, { status: 429 })), (error) => error instanceof RenderError && error.status === 429 && error.message.includes("returned a limit error") && !error.message.includes(key));
});

test("oversized provider errors are cancelled without replacing the original limit status", async () => {
  let cancelled = 0;
  for (const headers of [new Headers(), new Headers({ "content-length": "50000" })]) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("字".repeat(6_000))); },
      cancel() { cancelled++; },
    });
    await assert.rejects(renderOutfit(parseRenderInput(request()), async () => new Response(body, { status: 429, headers })), (error) => error instanceof RenderError && error.status === 429 && error.message.includes("returned a limit error"));
  }
  assert.equal(cancelled, 2);
});

test("unreadable provider errors and unrelated failures retain sanitized status handling", async () => {
  const failedBody = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(key)); } });
  await assert.rejects(renderOutfit(parseRenderInput(request()), async () => new Response(failedBody, { status: 429 })), (error) => error instanceof RenderError && error.status === 429 && !error.message.includes(key));
  for (const status of [401, 403, 400, 500]) {
    await assert.rejects(renderOutfit(parseRenderInput(request()), async () => Response.json({ error: { code: "invalid_request_error", message: key } }, { status })), (error) => error instanceof RenderError && error.status === (status === 401 || status === 403 ? 401 : 502) && !error.message.includes(key));
  }
  await assert.rejects(renderOutfit(parseRenderInput(request()), async () => { throw new Error(key); }), (error) => error instanceof RenderError && error.status === 502 && !error.message.includes(key));
});

test("a key cannot start overlapping renders", () => {
  const finish = beginRender("sk-concurrency-test");
  try {
    assert.throws(() => beginRender("sk-concurrency-test"), (error) => error instanceof RenderError && error.status === 429);
  } finally { finish(); }
});
