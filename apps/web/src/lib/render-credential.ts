export type RenderCredential = { type: "session"; apiKey: string } | { type: "saved"; userId: string };

export function renderCredentialPayload(credential: RenderCredential | null, space: string) {
  if (space === "guest" && credential?.type === "session" && credential.apiKey.trim()) return { apiKey: credential.apiKey.trim() };
  if (credential?.type === "saved" && space === `account:${credential.userId}`) return { useSavedKey: true, expectedUserId: credential.userId };
  throw new Error(space === "guest" ? "Enter an OpenAI API key for this session." : "Save an OpenAI API key in your account before rendering.");
}
