import { Library } from "lucide-react";
import type { CitegeistBridge } from "../bridge";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/states";

/** Shown by the desktop app until a library folder is open. */
export function Welcome({ bridge }: { bridge: CitegeistBridge }) {
  return (
    <div className="drag-region flex h-full items-center justify-center">
      <EmptyState
        icon={<Library className="size-8" />}
        title="Open a library"
        description="A library is a folder with your papers, notes and citations as plain files."
        action={
          <div className="no-drag flex gap-2">
            <Button variant="primary" onClick={() => void bridge.openLibrary()}>
              Open library
            </Button>
            <Button onClick={() => void bridge.createLibrary()}>New library</Button>
          </div>
        }
      />
    </div>
  );
}
