import { parseAsString, parseAsStringLiteral } from "nuqs/server";

export const CAPSULE_VIEWS = ["wardrobe", "wishlist", "add", "outfits"] as const;
export type CapsuleView = (typeof CAPSULE_VIEWS)[number];
export const ADD_DESTINATIONS = ["wardrobe", "wishlist"] as const;
export type AddDestination = (typeof ADD_DESTINATIONS)[number];

export const navigationParsers = {
  view: parseAsStringLiteral(CAPSULE_VIEWS).withDefault("wardrobe"),
  to: parseAsStringLiteral(ADD_DESTINATIONS).withDefault("wardrobe"),
  import: parseAsString,
};

export const navigationOptions = { history: "push", shallow: true, scroll: false, clearOnDefault: true } as const;

/** Navigation and Add's destination travel together in a single history entry. */
export function navigationQuery(view: CapsuleView, destination: AddDestination = "wardrobe") {
  return { view, to: view === "add" ? destination : null, import: null };
}
