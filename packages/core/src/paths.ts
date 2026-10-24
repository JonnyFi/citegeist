import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

/** Default base for machine-local data: ~/Library/Application Support/citegeist */
export function defaultLocalBase(): string {
  return join(homedir(), "Library", "Application Support", "citegeist");
}

/** Every file location of the library format (docs/spec/library-format.md), relative to the root. */
export class LibraryPaths {
  constructor(readonly root: string) {}

  abs(rel: string): string {
    return join(this.root, ...rel.split("/"));
  }
  /** Root-relative path with forward slashes. */
  rel(abs: string): string {
    return relative(this.root, abs).split(sep).join("/");
  }

  get manifest(): string {
    return join(this.root, "citegeist.json");
  }
  get agentsMd(): string {
    return join(this.root, "AGENTS.md");
  }
  get claudeMd(): string {
    return join(this.root, "CLAUDE.md");
  }

  get itemsDir(): string {
    return join(this.root, "items");
  }
  itemDir(citekey: string): string {
    return join(this.itemsDir, citekey);
  }
  itemFile(citekey: string): string {
    return join(this.itemDir(citekey), `${citekey}.md`);
  }
  sourcesDir(citekey: string): string {
    return join(this.itemDir(citekey), "sources");
  }
  sourceFile(citekey: string, hash: string, ext: string): string {
    return join(this.sourcesDir(citekey), `${hash}.${ext.replace(/^\./, "")}`);
  }
  derivedDir(citekey: string, hash: string): string {
    return join(this.itemDir(citekey), "derived", hash);
  }
  derivedManifest(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "manifest.json");
  }
  pages(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "pages.json");
  }
  blocks(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "blocks.jsonl");
  }
  idmap(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "idmap.json");
  }
  refs(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "refs.jsonl");
  }
  docMd(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "doc.md");
  }
  docHtml(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "doc.html");
  }
  assetsDir(citekey: string, hash: string): string {
    return join(this.derivedDir(citekey, hash), "assets");
  }
  cardsDir(citekey: string): string {
    return join(this.itemDir(citekey), "cards");
  }
  cardFile(citekey: string, cardId: string): string {
    return join(this.cardsDir(citekey), `${cardId}.md`);
  }

  get notesDir(): string {
    return join(this.root, "notes");
  }
  noteFile(slug: string): string {
    return join(this.notesDir, `${slug}.md`);
  }
  /** Concepts (notes of type "concept") live in their own folder. */
  get conceptsDir(): string {
    return join(this.notesDir, "concepts");
  }
  conceptFile(slug: string): string {
    return join(this.conceptsDir, `${slug}.md`);
  }

  get projectsDir(): string {
    return join(this.root, "projects");
  }
  projectDir(slug: string): string {
    return join(this.projectsDir, slug);
  }
  projectFile(slug: string): string {
    return join(this.projectDir(slug), "project.md");
  }
  exportsDir(slug: string): string {
    return join(this.projectDir(slug), "exports");
  }
  exportFile(slug: string, name: string): string {
    return join(this.exportsDir(slug), name);
  }

  get chatsDir(): string {
    return join(this.root, "chats");
  }
  chatFile(name: string): string {
    return join(this.chatsDir, `${name}.md`);
  }

  /** Literature search (workers/research): runs, preprint lists, opendraft and LaTeX output. */
  get researchDir(): string {
    return join(this.root, "research");
  }
  get litsearchRunsDir(): string {
    return join(this.researchDir, "runs");
  }
  litsearchRunDir(runId: string): string {
    return join(this.litsearchRunsDir, runId);
  }
  get litsearchWatchesDir(): string {
    return join(this.researchDir, "watches");
  }
}

/** Machine-local files: index, state, logs, models. Never inside the synced library folder. */
export class LocalPaths {
  readonly dir: string;
  constructor(base: string, libraryId: string) {
    this.dir = join(base, libraryId);
  }
  get indexDb(): string {
    return join(this.dir, "index.sqlite");
  }
  get stateDb(): string {
    return join(this.dir, "state.sqlite");
  }
  get lock(): string {
    return join(this.dir, "core.lock");
  }
  get logsDir(): string {
    return join(this.dir, "logs");
  }
  get modelsDir(): string {
    return join(this.dir, "models");
  }
  get cacheDir(): string {
    return join(this.dir, "cache");
  }
}
