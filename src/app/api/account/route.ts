import { createAccountDeleteHandler } from "@/lib/server/account-api";
export const runtime = "nodejs";
export const maxDuration = 30;
export const DELETE = createAccountDeleteHandler();
