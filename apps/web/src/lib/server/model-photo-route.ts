import { getPool } from "./db";
import { createModelPhotoHandler, modelPhotoFailure } from "./model-photo-api";
export async function modelPhotoRequest(request: Request, native: boolean) {
  try { return await createModelPhotoHandler(getPool(), native)(request); }
  catch (error) { return modelPhotoFailure(error); }
}
