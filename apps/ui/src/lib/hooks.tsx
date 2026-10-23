import type { OperationContract } from "@citegeist/ops";
import { itemsList } from "@citegeist/ops";
import {
  type Query,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import type { z } from "zod";
import type { Core } from "./core";

const CoreContext = createContext<Core | null>(null);

/** Provides the core to the tree and refetches everything shown when the library changes. */
export function CoreProvider({ core, children }: { core: Core; children: ReactNode }) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      core.subscribe((event) => {
        // Chat sessions stream many events; the chat panel refetches its own queries for them.
        if (event.path.startsWith("chat/")) return;
        void queryClient.invalidateQueries({ queryKey: ["op"] });
      }),
    [core, queryClient],
  );
  return <CoreContext.Provider value={core}>{children}</CoreContext.Provider>;
}

export function useCore(): Core {
  const core = useContext(CoreContext);
  if (!core) throw new Error("useCore must be used inside <CoreProvider>");
  return core;
}

/** Runs a read operation. The query key is the operation name plus its input. */
export function useOp<C extends OperationContract>(
  contract: C,
  input: z.input<C["input"]>,
  options: {
    enabled?: boolean;
    /** Milliseconds between refetches, or a function of the current data (false stops). */
    refetchInterval?: number | false | ((query: Query<z.output<C["output"]>>) => number | false);
  } = {},
): UseQueryResult<z.output<C["output"]>> {
  const core = useCore();
  return useQuery({
    queryKey: ["op", contract.name, input],
    queryFn: () => core.call(contract, input),
    enabled: options.enabled ?? true,
    ...(options.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
  });
}

/** Runs a write operation and refetches all shown data afterwards. */
export function useOpMutation<C extends OperationContract>(contract: C) {
  const core = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: z.input<C["input"]>) => core.call(contract, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["op"] }),
  });
}

type ItemsListInput = z.input<typeof itemsList.input>;

/** Pages of items.list; the cursor is the last citekey of the previous page. */
export function useItemPages(input: Omit<ItemsListInput, "cursor">) {
  const core = useCore();
  return useInfiniteQuery({
    queryKey: ["op", itemsList.name, input],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      core.call(itemsList, pageParam ? { ...input, cursor: pageParam } : input),
    getNextPageParam: (last) => last.next,
  });
}
