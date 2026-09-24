import { getPool } from "./db";
import { createModelPhotoHandler } from "./model-photo-api";
import { integrationFailure } from "./integration-tokens";
export async function modelPhotoRequest(request: Request, native: boolean) {
  try { return await createModelPhotoHandler(getPool(), native)(request); }
  catch (error) { return integrationFailure(error); }
}
