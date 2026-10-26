import type { WebhookKind } from "@citegeist/ops";

/** Stands in for a token that citegeist does not show a second time. */
export const MCP_PLACEHOLDER = "<MCP-TOKEN: in citegeist neu erzeugen>";
export const CALLBACK_PLACEHOLDER = "<CALLBACK-TOKEN: in citegeist neu erzeugen>";

export interface AgentMessageInput {
  name: string;
  kind: WebhookKind;
  /** The public address of the tunnel, for example https://mac.example.ts.net. */
  publicUrl?: string | undefined;
  /** Set when the connector has MCP access. */
  mcpScope?: "read" | "write";
  /** The MCP token, only known right after it was created. */
  mcpToken?: string;
  /** True when the connector accepts the bearer token for callbacks and inbound requests. */
  hasInboundToken: boolean;
  /** The bearer token, only known right after it was created. */
  inboundToken?: string;
}

export type AgentMessage =
  | { ok: false; reason: "no-public-url" }
  | {
      ok: true;
      text: string;
      /** The text carries a placeholder instead of the MCP token. */
      needsMcpToken: boolean;
      /** The text carries a placeholder instead of the callback token. */
      needsInboundToken: boolean;
    };

/** True when the message has a callback part: the connector receives tasks or is inbound. */
function wantsCallback(input: AgentMessageInput): boolean {
  return input.hasInboundToken || input.kind !== "outbound";
}

/**
 * The message a user pastes to an agent so that it can reach citegeist. Every header value is
 * complete ("Bearer " included), so nobody assembles it by hand. A token that citegeist no longer
 * knows is a placeholder. Without a public address there is nothing the agent could reach.
 */
export function buildAgentMessage(input: AgentMessageInput): AgentMessage {
  const base = input.publicUrl?.trim().replace(/\/+$/, "");
  if (!base) return { ok: false, reason: "no-public-url" };

  const parts: string[] = [];
  const mcpToken = input.mcpToken ?? MCP_PLACEHOLDER;
  const inboundToken = input.inboundToken ?? CALLBACK_PLACEHOLDER;
  const needsMcpToken = input.mcpScope !== undefined && input.mcpToken === undefined;
  const callback = wantsCallback(input);
  const needsInboundToken = callback && input.inboundToken === undefined;

  if (input.mcpScope) {
    parts.push(
      [
        `Trag citegeist als custom MCP server ein und speichere ihn dauerhaft. Suche nicht in deinem Katalog danach.`,
        ``,
        `Name: citegeist`,
        `URL: ${base}/mcp`,
        `Header-Name: Authorization`,
        `Header-Wert: Bearer ${mcpToken}`,
        ``,
        `Der Header-Wert ist der ganze Text hinter "Header-Wert:", mit "Bearer " am Anfang.`,
        input.mcpScope === "read"
          ? `Der Zugang ist nur lesend: Du kannst die Bibliothek durchsuchen und lesen.`
          : `Du kannst die Bibliothek durchsuchen, lesen und Einträge anlegen. Neue Paper landen in der Inbox.`,
      ].join("\n"),
    );
  }

  if (input.kind !== "inbound") {
    parts.push(
      `Aufträge von citegeist kommen per POST an deine Trigger-URL. Der Body ist JSON mit event "task.request" und den Feldern task, prompt, project und callback.`,
    );
  }

  if (callback) {
    const headers = [
      `Header:`,
      `Authorization: Bearer ${inboundToken}`,
      `x-citegeist-id: <neue UUID bei jedem Aufruf>`,
      `content-type: application/json`,
    ];
    const lines: string[] = [];
    if (input.kind !== "inbound") {
      lines.push(
        `Antworte auf jeden Auftrag mit einem POST an die callback.url aus genau diesem Auftrag. Nimm immer diese Adresse und baue keine eigene.`,
        ``,
        ...headers,
        ``,
        `Body bei Erfolg:`,
        `{"event":"task.result","task":"<task aus dem Auftrag>","status":"succeeded","summary":"<Zusammenfassung>","papers":["<DOI, arXiv-Id oder URL>"]}`,
        ``,
        `Body bei Misserfolg:`,
        `{"event":"task.result","task":"<task aus dem Auftrag>","status":"failed","error":"<Grund>"}`,
      );
    }
    if (input.kind !== "outbound") {
      if (lines.length > 0) lines.push(``);
      lines.push(
        `Du kannst citegeist auch von dir aus Paper und Notizen schicken. POST an ${base}/hooks/${input.name}${
          input.kind === "both" ? ` mit denselben Headern wie oben.` : `.`
        }`,
        ``,
        ...(input.kind === "inbound" ? [...headers, ``] : []),
        `Paper: {"event":"papers.add","papers":["<DOI, arXiv-Id oder URL>"],"why":"<Grund>"}`,
        `Notiz: {"event":"note.add","title":"<Titel>","text":"<Text>","sources":["<DOI oder URL>"]}`,
        `Paper und Notizen landen in der Inbox von citegeist.`,
      );
    }
    parts.push(lines.join("\n"));
  }

  return {
    ok: true,
    text: parts.join("\n\n"),
    needsMcpToken,
    needsInboundToken,
  };
}
