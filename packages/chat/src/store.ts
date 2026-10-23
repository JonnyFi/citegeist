import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ChatContext, ChatEntry, ChatTurn } from "@citegeist/ops";
import type { JournalEdit } from "./journal.js";
import { writeAtomic } from "./util.js";

/** Everything the app keeps about one session. Lives in the machine-local folder, not the library. */
export interface SessionState {
  id: string;
  title: string;
  /** True once the user's message or the caller named the title. */
  titled: boolean;
  backend: string;
  kind: "chat" | "research";
  project?: string;
  item?: string;
  job?: string;
  saved?: string;
  createdAt: string;
  updatedAt: string;
  context: ChatContext;
  entries: ChatEntry[];
  turns: ChatTurn[];
  /** The agent has received the session instructions. Reset when its process is replaced. */
  instructed: boolean;
}

const AGENTS_MD = `# Scratch folder of a citegeist chat

This folder belongs to one chat session of citegeist, a research library app. It is empty on
purpose. The library (papers, quote cards, notes, projects) is not here: reach it through the
citegeist MCP tools. Keep working files in this folder.
`;

/** Files of the chat sessions: <localDir>/chats/<session>/{state.json,journal/<turn>.json,cwd/}. */
export class ChatStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  dir(id: string): string {
    return join(this.root, id);
  }

  /** The agent's working directory. Created with a note that tells it where it is. */
  scratch(id: string): string {
    const cwd = join(this.dir(id), "cwd");
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
      writeAtomic(join(cwd, "AGENTS.md"), AGENTS_MD);
      writeAtomic(join(cwd, "CLAUDE.md"), "See AGENTS.md.\n");
    }
    return cwd;
  }

  save(state: SessionState): void {
    writeAtomic(join(this.dir(state.id), "state.json"), JSON.stringify(state));
  }

  load(id: string): SessionState | undefined {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), "state.json"), "utf8")) as SessionState;
    } catch {
      return undefined;
    }
  }

  ids(): string[] {
    try {
      return readdirSync(this.root).filter((n) => /^ch_/.test(n));
    } catch {
      return [];
    }
  }

  writeJournal(id: string, turn: number, edits: readonly JournalEdit[]): void {
    writeAtomic(join(this.dir(id), "journal", `${turn}.json`), JSON.stringify({ turn, edits }));
  }

  readJournal(id: string, turn: number): JournalEdit[] | undefined {
    try {
      const parsed = JSON.parse(
        readFileSync(join(this.dir(id), "journal", `${turn}.json`), "utf8"),
      ) as { edits: JournalEdit[] };
      return parsed.edits;
    } catch {
      return undefined;
    }
  }

  remove(id: string): void {
    rmSync(this.dir(id), { recursive: true, force: true });
  }
}
