import { z } from "zod";
import { CATEGORIES } from "./types";
import { productLinkKey } from "./piece-identity";
import { wishlistPriceNumber } from "./wishlist";
import { MAX_ITEM_IMAGE_CHARS } from "./image-limits";

const link = z.string().max(8000).refine(value => value === "" || productLinkKey(value) !== null, "Use an HTTP or HTTPS URL without credentials.");
const price = z.string().max(100).refine(value => value === "" || wishlistPriceNumber(value) !== null);
const currency = z.string().regex(/^(?:[A-Z]{3})?$/);
export const integrationFieldsSchema = z.object({
  url: link.optional(), name: z.string().trim().min(1).max(500).optional(),
  brand: z.string().max(300).optional(), description: z.string().max(20000).optional(),
  size: z.string().max(100).optional(), color: z.string().max(200).optional(),
  category: z.enum(CATEGORIES).optional(), price: price.optional(), currency: currency.optional(),
  imageUrl: link.optional(), backImageUrl: link.optional(), sideImageUrl: link.optional(),
  imageData: z.string().max(MAX_ITEM_IMAGE_CHARS).optional(), backImageData: z.string().max(MAX_ITEM_IMAGE_CHARS).optional(), sideImageData: z.string().max(MAX_ITEM_IMAGE_CHARS).optional(),
}).strict();
export const integrationCreateSchema = integrationFieldsSchema.extend({fetch: z.boolean().default(true)}).refine(value => value.url || value.name, "Provide a product URL or item name.")
  .refine(value => (value.fetch && value.url) || value.name, "A name is required when page fetching is disabled.");
export const integrationUpdateSchema = integrationFieldsSchema.extend({expectedRevision:z.number().int().positive().safe()}).refine(value => Object.keys(value).length > 1, "Provide a field to update.");
export const integrationPurchaseSchema = z.object({size: z.string().max(100).optional(), color: z.string().max(200).optional(), price: price.optional(), currency: currency.optional(), expectedRevision: z.number().int().nonnegative().optional()}).strict();
