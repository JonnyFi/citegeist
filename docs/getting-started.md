# Getting started

## Requirements

- macOS on Apple Silicon.
- [uv](https://docs.astral.sh/uv/) for the Python environment of the PDF conversion (`brew install uv`).
- One AI backend for the chat and the AI tasks (paraphrases, link proposals, summaries). The options are the Claude Code, Codex or Cursor command line tool that you are logged in to, an API key for Anthropic, OpenAI, OpenRouter or xAI, or a local Ollama. The library, the reader and the search work without one.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/JonnyFi/citegeist/main/install.sh | sh
```

citegeist is signed ad hoc and not notarized, because the project has no Apple Developer ID. macOS adds a quarantine attribute to files that a browser downloads, and Gatekeeper then blocks the app. A file that `curl` downloads carries no such attribute, so the install script avoids the problem.

The script does the following:

1. It checks for macOS on Apple Silicon and reads the latest release from the GitHub API.
2. It downloads `citegeist-<version>-arm64.zip` and compares its checksum with the `.sha256` file of the release. On a mismatch it stops before installing anything.
3. It quits a running citegeist, replaces `/Applications/citegeist.app` (or `~/Applications/citegeist.app` when `/Applications` is not writable) and starts the app.
4. It links `~/.local/bin/cg` to `Contents/Resources/bin/cg` inside the app. This is the command line tool that local agents use through `cg mcp`. The script creates the folder when needed and leaves an existing `cg` alone when it did not come from citegeist. If `~/.local/bin` is not in your `PATH`, the script prints the line to add to `~/.zshrc`.
5. It checks for `uv` and for at least one of the `claude`, `codex` and `cursor-agent` command line tools and prints the install command for what is missing. It installs none of them.

Running the same command again updates citegeist. The app also checks the releases API at most once a day and shows "Update available" in the top bar. A click opens Terminal, which runs the install script.

The library and the settings live outside the app and survive updates.

## First start

The setup has three steps, and you can skip each of them and return to it in the settings.

1. **Library.** Choose a folder. When it is not a library yet, citegeist asks and creates `citegeist.json` and the subfolders. The app remembers the folder for the next start. To open a specific library from a shell, set `CITEGEIST_LIBRARY=/path/to/library`.
2. **AI backend.** The list shows which command line tools citegeist found and whether you are logged in. When none works, the setup lists the options (Claude Code, Codex, Cursor, an API key, Ollama) with install and login commands that you can copy. Test the backend and choose it. API keys are optional and go into the macOS Keychain.
3. **Conversion worker.** "Install" lets uv create the Python environment under `~/Library/Application Support/citegeist`. The first run takes a few minutes and needs a network connection. When uv is missing, the setup shows `brew install uv` and the curl installer with copy buttons and a "Check again" button. Without the worker you can still add and read PDFs, but citegeist cannot convert them to text.

The interface starts in English and follows the preferred language of macOS: when it is German, citegeist is German. The language switch is in the settings (Settings > General > Language) and in the navigation rail, and a choice you make there always wins.

Four features are off until you turn them on in the settings:

- **Semantic search** downloads an embedding model once (EmbeddingGemma 300M, about 325 MB) and combines full text and meaning in the search. See [settings and models](guide/settings-and-models.md).
- **Pandoc** is needed to export texts. citegeist finds it in your `PATH` or in Homebrew. Otherwise the texts tab offers "Download Pandoc", which fetches a pinned release with a fixed checksum (`cg pandoc setup` does the same). A PDF export additionally needs Typst. The first PDF export asks whether citegeist may download it (about 14 MB, pinned release with a fixed checksum, `cg typst setup` does the same). Word, LaTeX and Markdown export need neither.
- **Zotero Connector** lets the browser extension save into citegeist.
- **Quick insert** opens a card search with a global hotkey and pastes the citation into the app you are working in. It needs the Accessibility permission of macOS.

## Add the first paper

An empty library shows three first actions (add a paper, highlight a passage, open the chat) and a button that adds a sample paper, the Docling Technical Report (CC-BY 4.0), which citegeist downloads from arXiv.

Use the field at the top of the library screen. It accepts a DOI, an arXiv link or ID, an ISBN, a PubMed ID, a URL or a BibTeX snippet. You can also drop a PDF into the window, or use "Choose PDF".

citegeist resolves the metadata, downloads an open-access PDF when one exists and converts it in the background. The status bar at the top right shows the running jobs. A paper that arrives through an agent or an alert goes to the inbox first. See [library and import](guide/library-and-import.md).

## Quote a passage

1. Open the item and switch to the "Read" tab.
2. Choose the PDF view or the text view. Both show the same highlights.
3. Select a passage and choose "Quote".

The card appears in the right column right away, with the exact wording and the page. The AI paraphrase and the card kind follow a few seconds later. If the printed page number of the PDF is not confirmed, a bar above the reader asks you to confirm it once, and every card of that PDF follows. See [reading and cards](guide/reading-and-cards.md).

## Open the chat

The "Agent" tab in the right column starts the chat. Pick Claude Code, Codex or Cursor, ask a question about your library, or ask for a change to a note or a text. The agent writes the change into your files, and "Undo" takes back everything it changed in that turn. The chat has its own tab for research jobs. See [agents](agents.md).

## Remove citegeist

```sh
rm -rf /Applications/citegeist.app ~/Applications/citegeist.app
rm -f ~/.local/bin/cg
rm -rf ~/Library/Application\ Support/citegeist
```

The last line deletes the index, the job state, the models and the Python environment. Your library folder with the PDFs and notes stays where it is.

## Next steps

- [Library and import](guide/library-and-import.md)
- [Settings and models](guide/settings-and-models.md)
- [Connecting agents](agents.md)
- [Building from source](development.md)
