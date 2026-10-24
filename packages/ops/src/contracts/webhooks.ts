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

/** Port of the dedicated hooks listener unless the user picks another one. */
export const DEFAULT_HOOKS_PORT = 47321;
export const HooksPort = z.number().int().min(1024).max(65535);

/** Headers citegeist sets itself or the transport needs; an outbound auth header may not use them. */
const RESERVED_HEADERS = new Set([
  "content-type",
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
  "user-agent",
]);

/** Name of the header that carries the agent's own key, such as Authorization or x-api-key. */
export const WebhookAuthHeaderName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/, "letters, digits and hyphens, at most 64")
  .refine(
    (v) => !RESERVED_HEADERS.has(v.toLowerCase()) && !v.toLowerCase().startsWith("x-citegeist-"),
    { message: "this header is set by citegeist itself" },
  );
/** Value of that header, for example `Bearer abc` or a bare key. A single line without control characters. */
export const WebhookAuthValue = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[\x20-\x7e]+$/, "printable ASCII on a single line");

/** State of the listener that serves only /hooks/ on a fixed port. */
export const HooksListenerStatus = z.object({
  /** off: no connector exists, so nothing listens. */
  state: z.enum(["off", "listening", "error"]),
  port: z.number().int().optional(),
  /** HOOKS_PORT_IN_USE or HOOKS_LISTEN_FAILED when state is error. */
  code: z.string().optional(),
  detail: z.string().optional(),
  fix: z.string().optional(),
});
export type HooksListenerStatus = z.infer<typeof HooksListenerStatus>;

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
  /** Name of the header citegeist adds to its outbound requests (the value stays in the Keychain). */
  authHeader: z.string().optional(),
  hasAuthValue: z.boolean().default(false),
  /** True when the connector also accepts a bearer token instead of the HMAC signature. */
  hasInboundToken: z.boolean().default(false),
  /** Present when the agent may use citegeist's MCP server at /mcp with its own token. */
  mcpScope: z.enum(["read", "write"]).optional(),
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
    /** The resolved public base URL (tunnel address). Absent until one is set. */
    publicBaseUrl: z.string().optional(),
    /** Where it comes from: the CITEGEIST_PUBLIC_URL variable wins over the setting. */
    publicBaseUrlSource: z.enum(["env", "settings"]).optional(),
    /** The dedicated listener the tunnel points at. */
    listener: HooksListenerStatus.default({ state: "off" }),
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
      /** Header with the agent's own key, sent with every outbound request. Needs `authValue`. */
      authHeader: WebhookAuthHeaderName.optional(),
      authValue: WebhookAuthValue.optional(),
      /** Also accept a bearer token for inbound requests. The token is returned once. */
      inboundToken: z.boolean().default(false),
      /** MCP access of the agent at /mcp on the hooks port. Its token is returned once. */
      mcp: z.enum(["read", "write"]).optional(),
    })
    .refine((v) => v.kind === "inbound" || v.url !== undefined, {
      message: "an outbound connector needs a url",
      path: ["url"],
    })
    .refine((v) => (v.authHeader === undefined) === (v.authValue === undefined), {
      message: "authHeader and authValue go together",
      path: ["authValue"],
    }),
  secretInputs: ["authValue"],
  output: z.object({
    webhook: WebhookInfo,
    secret: z.string(),
    inboundToken: z.string().optional(),
    mcpToken: z.string().optional(),
  }),
});
export const webhooksSetAuth = defineContract({
  name: "webhooks.setAuth",
  summary:
    "Set or remove the header with the agent's own key that outbound requests carry (the value goes to the Keychain)",
  access: "admin",
  input: z
    .object({
      name: WebhookName,
      /** Leave out authHeader and authValue to remove the header. */
      authHeader: WebhookAuthHeaderName.optional(),
      authValue: WebhookAuthValue.optional(),
    })
    .refine((v) => (v.authHeader === undefined) === (v.authValue === undefined), {
      message: "authHeader and authValue go together",
      path: ["authValue"],
    }),
  secretInputs: ["authValue"],
  output: z.object({ webhook: WebhookInfo }),
});
export const webhooksSetInboundToken = defineContract({
  name: "webhooks.setInboundToken",
  summary:
    "Turn the inbound bearer token of a connector on (a new token, returned once) or off. The token is an alternative to the HMAC signature for agents that cannot compute one",
  access: "admin",
  input: z.object({ name: WebhookName, enabled: z.boolean() }),
  output: z.object({ webhook: WebhookInfo, token: z.string().optional() }),
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

export const webhooksSetMcpAccess = defineContract({
  name: "webhooks.setMcpAccess",
  summary:
    "Give a connector access to citegeist's MCP server at /mcp on the hooks port (a new bearer token, returned once) or take it away. The agent acts as agent:<name>, with the tools of a local MCP agent and never an admin one",
  access: "admin",
  input: z.object({
    name: WebhookName,
    enabled: z.boolean(),
    /** read lists only the read-only tools. Default write, like a local MCP client. */
    scope: z.enum(["read", "write"]).default("write"),
  }),
  output: z.object({ webhook: WebhookInfo, token: z.string().optional() }),
});

export const WEBHOOK_CONTRACTS: readonly OperationContract[] = [
  webhooksList,
  webhooksCreate,
  webhooksRotateSecret,
  webhooksSetAuth,
  webhooksSetInboundToken,
  webhooksSetMcpAccess,
  webhooksDelete,
  webhooksTest,
  webhooksSend,
];
