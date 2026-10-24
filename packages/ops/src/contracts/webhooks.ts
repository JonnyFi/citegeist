import { JobId, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Webhooks for external agents (W4.6, decision D8). A connector is one external agent such as the
// Grok bot. It signs requests to /hooks/<name> with HMAC-SHA256 (inbound) and citegeist signs
// research tasks to the connector's URL the same way (outbound). Secrets live in the Keychain
// and are shown once, when they are created or rotated.

/** Lowercase name of a connector. It is the path segment of /hooks/<name> and the agent actor. */
export const WebhookName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and hyphens, at most 40");
export const WebhookKind = z.enum(["inbound", "outbound", "both"]);
export type WebhookKind = z.infer<typeof WebhookKind>;

export const WebhookInfo = z.object({
  name: WebhookName,
  kind: WebhookKind,
  /** Where citegeist sends tasks and pings. Present for outbound and both. */
  url: z.string().optional(),
  /** Address the external agent posts to: public base URL (or the local one) plus /hooks/<name>. */
  inboundUrl: z.string(),
  /** The actor that everything this connector writes carries. */
  actor: z.string(),
  hasSecret: z.boolean(),
  /** The previous secret still works until this time, after a rotation. */
  previousSecretUntil: z.string().optional(),
  createdAt: z.string(),
});
export type WebhookInfo = z.infer<typeof WebhookInfo>;

export const webhooksList = defineContract({
  name: "webhooks.list",
  summary: "Configured webhook connectors with their addresses (never their secrets)",
  access: "read",
  input: z.object({}),
  output: z.object({
    /** The configured public base URL (tunnel address). Absent until one is set. */
    publicBaseUrl: z.string().optional(),
    webhooks: z.array(WebhookInfo),
  }),
});
export const webhooksCreate = defineContract({
  name: "webhooks.create",
  summary:
    "Create a webhook connector and its secret. The secret is returned once and kept in the Keychain",
  access: "admin",
  input: z
    .object({
      name: WebhookName,
      kind: WebhookKind.default("inbound"),
      /** Address of the external agent. Required for outbound and both. */
      url: z.url().optional(),
    })
    .refine((v) => v.kind === "inbound" || v.url !== undefined, {
      message: "an outbound connector needs a url",
      path: ["url"],
    }),
  output: z.object({ webhook: WebhookInfo, secret: z.string() }),
});
export const webhooksRotateSecret = defineContract({
  name: "webhooks.rotateSecret",
  summary:
    "Issue a new secret. The old one keeps working for the grace period so the agent can switch over",
  access: "admin",
  input: z.object({
    name: WebhookName,
    /** Minutes the previous secret stays valid. 0 revokes it at once. */
    graceMinutes: z.number().int().min(0).max(1440).default(60),
  }),
  output: z.object({ webhook: WebhookInfo, secret: z.string() }),
});
export const webhooksDelete = defineContract({
  name: "webhooks.delete",
  summary: "Delete a connector and its secrets",
  access: "admin",
  input: z.object({ name: WebhookName }),
  output: z.object({ ok: z.literal(true) }),
});
export const webhooksTest = defineContract({
  name: "webhooks.test",
  summary:
    "Send a signed ping to the connector's URL and report the answer; without a URL, check signing against the local receiver",
  access: "admin",
  input: z.object({ name: WebhookName }),
  output: z.object({
    ok: z.boolean(),
    mode: z.enum(["remote", "local"]),
    status: z.number().int().optional(),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  }),
});
export const webhooksSend = defineContract({
  name: "webhooks.send",
  summary:
    "Send a research task (prompt, project brief excerpt, callback URL) to an outbound connector; its callback is tied to the returned job",
  access: "write",
  input: z.object({
    name: WebhookName,
    prompt: z.string().min(1),
    project: ProjectSlug.optional(),
    /** Longest brief excerpt to send, in characters. */
    briefChars: z.number().int().min(0).max(8000).default(2000),
  }),
  output: z.object({ job: JobId }),
});

export const WEBHOOK_CONTRACTS: readonly OperationContract[] = [
  webhooksList,
  webhooksCreate,
  webhooksRotateSecret,
  webhooksDelete,
  webhooksTest,
  webhooksSend,
];
