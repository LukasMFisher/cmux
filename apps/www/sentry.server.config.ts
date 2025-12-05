// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { honoIntegration } from "@sentry/node";
import { SENTRY_RELEASE } from "@/lib/sentry-release";

Sentry.init({
  dsn: "https://96214f39aa409867381a22a79ff3e6a4@o4507547940749312.ingest.us.sentry.io/4510308518854656",
  release: SENTRY_RELEASE,

  integrations: [honoIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  beforeSendTransaction(event) {
    const name = event.transaction;
    if (!name) {
      return event;
    }
    const isCatchAllApi =
      name.includes("/api/[[...route]]") || name.endsWith(" /api/[[...route]]");
    if (!isCatchAllApi) {
      return event;
    }
    const url = event.request?.url;
    if (!url) {
      return event;
    }
    try {
      const { pathname } = new URL(url);
      const methodFromName = name.split(" ")[0] || "UNKNOWN";
      const method = methodFromName.toUpperCase();
      event.transaction = `${method} ${pathname}`;
    } catch {
      // If URL parsing fails for some reason, keep the original transaction name.
    }
    return event;
  },
});
