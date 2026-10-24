import { randomUUID } from "node:crypto";
import type { HooksListenerStatus, Registry, WebhookInfo, WebhookKind } from "@citegeist/ops";
import { type Actor, CitegeistError, Citekey } from "@citegeist/schema";
import {
  InboundPayload,
  type NoteAddPayload,
  type PaperRef,
  type PapersAddPayload,
  type SourceRef,
  type TaskRequestPayload,
  type TaskResultPayload,
} from "./payload.js";
import { assertRemoteSafe } from "./remote-input.js";
import {
  bearerToken,
  generateInboundToken,
  generateMcpToken,
  generateSecret,
  ID_HEADER,
  ReplayGuard,
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
  tokensEqual,
  verifyRequest,
} from "./sign.js";
import {
  authValueAccount,
  type ConnectorRecord,
  type ConnectorStore,
  inboundTokenAccount,
  mcpTokenAccount,
  previousSecretAccount,
  type SecretStore,
  secretAccount,
} from "./store.js";
import type { TaskTracker } from "./tasks.js";

/** What the HTTP layer hands over: the request as received, body untouched. */
export interface InboundRequest {
  method: string;
  /** Path without query string, e.g. /hooks/grok. */
  path: string;
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
}
export interface InboundResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface WebhookServiceOptions {
  store: ConnectorStore;
  secrets: SecretStore;
  registry: Pick<Registry, "call">;
  tasks: TaskTracker;
  /** Public address of this Mac (tunnel). Absent until the user sets one up. */
  publicBaseUrl: () => string | undefined;
  /** Where the public address comes from, for the settings screen. */
  publicBaseUrlSource?: () => "env" | "settings" | undefined;
  /** State of the dedicated hooks listener, reported by `list`. */
  listenerStatus?: () => HooksListenerStatus;
  /** Called after a connector was created or deleted, so the listener can start or stop. */
  onConnectorsChanged?: () => void;
  /** Address on this Mac, such as http://127.0.0.1:41234. Used when no public address is set. */
  localBaseUrl: () => string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
  /** Longest wait for the connector to answer an outbound request. Default 15 seconds. */
  timeoutMs?: number;
  /**
   * Waits between delivery attempts of a task. A response without 2xx counts as a failure, and a
   * routine that is switched off does not queue the request, so the delivery is tried again.
   * Default 1 and 5 seconds, which makes three attempts.
   */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

/** Statuses where trying again cannot help: the key is wrong, or the address does not exist. */
const NO_RETRY_STATUS = new Set([401, 403, 404, 405, 410]);

class DeliveryRefused extends Error {
  constructor(readonly status: number) {
    super(`the connector answered with HTTP ${status}`);
  }
}

export const HOOKS_PREFIX = "/hooks/";
const NAME_FROM_PATH = /^\/hooks\/([a-z0-9][a-z0-9-]{0,39})\/?$/;
const MAX_ITEMS = 50;

export const connectorActor = (name: string): Actor => `agent:${name}`;

function error(code: string, message: string, fix: string): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery: "fix-and-retry" });
}

interface PaperResult {
  input: string;
  ok: boolean;
  citekey?: string;
  duplicateOf?: string;
  job?: string;
  error?: { code: string; message: string };
}

function describeError(err: unknown): { code: string; message: string } {
  if (err instanceof CitegeistError) return { code: err.detail.code, message: err.detail.message };
  return { code: "WEBHOOK_ITEM_FAILED", message: err instanceof Error ? err.message : String(err) };
}

/** The `id` field of a JSON body, for requests that carry no id header. */
function idFromBody(raw: Buffer): string | undefined {
  try {
    const id = (JSON.parse(raw.toString("utf8")) as { id?: unknown } | null)?.id;
    return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : undefined;
  } catch {
    return undefined;
  }
}

