import { itemsRename, itemsResolve, itemsUpdate } from "@citegeist/ops";
import { CslType, type ItemFrontmatter } from "@citegeist/schema";
import { useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useI18n } from "../i18n";
import { typeLabel } from "../lib/format";
import { useOpMutation } from "../lib/hooks";
import { classifyIdentifier } from "../lib/identifier";
import {
  type CreatorRow,
  emptyRow,
  type FormErrors,
  formFromItem,
  isValidIsbn,
  type MetadataForm,
  patchFromForm,
  validateForm,
} from "../lib/metadata-form";
import { cn, describeError } from "../lib/utils";
import { MergeOfferNote, mergeOfferOf } from "./inbox-item";
import { Stamp } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";

/** What the item view tells after a save, a lookup or a rename. */
export interface Notice {
  text: string;
  error?: boolean;
  /** Citekey the formula would give the item now; shown with the offer to rename. */
  suggested?: string;
  /** The identifier belongs to the same work on the other side of the inbox boundary. */
  merge?: { from: string; into: string };
}

/** The hint on an item without author or year, with the actions that repair it. */
export function MetadataHint({
  onAddIdentifier,
  onFetch,
  onEdit,
  fetching,
}: {
  onAddIdentifier: () => void;
  onFetch: () => void;
  onEdit: () => void;
  fetching: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      role="note"
      aria-label={t("metahint.title")}
      className="flex flex-col gap-2 border border-line px-3 py-2 text-[13px]"
    >
      <span>
        <Stamp>{t("metahint.title")}</Stamp> {t("metahint.text")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={onAddIdentifier}>
          {t("metahint.addId")}
        </Button>
        <Button size="sm" disabled={fetching} onClick={onFetch}>
          {fetching ? t("resolve.running") : t("resolve.button")}
        </Button>
        <Button size="sm" onClick={onEdit}>
          {t("metaform.edit")}
        </Button>
      </div>
    </div>
  );
}

/** Offers the citekey the formula gives now. Nothing is renamed until the person agrees. */
export function RenameOffer({
  citekey,
  suggested,
  onClose,
}: {
  citekey: string;
  suggested: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const rename = useOpMutation(itemsRename);
  return (
    <div
      role="note"
      aria-label={t("rename.apply")}
      className="flex flex-wrap items-center gap-2 border border-line px-3 py-2 text-[13px]"
    >
      <span>{t("rename.offer", { citekey, suggested })}</span>
      <Button
        size="sm"
        variant="primary"
        disabled={rename.isPending}
        onClick={() =>
          rename.mutate(
            { citekey, to: suggested },
            {
              onSuccess: () => {
                onClose();
                void navigate({ to: "/items/$citekey", params: { citekey: suggested } });
              },
            },
          )
        }
      >
        {rename.isPending ? t("rename.running") : t("rename.apply")}
      </Button>
      <Button size="sm" onClick={onClose}>
        {t("rename.keep")}
      </Button>
      {rename.error ? (
        <span role="alert" className="w-full text-[12px] text-danger">
          {t("rename.failed", { message: describeError(rename.error).message })}
        </span>
      ) : null}
    </div>
  );
}

/** "Kennung hinzufügen": a DOI, ISBN, arXiv id, PMID or URL for an existing item. */
export function IdentifierForm({
  citekey,
  onDone,
  onCancel,
}: {
  citekey: string;
  onDone: (notice: Notice) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const resolve = useOpMutation(itemsResolve);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const identifier = value.trim();
    const kind = classifyIdentifier(identifier).kind;
    if (!["doi", "arxiv", "isbn", "pmid", "url"].includes(kind)) {
      setProblem(t("ident.invalid"));
      return;
    }
    if (kind === "isbn" && !isValidIsbn(identifier)) {
      setProblem(t("metaform.error.isbn"));
      return;
    }
    setProblem(null);
    resolve.mutate(
      { citekey, identifier },
      {
        onSuccess: (out) =>
          onDone({
            text:
              out.changed.length > 0
                ? t("resolve.changed", { fields: out.changed.join(", ") })
                : t("resolve.unchanged"),
            ...(out.suggestedCitekey ? { suggested: out.suggestedCitekey } : {}),
          }),
      },
    );
  };
  const offer = resolve.error ? mergeOfferOf(resolve.error) : undefined;
  const shown = problem ?? (resolve.error && !offer ? describeError(resolve.error).message : null);

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={t("metahint.addId")}>
      <label htmlFor={id} className="text-muted">
        {t("ident.label")}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("ident.placeholder")}
          autoComplete="off"
          aria-invalid={shown ? true : undefined}
          className="max-w-[420px]"
        />
        <Button type="submit" variant="primary" disabled={resolve.isPending || value.trim() === ""}>
          {resolve.isPending ? t("ident.running") : t("ident.submit")}
        </Button>
        <Button type="button" onClick={onCancel}>
          {t("ident.cancel")}
        </Button>
      </div>
      {shown ? (
        <p role="alert" className="text-[12px] text-danger">
          {shown}
        </p>
      ) : null}
      {offer ? (
        <MergeOfferNote citekey={citekey} offer={offer} onMerged={(text) => onDone({ text })} />
      ) : null}
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
  children: (props: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-muted">
        {label}
        {hint ? (
          <>
            {" "}
            <span className="font-mono text-[11px]">{hint}</span>
          </>
        ) : null}
      </label>
      {children({
        id,
        ...(error ? { "aria-invalid": true as const, "aria-describedby": errorId } : {}),
      })}
      {error ? (
        <p id={errorId} role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CreatorList({
  label,
  rows,
  onChange,
  error,
}: {
  label: string;
  rows: CreatorRow[];
  onChange: (rows: CreatorRow[]) => void;
  error?: string | undefined;
}) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<CreatorRow>) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1 p-0 text-muted">{label}</legend>
      {rows.map((row, i) => (
        // rows have no stable id; the list is only ever edited at the end or by removing a row
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div key={i} className="flex items-center gap-2">
          {row.kind === "org" ? (
            <Input
              aria-label={`${t("metaform.org")} ${i + 1}`}
              value={row.family}
              onChange={(e) => set(i, { family: e.target.value })}
            />
          ) : (
            <>
              <Input
                aria-label={`${t("metaform.family")} ${i + 1}`}
                value={row.family}
                onChange={(e) => set(i, { family: e.target.value })}
                placeholder={t("metaform.family")}
              />
              <Input
                aria-label={`${t("metaform.given")} ${i + 1}`}
                value={row.given}
                onChange={(e) => set(i, { given: e.target.value })}
                placeholder={t("metaform.given")}
              />
            </>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("metaform.removePerson", { n: i + 1 })}
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" onClick={() => onChange([...rows, emptyRow()])}>
          <Plus className="size-3.5" />
          {t("metaform.addPerson")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * "Metadaten bearbeiten": the CSL-relevant fields of an item as a form. A save sends only the
 * fields that changed to items.update, so that they count as edited by a person and a later
 * lookup keeps them.
 */
export function MetadataEditor({
  fm,
  onDone,
  onCancel,
}: {
  fm: ItemFrontmatter;
  onDone: (notice: Notice) => void;
  onCancel: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const update = useOpMutation(itemsUpdate);
  const [form, setForm] = useState<MetadataForm>(() => formFromItem(fm));
  const [errors, setErrors] = useState<FormErrors>({});
  const set = <K extends keyof MetadataForm>(key: K, value: MetadataForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof FormErrors): string | undefined => {
    const k = errors[key];
    return k ? t(k) : undefined;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const patch = patchFromForm(form, fm);
    const fields = Object.keys(patch);
    if (fields.length === 0) {
      onDone({ text: t("metaform.unchanged") });
      return;
    }
    update.mutate(
      { citekey: fm.citekey, patch },
      {
        onSuccess: (out) =>
          onDone({
            text: t("metaform.saved", { fields: fields.join(", ") }),
            ...(out.suggestedCitekey ? { suggested: out.suggestedCitekey } : {}),
          }),
      },
    );
  };

  const types = CslType.options;
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t("metaform.label")}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label={t("metaform.type")}>
          {(p) => (
            <select
              {...p}
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
              className="h-7 w-full border border-line bg-transparent px-2 text-[13px] text-ink"
            >
              {types.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(i18n, type)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("metaform.titleField")} error={text("title")}>
          {(p) => (
            <Input {...p} value={form.title} onChange={(e) => set("title", e.target.value)} />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <CreatorList
          label={t("metaform.authors")}
          rows={form.authors}
          onChange={(rows) => set("authors", rows)}
          error={text("authors")}
        />
        <CreatorList
          label={t("metaform.editors")}
          rows={form.editors}
          onChange={(rows) => set("editors", rows)}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label={t("metaform.issued")} hint={t("metaform.issuedHint")} error={text("issued")}>
          {(p) => (
            <Input {...p} value={form.issued} onChange={(e) => set("issued", e.target.value)} />
          )}
        </Field>
        <Field label={t("metaform.container")}>
          {(p) => (
            <Input
              {...p}
              value={form.containerTitle}
              onChange={(e) => set("containerTitle", e.target.value)}
            />
          )}
        </Field>
        <Field label={t("meta.volume")}>
          {(p) => (
            <Input {...p} value={form.volume} onChange={(e) => set("volume", e.target.value)} />
          )}
        </Field>
        <Field label={t("meta.issue")}>
          {(p) => (
            <Input {...p} value={form.issue} onChange={(e) => set("issue", e.target.value)} />
          )}
        </Field>
        <Field label={t("meta.pages")}>
          {(p) => <Input {...p} value={form.page} onChange={(e) => set("page", e.target.value)} />}
        </Field>
        <Field label={t("meta.publisher")}>
          {(p) => (
            <Input
              {...p}
              value={form.publisher}
              onChange={(e) => set("publisher", e.target.value)}
            />
          )}
        </Field>
        <Field label={t("metaform.place")}>
          {(p) => (
            <Input {...p} value={form.place} onChange={(e) => set("place", e.target.value)} />
          )}
        </Field>
        <Field label={t("metaform.edition")}>
          {(p) => (
            <Input {...p} value={form.edition} onChange={(e) => set("edition", e.target.value)} />
          )}
        </Field>
        <Field label="DOI" error={text("doi")}>
          {(p) => (
            <Input
              {...p}
              value={form.doi}
              onChange={(e) => set("doi", e.target.value)}
              className="font-mono text-[12px]"
            />
          )}
        </Field>
        <Field label="ISBN" error={text("isbn")}>
          {(p) => (
            <Input
              {...p}
              value={form.isbn}
              onChange={(e) => set("isbn", e.target.value)}
              className="font-mono text-[12px]"
            />
          )}
        </Field>
        <Field label="URL" error={text("url")}>
          {(p) => <Input {...p} value={form.url} onChange={(e) => set("url", e.target.value)} />}
        </Field>
        <Field label={t("meta.language")} error={text("language")}>
          {(p) => (
            <Input {...p} value={form.language} onChange={(e) => set("language", e.target.value)} />
          )}
        </Field>
      </div>

      <Field label={t("metaform.abstract")}>
        {(p) => (
          <Textarea
            {...p}
            rows={5}
            value={form.abstract}
            onChange={(e) => set("abstract", e.target.value)}
          />
        )}
      </Field>

      {update.error && !mergeOfferOf(update.error) ? (
        <p role="alert" className="text-[12px] text-danger">
          {t("metaform.failed", { message: describeError(update.error).message })}
        </p>
      ) : null}
      {update.error && mergeOfferOf(update.error) ? (
        <MergeOfferNote
          citekey={fm.citekey}
          offer={mergeOfferOf(update.error) as { from: string; into: string }}
          onMerged={(text) => onDone({ text })}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={update.isPending}>
          {update.isPending ? t("metaform.saving") : t("common.save")}
        </Button>
        <Button type="button" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
