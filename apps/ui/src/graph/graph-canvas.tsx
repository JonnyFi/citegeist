import type { GraphView } from "@citegeist/ops";
import type Graph from "graphology";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { buildGraph, type Palette, type Positions, readPalette } from "./model";

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

export interface GraphCanvasProps {
  view: GraphView;
  positions: Positions;
  edgeLabel: (id: string) => string;
  /** Edges whose label stays visible without hovering. */
  labelled: ReadonlySet<string>;
  selectedEdge?: string | undefined;
  focus?: string | undefined;
  onNode: (id: string, at: { x: number; y: number }) => void;
  onNodeMenu: (id: string, at: { x: number; y: number }) => void;
  onEdge: (id: string) => void;
  onStage: () => void;
}

interface Handlers {
  onNode: GraphCanvasProps["onNode"];
  onNodeMenu: GraphCanvasProps["onNodeMenu"];
  onEdge: GraphCanvasProps["onEdge"];
  onStage: GraphCanvasProps["onStage"];
}

/**
 * The graph on a sigma.js canvas. A click on a node or an edge goes to the screen, which decides
 * what happens; a right click opens the node menu. Without WebGL the canvas cannot start and a
 * message takes its place; the list of connections next to it still works.
 */
export default function GraphCanvas(props: GraphCanvasProps) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const handlers = useRef<Handlers>(props);
  handlers.current = props;
  const dark = useSyncExternalStore(subscribeTheme, isDark);
  const [failed, setFailed] = useState(false);
  const live = useRef<{ graph: Graph; palette: Palette } | undefined>(undefined);

  const palette = useMemo(() => {
    void dark;
    const css = getComputedStyle(document.documentElement);
    return readPalette((token) => css.getPropertyValue(token).trim());
  }, [dark]);

  const { view, positions, edgeLabel, labelled, selectedEdge, focus } = props;
  const next = useMemo(
    () =>
      buildGraph(view, positions, {
        palette,
        edgeLabel: (e) => edgeLabel(e.id),
        alwaysLabelled: (e) => labelled.has(e.id),
        selectedEdge,
        focus,
      }),
    [view, positions, palette, edgeLabel, labelled, selectedEdge, focus],
  );

  const latest = useRef(next);
  latest.current = next;

  // Updates the graph sigma draws in place, so the camera stays where the reader put it.
  useEffect(() => {
    const current = live.current;
    if (!current) return;
    current.graph.clear();
    current.graph.import(next.export());
  }, [next]);

  // The renderer starts once per theme; data changes go through the effect above.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let sigma: { kill(): void } | undefined;
    let cancelled = false;
    // sigma is loaded here and not at the top: its module refuses to load without WebGL2.
    Promise.all([import("sigma"), import("sigma/rendering")])
      .then(([{ default: Sigma, DEFAULT_STYLES }, rendering]) => {
        if (cancelled) return;
        const graph = latest.current.copy();
        const renderer = new Sigma(graph, el, {
          primitives: {
            edges: {
              paths: [rendering.pathLine()],
              extremities: [rendering.extremityArrow({ lengthRatio: 4, widthRatio: 3.5 })],
              variables: {
                dash: { type: "number", default: 1 },
                gap: { type: "number", default: 0 },
                solidColor: { type: "color", default: "#000000" },
              },
              // a solid line underneath, made transparent for dashed edges, and the dashes on top
              layers: [
                rendering.layerPlain({ color: { attribute: "solidColor" } }),
                rendering.layerDashed({
                  dashSize: { attribute: "dash", default: 1, mode: "pixels" },
                  gapSize: { attribute: "gap", default: 0, mode: "pixels" },
                }),
              ],
            },
          },
          settings: {
            renderEdgeLabels: true,
            enableEdgeEvents: true,
            edgeLabelAnchors: "allNodes",
            itemSizesReference: "screen",
            zoomToSizeRatioFunction: () => 1,
            stagePadding: 70,
            labelDensity: 0.6,
            labelGridCellSize: 120,
          },
          styles: {
            nodes: {
              ...DEFAULT_STYLES.nodes,
              labelVisibility: (attrs: Record<string, unknown>, state: { isHovered: boolean }) =>
                state.isHovered || attrs.forceLabel ? "visible" : "auto",
              labelColor: palette.ink,
              labelSize: 12,
              backdropColor: palette.surface,
              cursor: "pointer",
            },
            edges: {
              ...DEFAULT_STYLES.edges,
              head: { attribute: "head", defaultValue: "none" },
              dash: { attribute: "dash", defaultValue: 1 },
              gap: { attribute: "gap", defaultValue: 0 },
              solidColor: { attribute: "solidColor", defaultValue: "#000000" },
              label: (attrs: Record<string, unknown>, state: { isHovered: boolean }) =>
                String((state.isHovered ? attrs.hoverLabel : attrs.label) ?? ""),
              labelColor: palette.muted,
              labelSize: 11,
              labelBackgroundColor: palette.surface,
              labelBackgroundPadding: 2,
              cursor: "pointer",
            },
          },
        });
        sigma = renderer;
        live.current = { graph, palette };
        const at = (e: { x: number; y: number }) => {
          const box = el.getBoundingClientRect();
          return { x: box.left + e.x, y: box.top + e.y };
        };
        renderer.on("clickNode", ({ node, event }) => handlers.current.onNode(node, at(event)));
        renderer.on("rightClickNode", ({ node, event }) => {
          event.original.preventDefault();
          event.preventSigmaDefault();
          handlers.current.onNodeMenu(node, at(event));
        });
        renderer.on("clickEdge", ({ edge }) => {
          if (!graph.getEdgeAttribute(edge, "member")) handlers.current.onEdge(edge);
        });
        renderer.on("clickStage", () => handlers.current.onStage());
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      live.current = undefined;
      sigma?.kill();
    };
  }, [palette]);

  return (
    <div className="relative h-full min-h-80 w-full">
      <div
        ref={container}
        role="img"
        aria-label={t("graph.canvasLabel")}
        className="absolute inset-0"
        data-testid="graph-canvas"
        onContextMenu={(e) => e.preventDefault()}
      />
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-muted">
          {t("graph.noWebgl")}
        </p>
      ) : null}
    </div>
  );
}