const excerpt = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export class WebhookService {
  private readonly replay = new ReplayGuard();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(private readonly opts: WebhookServiceOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? (() => {});
  }

  // Management ---------------------------------------------------------------------------------

  private baseUrl(): string {
    const base = this.opts.publicBaseUrl() ?? this.opts.localBaseUrl() ?? "http://127.0.0.1";
    return base.replace(/\/+$/, "");
  }

  private async info(record: ConnectorRecord): Promise<WebhookInfo> {
    const previousValid =
      record.previousSecretUntil !== undefined &&
      Date.parse(record.previousSecretUntil) > this.now().getTime();
    return {
      name: record.name,
      kind: record.kind,
      ...(record.url ? { url: record.url } : {}),
      inboundUrl: `${this.baseUrl()}${HOOKS_PREFIX}${record.name}`,
      actor: connectorActor(record.name),
      hasSecret: await this.opts.secrets.has(secretAccount(record.name)),
      ...(record.authHeader ? { authHeader: record.authHeader } : {}),
      hasAuthValue: await this.opts.secrets.has(authValueAccount(record.name)),
      hasInboundToken: await this.opts.secrets.has(inboundTokenAccount(record.name)),
      ...(record.mcpScope ? { mcpScope: record.mcpScope } : {}),
      ...(previousValid && record.previousSecretUntil
        ? { previousSecretUntil: record.previousSecretUntil }
        : {}),
      createdAt: record.createdAt,
    };
  }

  private require(name: string): ConnectorRecord {
    const record = this.opts.store.get(name);
    if (!record) {
      throw error(
        "WEBHOOK_NOT_FOUND",
        `no webhook connector named '${name}'`,
        "Call webhooks.list to see the configured connectors, or create one with webhooks.create.",
      );
    }
    return record;
  }

  async list(): Promise<{
    publicBaseUrl?: string;
    publicBaseUrlSource?: "env" | "settings";
    listener: HooksListenerStatus;
    webhooks: WebhookInfo[];
  }> {
    const publicBaseUrl = this.opts.publicBaseUrl();
    const source = publicBaseUrl ? this.opts.publicBaseUrlSource?.() : undefined;
    return {
      ...(publicBaseUrl ? { publicBaseUrl: publicBaseUrl.replace(/\/+$/, "") } : {}),
      ...(source ? { publicBaseUrlSource: source } : {}),
      listener: this.opts.listenerStatus?.() ?? { state: "off" },
      webhooks: await Promise.all(this.opts.store.list().map((r) => this.info(r))),
    };
  }

  async create(input: {
    name: string;
    kind: WebhookKind;
    url?: string | undefined;
    authHeader?: string | undefined;
    authValue?: string | undefined;
    inboundToken?: boolean | undefined;
    mcp?: "read" | "write" | undefined;
  }): Promise<{ webhook: WebhookInfo; secret: string; inboundToken?: string; mcpToken?: string }> {
    if (this.opts.store.get(input.name)) {
      throw error(
        "WEBHOOK_EXISTS",
        `a connector named '${input.name}' already exists`,
        "Pick another name, or delete the old connector first.",
      );
    }
    if (input.kind !== "inbound" && !input.url) {
      throw error("WEBHOOK_URL_REQUIRED", "an outbound connector needs a url", "Pass `url`.");
    }
    if (input.authHeader !== undefined && input.kind === "inbound") {
      throw error(
        "WEBHOOK_AUTH_NOT_OUTBOUND",
        "an inbound connector sends nothing, so it has no outbound auth header",
        "Use kind outbound or both, or leave out the auth header.",
      );
    }
    const secret = generateSecret();
    await this.opts.secrets.set(secretAccount(input.name), secret);
    const record: ConnectorRecord = {
      name: input.name,
      kind: input.kind,
      ...(input.url ? { url: input.url } : {}),
      ...(input.authHeader && input.authValue ? { authHeader: input.authHeader } : {}),
      ...(input.mcp ? { mcpScope: input.mcp } : {}),
      createdAt: this.now().toISOString(),
    };
    if (input.authHeader && input.authValue) {
      await this.opts.secrets.set(authValueAccount(input.name), input.authValue);
    }
    let inboundToken: string | undefined;
    if (input.inboundToken) {
      inboundToken = generateInboundToken();
      await this.opts.secrets.set(inboundTokenAccount(input.name), inboundToken);
    }
    let mcpToken: string | undefined;
    if (input.mcp) {
      mcpToken = generateMcpToken();
      await this.opts.secrets.set(mcpTokenAccount(input.name), mcpToken);
    }
    this.opts.store.put(record);
    this.opts.onConnectorsChanged?.();
    return {
      webhook: await this.info(record),
      secret,
      ...(inboundToken ? { inboundToken } : {}),
      ...(mcpToken ? { mcpToken } : {}),
    };
  }

  async setMcpAccess(input: {
    name: string;
    enabled: boolean;
    scope: "read" | "write";
  }): Promise<{ webhook: WebhookInfo; token?: string }> {
    const record = this.require(input.name);
    const next: ConnectorRecord = { ...record };
    let token: string | undefined;
    if (input.enabled) {
      token = generateMcpToken();
      await this.opts.secrets.set(mcpTokenAccount(record.name), token);
      next.mcpScope = input.scope;
    } else {
      await this.opts.secrets.delete(mcpTokenAccount(record.name));
      delete next.mcpScope;
    }
    this.opts.store.put(next);
    this.opts.onConnectorsChanged?.();
    return { webhook: await this.info(next), ...(token ? { token } : {}) };
  }

  /** True while at least one connector exists, which is when the hooks listener runs. */
  hasConnectors(): boolean {
    return this.opts.store.list().length > 0;
  }

  /** True while at least one connector may use the MCP endpoint. */
  hasMcpAccess(): boolean {
    return this.opts.store.list().some((r) => r.mcpScope !== undefined);
  }

  /**
   * Checks the bearer token of an MCP request against every connector with MCP access. Compares
   * with all of them, so the time does not show which one matched. Returns the connector's actor
   * and scope, or undefined.
   */
  async authenticateMcp(
    authorization: string | undefined,
  ): Promise<{ actor: Actor; scope: "read" | "write"; name: string } | undefined> {
    const presented = bearerToken(authorization);
    if (presented === undefined) return undefined;
    let found: { actor: Actor; scope: "read" | "write"; name: string } | undefined;
    for (const record of this.opts.store.list()) {
      if (!record.mcpScope) continue;
      const token = await this.opts.secrets.get(mcpTokenAccount(record.name));
      if (token && tokensEqual(presented, token) && !found) {
        found = { actor: connectorActor(record.name), scope: record.mcpScope, name: record.name };
      }
    }
    return found;
  }

  async setAuth(input: {
    name: string;
    authHeader?: string | undefined;
    authValue?: string | undefined;
  }): Promise<{ webhook: WebhookInfo }> {
    const record = this.require(input.name);
    const next: ConnectorRecord = { ...record };
    if (input.authHeader && input.authValue) {
      if (record.kind === "inbound") {
        throw error(
          "WEBHOOK_AUTH_NOT_OUTBOUND",
          `connector '${record.name}' is inbound only, so it sends nothing`,
          "Auth headers belong to outbound or both connectors.",
        );
      }
      await this.opts.secrets.set(authValueAccount(record.name), input.authValue);
      next.authHeader = input.authHeader;
    } else {
      await this.opts.secrets.delete(authValueAccount(record.name));
      delete next.authHeader;
    }
    this.opts.store.put(next);
    return { webhook: await this.info(next) };
  }

  async setInboundToken(input: {
    name: string;
    enabled: boolean;
  }): Promise<{ webhook: WebhookInfo; token?: string }> {
    const record = this.require(input.name);
    if (!input.enabled) {
      await this.opts.secrets.delete(inboundTokenAccount(record.name));
      return { webhook: await this.info(record) };
    }
    const token = generateInboundToken();
    await this.opts.secrets.set(inboundTokenAccount(record.name), token);
    return { webhook: await this.info(record), token };
  }

  async rotateSecret(input: {
    name: string;
    graceMinutes: number;
  }): Promise<{ webhook: WebhookInfo; secret: string }> {
    const record = this.require(input.name);
    const old = await this.opts.secrets.get(secretAccount(record.name));
    const secret = generateSecret();
    await this.opts.secrets.set(secretAccount(record.name), secret);
    const next: ConnectorRecord = { ...record };
    delete next.previousSecretUntil;
    if (old && input.graceMinutes > 0) {
      await this.opts.secrets.set(previousSecretAccount(record.name), old);
      next.previousSecretUntil = new Date(
        this.now().getTime() + input.graceMinutes * 60_000,
      ).toISOString();
    } else {
      await this.opts.secrets.delete(previousSecretAccount(record.name));
    }
    this.opts.store.put(next);
    return { webhook: await this.info(next), secret };
  }

  async delete(name: string): Promise<{ ok: true }> {
    this.require(name);
    await this.opts.secrets.delete(secretAccount(name));
    await this.opts.secrets.delete(previousSecretAccount(name));
    await this.opts.secrets.delete(authValueAccount(name));
    await this.opts.secrets.delete(inboundTokenAccount(name));
    await this.opts.secrets.delete(mcpTokenAccount(name));
    this.opts.store.remove(name);
    this.opts.onConnectorsChanged?.();
    return { ok: true };
  }

  // Outbound -----------------------------------------------------------------------------------

  private async postSigned(
    record: ConnectorRecord,
    payload: unknown,
  ): Promise<{ status: number; latencyMs: number }> {
    const secret = await this.opts.secrets.get(secretAccount(record.name));
    if (!secret || !record.url) {
      throw error(
        "WEBHOOK_NOT_CONFIGURED",
        `connector '${record.name}' has no secret or no url`,
        "Recreate the connector with an outbound url.",
      );
    }
    const body = JSON.stringify(payload);
    const headers = signRequest(secret, body, { now: this.now() });
    // The agent's own key, for platforms whose trigger checks a header and cannot verify our HMAC.
    const authValue = record.authHeader
      ? await this.opts.secrets.get(authValueAccount(record.name))
      : undefined;
    const started = Date.now();
    const res = await this.fetchFn(record.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "citegeist-webhooks",
        ...(record.authHeader && authValue ? { [record.authHeader]: authValue } : {}),
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    });
    await res.body?.cancel().catch(() => {});
    return { status: res.status, latencyMs: Date.now() - started };
  }

  async test(name: string): Promise<{
    ok: boolean;
    mode: "remote" | "local";
    status?: number;
    latencyMs?: number;
    error?: string;
  }> {
    const record = this.require(name);
    const payload = { event: "ping", at: this.now().toISOString(), connector: name };
    if (record.url && record.kind !== "inbound") {
      try {
        const { status, latencyMs } = await this.postSigned(record, payload);
        const ok = status >= 200 && status < 300;
        return {
          mode: "remote",
          ok,
          status,
          latencyMs,
          ...(ok ? {} : { error: `the connector answered with HTTP ${status}` }),
        };
      } catch (err) {
        return {
          mode: "remote",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    // Inbound only: sign a ping with the stored secret and run it through our own receiver.
    const secret = await this.opts.secrets.get(secretAccount(name));
    if (!secret)
      return { mode: "local", ok: false, error: "the secret is missing from the Keychain" };
    const body = JSON.stringify(payload);
    const headers = signRequest(secret, body, { now: this.now() });
    const res = await this.handleInbound({
      method: "POST",
      path: `${HOOKS_PREFIX}${name}`,
      headers,
      rawBody: Buffer.from(body),
    });
    const ok = res?.status === 200;
    return {
      mode: "local",
      ok,
      ...(res ? { status: res.status } : {}),
      ...(ok ? {} : { error: "the local receiver refused the signed ping" }),
    };
  }

  async send(
    actor: Actor,
    input: { name: string; prompt: string; project?: string | undefined; briefChars: number },
  ): Promise<{ job: string }> {
    const record = this.require(input.name);
    if (record.kind === "inbound" || !record.url) {
      throw error(
        "WEBHOOK_NOT_OUTBOUND",
        `connector '${record.name}' cannot receive tasks`,
        "Create a connector of kind outbound or both with a url.",
      );
    }
    let project: TaskRequestPayload["project"];
    if (input.project) {
      const got = (await this.opts.registry.call(
        "projects.get",
        { actor },
        { slug: input.project },
      )) as { frontmatter: { title: string }; brief: string };
      project = {
        slug: input.project,
        title: got.frontmatter.title,
        briefExcerpt: input.briefChars > 0 ? excerpt(got.brief, input.briefChars) : "",
      };
    }
    const task = this.opts.tasks.create({
      connector: record.name,
      prompt: input.prompt,
      ...(input.project ? { project: input.project } : {}),
      by: actor,
    });
    const payload: TaskRequestPayload = {
      event: "task.request",
      task,
      prompt: input.prompt,
      ...(project ? { project } : {}),
      callback: { url: `${this.baseUrl()}${HOOKS_PREFIX}${record.name}`, event: "task.result" },
    };
    const delays = this.opts.retryDelaysMs ?? [1000, 5000];
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let attempt = 0;
    for (;;) {
      try {
        const { status } = await this.postSigned(record, payload);
        if (status < 200 || status >= 300) throw new DeliveryRefused(status);
        return { job: task };
      } catch (err) {
        const delay = delays[attempt];
        const hopeless = err instanceof DeliveryRefused && NO_RETRY_STATUS.has(err.status);
        if (delay !== undefined && !hopeless) {
          attempt += 1;
          this.log(`webhook ${record.name}: delivery failed, trying again in ${delay} ms`);
          await sleep(delay);
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        const tries = attempt > 0 ? ` after ${attempt + 1} attempts` : "";
        this.opts.tasks.fail(task, `delivery failed${tries}: ${message}`);
        throw error(
          "WEBHOOK_DELIVERY_FAILED",
          `could not deliver the task to '${record.name}'${tries}: ${message}`,
          err instanceof DeliveryRefused && err.status === 401
            ? "The agent refused the key. Check the auth header and its value with webhooks.setAuth."
            : "Run webhooks.test for this connector and check its url and auth header. A switched-off routine does not accept requests.",
        );
      }
    }
  }

  // Inbound ------------------------------------------------------------------------------------

  /**
   * Checks one request to /hooks/<name> and runs what it asks for. Returns undefined when the
   * path is not a webhook path at all. Failed authentication answers 401 without saying whether
   * the connector exists.
   */
  async handleInbound(req: InboundRequest): Promise<InboundResponse | undefined> {
    if (!req.path.startsWith(HOOKS_PREFIX)) return undefined;
    const match = NAME_FROM_PATH.exec(req.path);
    if (!match?.[1]) return { status: 404, body: { error: "not found" } };
    const name = match[1];
    if (req.method !== "POST") return { status: 405, body: { error: "use POST" } };

    const deny = (reason: string): InboundResponse => {
      this.log(`webhook ${name}: refused (${reason})`);
      return { status: 401, body: { error: "unauthorized", reason } };
    };

    const record = this.opts.store.get(name);
    let deliveryId: string;
    const presentedToken = bearerToken(req.headers.authorization);
    if (req.headers[SIGNATURE_HEADER] === undefined && presentedToken !== undefined) {
      // Alternative for agents that cannot compute an HMAC: a bearer token the user turned on for
      // this connector. An unknown connector or one without a token fails the same way.
      const expected = record ? await this.opts.secrets.get(inboundTokenAccount(name)) : undefined;
      const same = tokensEqual(presentedToken, expected ?? randomUUID());
      if (!record || !expected || !same) return deny("bad-token");
      const id = req.headers[ID_HEADER]?.trim() || idFromBody(req.rawBody);
      if (!id) {
        return {
          status: 400,
          body: {
            error: "missing id",
            reason: `a request with a bearer token needs a unique id: the ${ID_HEADER} header or an "id" field in the body`,
          },
        };
      }
      deliveryId = id;
    } else {
      const secrets: string[] = [];
      if (record) {
        const current = await this.opts.secrets.get(secretAccount(name));
        if (current) secrets.push(current);
        if (
          record.previousSecretUntil &&
          Date.parse(record.previousSecretUntil) > this.now().getTime()
        ) {
          const previous = await this.opts.secrets.get(previousSecretAccount(name));
          if (previous) secrets.push(previous);
        }
      }
      // An unknown connector runs the same checks against no secret, so it looks like a bad signature.
      const verdict = verifyRequest({
        id: req.headers[ID_HEADER],
        timestamp: req.headers[TIMESTAMP_HEADER],
        signature: req.headers[SIGNATURE_HEADER],
        rawBody: req.rawBody,
        secrets,
        now: this.now(),
      });
      if (!record || !verdict.ok) return deny(verdict.ok ? "bad-signature" : verdict.reason);
      deliveryId = verdict.id;
    }
    if (!this.replay.claim(`${name}:${deliveryId}`, this.now().getTime())) {
      this.log(`webhook ${name}: refused (replayed id)`);
      return {
        status: 409,
        body: { error: "replayed", reason: "this delivery id was already used" },
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(req.rawBody.toString("utf8"));
    } catch {
      return { status: 400, body: { error: "body is not valid JSON" } };
    }
    const parsed = InboundPayload.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
      return { status: 400, body: { error: "invalid payload", issues } };
    }
    const payload = parsed.data;
    const actor = connectorActor(name);

    if (payload.event === "ping") {
      return { status: 200, body: { ok: true, pong: true, connector: name } };
    }
    const canReceive = record.kind === "inbound" || record.kind === "both";
    const canCallBack = record.kind === "outbound" || record.kind === "both";
    if (payload.event === "task.result") {
      if (!canCallBack) return this.wrongKind(name, "outbound", payload.event);
      return this.taskResult(name, actor, payload);
    }
    if (!canReceive) return this.wrongKind(name, "inbound", payload.event);
    if (payload.event === "papers.add") return this.papersAdd(actor, payload);
    return this.noteAdd(actor, payload);
  }

  private wrongKind(name: string, needs: string, event: string): InboundResponse {
    return {
      status: 403,
      body: {
        error: "forbidden",
        reason: `connector '${name}' is not ${needs}; it cannot send ${event}`,
      },
    };
  }

  private async addPapers(
    actor: Actor,
    papers: readonly PaperRef[],
    defaults: {
      why?: string | undefined;
      target: "inbox" | "library";
      projects: string[];
      tags: string[];
    },
  ): Promise<PaperResult[]> {
    const results: PaperResult[] = [];
    for (const paper of papers.slice(0, MAX_ITEMS)) {
      const identifier = typeof paper === "string" ? paper : (paper.identifier ?? paper.url ?? "");
      const why = (typeof paper === "string" ? undefined : paper.why) ?? defaults.why;
      try {
        // The sender is on the internet: no local files, no addresses of this Mac or its network.
        assertRemoteSafe(identifier);
        const out = (await this.opts.registry.call(
          "items.add",
          { actor },
          {
            identifier,
            target: defaults.target,
            projects: defaults.projects,
            tags: defaults.tags,
            ...(why ? { why } : {}),
          },
        )) as { citekey: string; job: string; duplicateOf?: string };
        results.push({
          input: identifier,
          ok: true,
          citekey: out.citekey,
          job: out.job,
          ...(out.duplicateOf ? { duplicateOf: out.duplicateOf } : {}),
        });
      } catch (err) {
        results.push({ input: identifier, ok: false, error: describeError(err) });
      }
    }
    return results;
  }

  private async papersAdd(actor: Actor, payload: PapersAddPayload): Promise<InboundResponse> {
    const results = await this.addPapers(actor, payload.papers, payload);
    return {
      status: 200,
      body: { ok: results.every((r) => r.ok), target: payload.target, results },
    };
  }

  /** One line of the Sources section of a note. */
  private async sourceLine(actor: Actor, source: SourceRef, noteTitle: string): Promise<string> {
    const object = typeof source === "string" ? undefined : source;
    if (object && "citekey" in object) return `- [[${object.citekey}]]`;
    if (object && "url" in object) {
      return object.title ? `- [${object.title}](${object.url})` : `- <${object.url}>`;
    }
    const text =
      typeof source === "string" ? source : (object as { identifier: string }).identifier;
    if (typeof source === "string" && /^https?:\/\//i.test(text)) return `- <${text}>`;
    if (Citekey.safeParse(text).success) {
      const known = await this.opts.registry
        .call("items.get", { actor }, { citekey: text })
        .then(() => true)
        .catch(() => false);
      if (known) return `- [[${text}]]`;
    }
    const [result] = await this.addPapers(
      actor,
      [{ identifier: text, why: `Source of the note "${noteTitle}"` }],
      {
        target: "inbox",
        projects: [],
        tags: [],
      },
    );
    return result?.ok && result.citekey ? `- [[${result.citekey}]]` : `- ${text}`;
  }

  private async noteAdd(actor: Actor, payload: NoteAddPayload): Promise<InboundResponse> {
    const lines: string[] = [];
    for (const source of payload.sources) {
      const line = await this.sourceLine(actor, source, payload.title);
      if (!lines.includes(line)) lines.push(line);
    }
    const body = lines.length
      ? `${payload.text.trimEnd()}\n\n## Sources\n\n${lines.join("\n")}\n`
      : `${payload.text.trimEnd()}\n`;
    try {
      const note = (await this.opts.registry.call(
        "notes.create",
        { actor },
        { title: payload.title, body, type: payload.type, projects: payload.projects },
      )) as { frontmatter: { id: string } };
      return { status: 200, body: { ok: true, note: note.frontmatter.id, sources: lines.length } };
    } catch (err) {
      return { status: 422, body: { ok: false, error: describeError(err) } };
    }
  }

  private async taskResult(
    name: string,
    actor: Actor,
    payload: TaskResultPayload,
  ): Promise<InboundResponse> {
    const task = this.opts.tasks.get(payload.task);
    if (!task) return { status: 404, body: { error: "unknown task" } };
    // A connector may only answer tasks it was given itself.
    if (task.connector !== name) {
      return {
        status: 403,
        body: { error: "forbidden", reason: "the task belongs to another connector" },
      };
    }
    if (!task.open) {
      return { status: 409, body: { error: "task already finished", task: task.id } };
    }
    if (payload.status === "failed") {
      this.opts.tasks.fail(task.id, payload.error ?? "the connector reported a failure");
      return { status: 200, body: { ok: true, task: task.id, status: "failed" } };
    }
    const results = await this.addPapers(actor, payload.papers, {
      why: `Found by research task ${task.id}: ${excerpt(task.prompt, 120)}`,
      target: payload.target,
      projects: task.project ? [task.project] : [],
      tags: [],
    });
    let note: string | undefined;
    if (payload.summary) {
      try {
        const made = (await this.opts.registry.call(
          "notes.create",
          { actor },
          {
            title: `${name}: ${excerpt(task.prompt, 60)}`,
            body: `${payload.summary.trimEnd()}\n`,
            type: "permanent",
            projects: task.project ? [task.project] : [],
          },
        )) as { frontmatter: { id: string } };
        note = made.frontmatter.id;
      } catch (err) {
        this.log(
          `webhook ${name}: could not save the summary note (${describeError(err).message})`,
        );
      }
    }
    this.opts.tasks.complete(task.id, { papers: results, ...(note ? { note } : {}) });
    return {
      status: 200,
      body: { ok: true, task: task.id, status: "succeeded", results, ...(note ? { note } : {}) },
    };
  }
}

/** A fresh delivery id; exported for clients and tests. */
export const newDeliveryId = (): string => randomUUID();
