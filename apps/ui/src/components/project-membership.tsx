import {
  projectsAddItems,
  projectsCreate,
  projectsList,
  projectsRemoveItems,
} from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Menu } from "./ui/menu";
import { useToast } from "./ui/toast";

/** A project slug from a title: lowercase ASCII words joined by hyphens, made unique with a number. */
export function slugFor(title: string, taken: readonly string[]): string {
  const base =
    title
      .toLowerCase()
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "projekt";
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * Puts items into a project or takes them out, with projects.addItems and projects.removeItems:
 * one call, one history entry. A toast tells what changed and offers to undo it. Resolves true
 * when the call went through.
 */
export function useProjectMembership() {
  const core = useCore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, tn } = useI18n();
  const projects = useOp(projectsList, {});

  return useCallback(
    async (
      mode: "add" | "remove",
      slug: string,
      citekeys: readonly string[],
      projectTitle?: string,
    ): Promise<boolean> => {
      const title =
        projectTitle ?? projects.data?.projects.find((p) => p.slug === slug)?.title ?? slug;
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["op"] });
      const send = async (m: "add" | "remove", keys: readonly string[]): Promise<string[]> => {
        const input = { slug, citekeys: [...keys] };
        if (m === "add") return (await core.call(projectsAddItems, input)).added;
        return (await core.call(projectsRemoveItems, input)).removed;
      };
      let changed: string[];
      try {
        changed = await send(mode, citekeys);
      } catch (err) {
        toast.show({ message: t("membership.failed", { message: describeError(err).message }) });
        return false;
      }
      await refresh();
      if (changed.length === 0) {
        toast.show({ message: t("membership.unchanged", { project: title }) });
        return true;
      }
      toast.show({
        message: tn(mode === "add" ? "membership.added" : "membership.removed", changed.length, {
          project: title,
        }),
        actionLabel: t("item.undo"),
        onAction: async () => {
          try {
            await send(mode === "add" ? "remove" : "add", changed);
          } catch (err) {
            toast.show({
              message: t("membership.failed", { message: describeError(err).message }),
            });
          }
          await refresh();
        },
      });
      return true;
    },
    [core, queryClient, toast, t, tn, projects.data],
  );
}

/**
 * A menu of the projects plus "Neues Projekt …". Choosing the last entry swaps the trigger for a
 * title field; Enter creates the project and picks it.
 */
export function ProjectPicker({
  label,
  trigger,
  className,
  exclude = [],
  align,
  onPick,
}: {
  /** Accessible name of the trigger. */
  label: string;
  trigger: string;
  className?: string;
  /** Projects that are not offered, such as the ones an item is in already. */
  exclude?: readonly string[];
  align?: "start" | "end";
  onPick: (slug: string, title: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const list = useOp(projectsList, {});
  const create = useOpMutation(projectsCreate);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const projects = list.data?.projects ?? [];

  const close = () => {
    setCreating(false);
    setTitle("");
    setError(null);
  };

  if (creating) {
    return (
      <form
        className="inline-flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = title.trim();
          if (!name || create.isPending) return;
          const slug = slugFor(
            name,
            projects.map((p) => p.slug),
          );
          create.mutate(
            { slug, title: name },
            {
              onSuccess: () => {
                close();
                void onPick(slug, name);
              },
              onError: (err) => setError(describeError(err).message),
            },
          );
        }}
      >
        <Input
          autoFocus
          aria-label={t("membership.newProjectTitle")}
          placeholder={t("membership.newProjectTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          className="h-[26px] w-56"
        />
        <Button type="submit" size="sm" variant="primary" disabled={!title.trim()}>
          {t("membership.create")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          {t("membership.cancel")}
        </Button>
        {error ? (
          <span role="alert" className="text-[12px] text-danger">
            {error}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <Menu
      label={label}
      trigger={trigger}
      {...(className ? { className } : {})}
      {...(align ? { align } : {})}
      entries={[
        ...projects
          .filter((p) => !exclude.includes(p.slug))
          .map((p) => ({ label: p.title, onSelect: () => void onPick(p.slug, p.title) })),
        { label: t("membership.newProject"), onSelect: () => setCreating(true) },
      ]}
    />
  );
}

/**
 * The projects of an item as chips on one line. A chip opens the project; its x (visible on hover
 * and focus) takes the item out. "+ Projekt" opens the picker.
 */
export function ProjectChips({
  citekey,
  projects,
}: {
  citekey: string;
  projects: readonly string[];
}) {
  const { t } = useI18n();
  const list = useOp(projectsList, {});
  const change = useProjectMembership();
  const titleOf = (slug: string) => list.data?.projects.find((p) => p.slug === slug)?.title ?? slug;
  return (
    <>
      {projects.map((slug) => (
        <span key={slug} className="group inline-flex items-center">
          <Link to="/projects/$slug" params={{ slug }}>
            <Badge tone="outline">{titleOf(slug)}</Badge>
          </Link>
          <button
            type="button"
            aria-label={t("membership.removeChip", { project: titleOf(slug) })}
            onClick={() => void change("remove", slug, [citekey])}
            className="ml-0.5 inline-flex size-5 items-center justify-center text-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <ProjectPicker
        label={t("membership.addProjectLabel")}
        trigger={t("membership.addProject")}
        exclude={projects}
        className="inline-flex items-center border border-dashed border-line px-2 py-[3px] text-[12px] leading-[1.2] text-muted hover:border-ink hover:text-ink"
        onPick={(slug, title) => change("add", slug, [citekey], title).then(() => undefined)}
      />
    </>
  );
}
