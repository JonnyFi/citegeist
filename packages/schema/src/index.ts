import { z } from "zod";

export const name = "@citegeist/schema";

export const placeholderSchema = z.object({ id: z.string() });
