import type { WebhookKind } from "@citegeist/ops";

/** Stands in for a token that citegeist does not show a second time (German text). */
export const MCP_PLACEHOLDER = "<MCP-TOKEN: in citegeist neu erzeugen>";
export const CALLBACK_PLACEHOLDER = "<CALLBACK-TOKEN: in citegeist neu erzeugen>";
export const MCP_PLACEHOLDER_EN = "<MCP-TOKEN: create a new one in citegeist>";
export const CALLBACK_PLACEHOLDER_EN = "<CALLBACK-TOKEN: create a new one in citegeist>";

/** The language of the message. It is addressed to an agent, so it follows the UI language. */
type MessageLang = "de" | "en";

interface Wording {
  mcpPlaceholder: string;
  callbackPlaceholder: string;
  addMcp: string;
  headerName: string;
  headerValue: string;
  headerValueNote: string;
  readOnly: string;
  readWrite: string;
  tasks: string;
  headers: string;
  newUuid: string;
  reply: string;
  onSuccess: string;
  onFailure: string;
  taskFromRequest: string;
  summary: string;
  paperRef: string;
  reason: string;
  sendYourself: (target: string, both: boolean) => string;
  papers: string;
  note: string;
  title: string;
  text: string;
  sources: string;
  inbox: string;
}

const WORDING: Record<MessageLang, Wording> = {
  de: {
    mcpPlaceholder: MCP_PLACEHOLDER,
    callbackPlaceholder: CALLBACK_PLACEHOLDER,
    addMcp:
      "Trag citegeist als custom MCP server ein und speichere ihn dauerhaft. Suche nicht in deinem Katalog danach.",
    headerName: "Header-Name",
    headerValue: "Header-Wert",
    headerValueNote:
      'Der Header-Wert ist der ganze Text hinter "Header-Wert:", mit "Bearer " am Anfang.',
    readOnly: "Der Zugang ist nur lesend: Du kannst die Bibliothek durchsuchen und lesen.",
    readWrite:
      "Du kannst die Bibliothek durchsuchen, lesen und Einträge anlegen. Neue Paper landen in der Inbox.",
    tasks:
      'Aufträge von citegeist kommen per POST an deine Trigger-URL. Der Body ist JSON mit event "task.request" und den Feldern task, prompt, project und callback.',
    headers: "Header:",
    newUuid: "<neue UUID bei jedem Aufruf>",
    reply:
      "Antworte auf jeden Auftrag mit einem POST an die callback.url aus genau diesem Auftrag. Nimm immer diese Adresse und baue keine eigene.",
    onSuccess: "Body bei Erfolg:",
    onFailure: "Body bei Misserfolg:",
    taskFromRequest: "<task aus dem Auftrag>",
    summary: "<Zusammenfassung>",
    paperRef: "<DOI, arXiv-Id oder URL>",
    reason: "<Grund>",
    sendYourself: (target, both) =>
      `Du kannst citegeist auch von dir aus Paper und Notizen schicken. POST an ${target}${
        both ? " mit denselben Headern wie oben." : "."
      }`,
    papers: "Paper",
    note: "Notiz",
    title: "<Titel>",
    text: "<Text>",
    sources: "<DOI oder URL>",
    inbox: "Paper und Notizen landen in der Inbox von citegeist.",
  },
  en: {
    mcpPlaceholder: MCP_PLACEHOLDER_EN,
    callbackPlaceholder: CALLBACK_PLACEHOLDER_EN,
    addMcp:
      "Add citegeist as a custom MCP server and keep it permanently. Do not look for it in your catalog.",
    headerName: "Header name",
    headerValue: "Header value",
    headerValueNote:
      'The header value is the whole text after "Header value:", starting with "Bearer ".',
    readOnly: "The access is read-only: you can search and read the library.",
    readWrite:
      "You can search the library, read it and create entries. New papers land in the inbox.",
    tasks:
      'Tasks from citegeist arrive as a POST to your trigger URL. The body is JSON with the event "task.request" and the fields task, prompt, project and callback.',
    headers: "Headers:",
    newUuid: "<new UUID for every call>",
    reply:
      "Answer every task with a POST to the callback.url of that very task. Always use this address and do not build your own.",
    onSuccess: "Body on success:",
    onFailure: "Body on failure:",
    taskFromRequest: "<task from the request>",
    summary: "<summary>",
    paperRef: "<DOI, arXiv id or URL>",
    reason: "<reason>",
    sendYourself: (target, both) =>
      `You can also send papers and notes to citegeist on your own. POST to ${target}${
        both ? " with the same headers as above." : "."
      }`,
    papers: "Papers",
    note: "Note",
    title: "<title>",
    text: "<text>",
    sources: "<DOI or URL>",
    inbox: "Papers and notes land in the inbox of citegeist.",
  },
};

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
  /** Language of the message; German when absent. */
  lang?: MessageLang;
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

  const w = WORDING[input.lang ?? "de"];
  const parts: string[] = [];
  const mcpToken = input.mcpToken ?? w.mcpPlaceholder;
  const inboundToken = input.inboundToken ?? w.callbackPlaceholder;
  const needsMcpToken = input.mcpScope !== undefined && input.mcpToken === undefined;
  const callback = wantsCallback(input);
  const needsInboundToken = callback && input.inboundToken === undefined;

  if (input.mcpScope) {
    parts.push(
      [
        w.addMcp,
        ``,
        `Name: citegeist`,
        `URL: ${base}/mcp`,
        `${w.headerName}: Authorization`,
        `${w.headerValue}: Bearer ${mcpToken}`,
        ``,
        w.headerValueNote,
        input.mcpScope === "read" ? w.readOnly : w.readWrite,
      ].join("\n"),
    );
  }

  if (input.kind !== "inbound") parts.push(w.tasks);

  if (callback) {
    const headers = [
      w.headers,
      `Authorization: Bearer ${inboundToken}`,
      `x-citegeist-id: ${w.newUuid}`,
      `content-type: application/json`,
    ];
    const lines: string[] = [];
    if (input.kind !== "inbound") {
      lines.push(
        w.reply,
        ``,
        ...headers,
        ``,
        w.onSuccess,
        `{"event":"task.result","task":"${w.taskFromRequest}","status":"succeeded","summary":"${w.summary}","papers":["${w.paperRef}"]}`,
        ``,
        w.onFailure,
        `{"event":"task.result","task":"${w.taskFromRequest}","status":"failed","error":"${w.reason}"}`,
      );
    }
    if (input.kind !== "outbound") {
      if (lines.length > 0) lines.push(``);
      lines.push(
        w.sendYourself(`${base}/hooks/${input.name}`, input.kind === "both"),
        ``,
        ...(input.kind === "inbound" ? [...headers, ``] : []),
        `${w.papers}: {"event":"papers.add","papers":["${w.paperRef}"],"why":"${w.reason}"}`,
        `${w.note}: {"event":"note.add","title":"${w.title}","text":"${w.text}","sources":["${w.sources}"]}`,
        w.inbox,
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
