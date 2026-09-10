import posthog from "posthog-js";
import { analyticsInitOptions, attachAnalytics, readAnalyticsConfig, trackPageview } from "@/lib/analytics";

// Runs before the app becomes interactive. Analytics stays entirely off unless
// a project key is configured, so local development and self-hosted copies of
// Capsule send nothing.
const config = readAnalyticsConfig({
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});

if (config) {
  try {
    posthog.init(config.key, analyticsInitOptions(config.host));
    attachAnalytics(posthog);
    trackPageview(window.location.href);
  } catch { /* A failed analytics init must never block the app. */ }
}

export function onRouterTransitionStart(url: string) {
  try {
    trackPageview(url);
  } catch { /* Navigation must not depend on analytics. */ }
}
