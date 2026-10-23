import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Neighbors } from "../connections/model";
import { useI18n } from "../i18n";
import { buildGraph, DARK_PALETTE, LIGHT_PALETTE } from "./model";

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

export interface GraphCanvasProps {
  data: Neighbors;
  center: string;
  onOpen: (id: string) => void;
}

/**
 * The graph on a sigma.js canvas: click a node to open it. Without WebGL the canvas cannot start
 * and the message takes its place; the node list next to it still works.
 */
export default function GraphCanvas({ data, center, onOpen }: GraphCanvasProps) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  const dark = useSyncExternalStore(subscribeTheme, isDark);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let sigma: { kill(): void } | undefined;
    let cancelled = false;
    // sigma is loaded here and not at the top: its module refuses to load without WebGL2.
    import("sigma")
      .then(({ default: Sigma, DEFAULT_STYLES }) => {
        if (cancelled) return;
        const graph = buildGraph(data, center, dark ? DARK_PALETTE : LIGHT_PALETTE);
        const css = getComputedStyle(document.documentElement);
        const ink = css.getPropertyValue("--ink").trim() || "#26231e";
        const surface = css.getPropertyValue("--surface").trim() || "#ffffff";
        const renderer = new Sigma(graph, el, {
          settings: {
            renderEdgeLabels: false,
            itemSizesReference: "screen",
            zoomToSizeRatioFunction: () => 1,
            stagePadding: 90,
          },
          styles: {
            nodes: { ...DEFAULT_STYLES.nodes, labelColor: ink, backdropColor: surface },
            edges: DEFAULT_STYLES.edges,
          },
        });
        sigma = renderer;
        renderer.on("clickNode", ({ node }) => open.current(node));
        renderer.on("enterNode", () => {
          el.style.cursor = "pointer";
        });
        renderer.on("leaveNode", () => {
          el.style.cursor = "";
        });
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      sigma?.kill();
    };
  }, [data, center, dark]);

  return (
    <div className="relative h-full min-h-80 w-full">
      <div
        ref={container}
        role="img"
        aria-label={t("graph.canvasLabel")}
        className="absolute inset-0"
        data-testid="graph-canvas"
      />
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-muted">
          {t("graph.noWebgl")}
        </p>
      ) : null}
    </div>
  );
}
