import {
  chatBackends,
  chatCancel,
  chatGet,
  chatList,
  chatRevertTurn,
  chatSave,
  chatSend,
  chatStart,
  type Registry,
  researchStart,
} from "@citegeist/ops";
import { type JobQueuePort, registerResearch } from "./research.js";
import type { ChatService } from "./service.js";
import { chatError } from "./util.js";

export interface ChatOperationsDeps {
  service: ChatService;
  /** The core's job queue. Without it `research.start` is not bound. */
  queue?: JobQueuePort;
}

/**
 * Binds the chat operations, and `research.start` when a job queue is given, to a registry. The
 * core's runtime calls this once per library (see the change requests of W3.3).
 */
export function bindChatOperations<R extends Registry>(registry: R, deps: ChatOperationsDeps): R {
  const { service, queue } = deps;
  registry
    .bind(chatBackends, async () => service.backends())
    .bind(chatStart, async (_ctx, input) => ({
      session: service.create({
        backend: input.backend,
        title: input.title,
        project: input.project,
        item: input.item,
        selection: input.selection,
      }),
    }))
    .bind(chatSend, async (_ctx, input) =>
      service.send(input.session, input.message, input.context),
    )
    .bind(chatCancel, async (_ctx, input) => {
      service.cancel(input.session);
      return { ok: true as const };
    })
    .bind(chatList, async (_ctx, input) => ({
      sessions: service.list({ project: input.project, kind: input.kind, limit: input.limit }),
    }))
    .bind(chatGet, async (_ctx, input) => service.get(input.session))
    .bind(chatRevertTurn, async (_ctx, input) => service.revertTurn(input.session, input.turn))
    .bind(chatSave, async (_ctx, input) => service.save(input.session));

  if (queue) {
    registerResearch(queue, service);
    registry.bind(researchStart, async (ctx, input) => {
      if (input.backend && !service.drivers.definition(input.backend)) {
        throw chatError(
          "CHAT_UNKNOWN_BACKEND",
          `No chat backend named ${input.backend}.`,
          `Use one of: ${service.drivers
            .definitions()
            .map((d) => d.id)
            .join(", ")}.`,
        );
      }
      const job = queue.enqueue({
        kind: "research",
        input: {
          prompt: input.prompt,
          ...(input.project ? { project: input.project } : {}),
          ...(input.backend ? { backend: input.backend } : {}),
          maxItems: input.maxItems,
        },
        by: ctx.actor,
        maxAttempts: 1,
      });
      return { job: job.id };
    });
  }
  return registry;
}
