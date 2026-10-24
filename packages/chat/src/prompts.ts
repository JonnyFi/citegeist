import type { ChatContext, ChatEntry, ChatSessionSummary, ChatTurn } from "@citegeist/ops";
import type { SessionMode } from "./policy.js";

/** Instructions sent with the first message of a session (ACP has no stable system prompt). */
export function instructions(opts: {
  mode: SessionMode;
  libraryRoot: string;
  directEdits: boolean;
  /** A11: the sandbox. When false the agent has the user's shell and tools. */
  isolated?: boolean;
}): string {
  const lines = [
    "You work inside citegeist, the user's research library on their Mac. It holds papers, quote cards, notes and projects. You reach it through the citegeist MCP server: search, get_item, read_document, list_cards, add_item, attach_file, trash_item, create_card, create_note, link, list_projects, create_project, get_project, cite and jobs_get. Your working folder is an empty scratch folder, so use the MCP tools to look things up.",
    "",
    "How to work",
    "- Answer in the language the user writes in.",
    "- Base every statement about a source on the library. Search or read the document first. Never invent quotes, page numbers, citekeys or card ids.",
    "- Cite with wiki links and always give a label after the bar: a source [[luhmann1984soziale|Luhmann 1984]], a quote card [[c_01JB8Z3Q|Luhmann 1984, S. 31]], a passage [[luhmann1984soziale#^b7f3k2q|S. 31]]. Use only citekeys, card ids and block ids that a tool returned.",
    '- Papers you find go to the inbox: call add_item with a short reason in `why`. Pass target "library" only when the user named that exact paper and asked for it.',
    "- When the request is ambiguous, ask exactly one question.",
  ];
  if (opts.mode === "chat") {
    lines.push(
      "- When the user asks for a change, make it directly. Afterwards say in one line what you changed and where.",
    );
    if (opts.isolated === false) {
      lines.push(
        "- You run in the user's own environment: you have a shell, the user's other MCP servers and their Claude Code settings. When the citegeist tools are not enough, use them (for example download a PDF with curl, then add it with add_item or attach_file using the local path). If you lack a capability, say so plainly.",
      );
    }
    if (opts.directEdits) {
      lines.push(
        `- The library folder is ${opts.libraryRoot}. You may edit its text files directly: notes/*.md, projects/*/project.md, the plans and texts under projects/*/ and the note text of items/<citekey>/<citekey>.md. Never touch items/*/derived, items/*/sources, the quote block of a card or citegeist.json.`,
      );
    }
  }
  return lines.join("\n");
}

/** What the screen shows, as a short block in front of the message. */
export function renderContext(ctx: ChatContext): string {
  const lines: string[] = [];
  if (ctx.project) lines.push(`Project: ${ctx.project} (get_project has the brief)`);
  if (ctx.plan) {
    lines.push(
      `Open plan: ${ctx.plan} (get_project with this plan has the outline; edit_outline, edit_plan_doc, find_insights and note_insight take it as plan)`,
    );
  }
  if (ctx.node) {
    lines.push(
      `Open outline node: ${ctx.node} (pass it as the node or target of the planning tools)`,
    );
  }
  if (ctx.text && ctx.project) {
    lines.push(
      `Open text: projects/${ctx.project}/texts/${ctx.text}.md (Markdown with Pandoc citations such as [@citekey, S. 12]. Read it with \`cg texts get\`, draft or revise passages in the file itself, and cite only citekeys that exist in the library. \`cg texts export\` makes the Word or LaTeX file.)`,
    );
  }
  if (ctx.item) lines.push(`Open source: ${ctx.item}`);
  if (ctx.selection) {
    const s = ctx.selection;
    const where = s.page ? `${s.citekey}, p. ${s.page}` : s.citekey;
    const card = s.card ? ` Card ${s.card}.` : "";
    lines.push(`Marked passage (${where}).${card}`, `> ${s.text.replace(/\n/g, "\n> ")}`);
  }
  return lines.length > 0 ? `[Context from the screen]\n${lines.join("\n")}\n\n` : "";
}

export function turnPrompt(opts: {
  first: string | undefined;
  context: ChatContext;
  message: string;
}): string {
  return `${opts.first ? `${opts.first}\n\n---\n\n` : ""}${renderContext(opts.context)}${opts.message}`;
}

export function researchPrompt(opts: {
  topic: string;
  project?: string | undefined;
  maxItems: number;
}): string {
  return [
    `Research job: ${opts.topic}`,
    ...(opts.project
      ? [
          `Project: ${opts.project}. Read its brief with get_project and keep to its research questions.`,
        ]
      : []),
    "",
    `Find up to ${opts.maxItems} relevant papers. Use web search and the library's search tool.`,
    "For each paper worth keeping, call add_item with its DOI or arXiv ID and a `why` of one or two sentences that says how it relates to the topic. Leave `target` unset so the paper lands in the inbox. Skip papers the library already has; check with search first.",
    `Stop after ${opts.maxItems} additions. Finish with a short list of the papers you added, one line each.`,
  ].join("\n");
}

// Transcript ------------------------------------------------------------------------------------

/** Markdown for chats/<date>-<slug>.md. The file is free text, the frontmatter is for Obsidian. */
export function transcriptMarkdown(opts: {
  session: ChatSessionSummary;
  context: ChatContext;
  entries: readonly ChatEntry[];
  turns: readonly ChatTurn[];
  date: string;
}): string {
  const { session, context } = opts;
  const fm = [
    "---",
    "type: chat",
    `session: ${session.id}`,
    `backend: ${session.backend}`,
    `date: ${opts.date}`,
    ...(context.project ? [`project: ${context.project}`] : []),
    ...(context.plan ? [`plan: ${context.plan}`] : []),
    ...(context.item ? [`item: "[[${context.item}]]"`] : []),
    "---",
  ];
  const out = [...fm, "", `# ${session.title}`];
  for (const e of opts.entries) {
    switch (e.type) {
      case "user":
        out.push("", "## User", "", e.text);
        break;
      case "assistant":
        out.push("", `## ${session.backend}`, "", e.text);
        break;
      case "tool":
        out.push("", `- ${e.tool ?? e.kind}: ${e.title}${e.detail ? ` (${e.detail})` : ""}`);
        break;
      case "notice":
        out.push("", `> ${e.text}`);
        break;
    }
  }
  const edited = opts.turns.flatMap((t) => (t.reverted ? [] : t.edits.map((x) => x.path)));
  if (edited.length > 0) {
    out.push("", "## Changed files", "", ...[...new Set(edited)].map((p) => `- ${p}`));
  }
  return `${out.join("\n")}\n`;
}
