import { GmailProvider } from "./gmail";
import { OutlookProvider } from "./outlook";
import { ZohoProvider } from "./zoho";
import type { MailProviderAdapter, Provider } from "./types";

export * from "./types";

/** Factory: build the adapter for a given provider. */
export function createProvider(provider: Provider): MailProviderAdapter {
  switch (provider) {
    case "gmail":
      return new GmailProvider();
    case "outlook":
      return new OutlookProvider();
    case "zoho":
      return new ZohoProvider();
    default:
      throw new Error(`Unknown provider: ${provider satisfies never}`);
  }
}
