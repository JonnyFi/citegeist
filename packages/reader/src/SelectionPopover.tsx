import { autoUpdate, flip, offset, shift, useFloating } from "@floating-ui/react";
import { useLayoutEffect } from "react";

export interface SelectionPopoverProps {
  /** The live selection range; the popover follows it while the view scrolls. */
  range: Range;
  label: string;
  onAction: () => void;
}

/** Floating UI popover anchored to the selection, with the single "create card" action. */
export function SelectionPopover({ range, label, onAction }: SelectionPopoverProps) {
  const { refs, floatingStyles } = useFloating({
    open: true,
    placement: "top",
    strategy: "fixed",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const setPositionReference = refs.setPositionReference;
  useLayoutEffect(() => {
    setPositionReference({
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
    });
  }, [range, setPositionReference]);
  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className="cg-popover"
      role="toolbar"
      aria-label="Selection"
      // keep the text selection alive when the button is pressed
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" data-testid="selection-action" onClick={onAction}>
        {label}
      </button>
    </div>
  );
}
