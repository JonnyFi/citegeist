import type { PlanTemplate } from "@citegeist/schema";

export interface TemplateNode {
  title: string;
  purpose: string;
  children?: TemplateNode[];
}

/** Starting outlines (docs/decisions/0019-multiple-plans-and-templates.md). More text types arrive later as further entries. */
export const TEMPLATES: Record<PlanTemplate, { title: string; nodes: TemplateNode[] }> = {
  expose: {
    title: "Exposé",
    nodes: [
      {
        title: "Einleitung und Problemstellung",
        purpose: "Führt in das Thema ein und begründet, warum das Problem Forschung braucht.",
        children: [
          {
            title: "Ausgangslage",
            purpose: "Beschreibt den Kontext und die Beobachtung, die den Anlass gibt.",
          },
          { title: "Relevanz", purpose: "Zeigt, für wen die Antwort etwas ändert." },
        ],
      },
      {
        title: "Forschungsstand",
        purpose: "Ordnet die vorhandene Literatur und benennt die Lücke.",
        children: [
          {
            title: "Stand der Forschung",
            purpose: "Fasst zusammen, was die Literatur bisher zeigt.",
          },
          { title: "Forschungslücke", purpose: "Benennt, was offen bleibt und warum das zählt." },
        ],
      },
      {
        title: "Forschungsfragen",
        purpose: "Formuliert die Fragen und, wo es passt, Hypothesen.",
      },
      {
        title: "Theoretischer Rahmen",
        purpose: "Legt die Begriffe und Theorien fest, auf denen die Arbeit aufbaut.",
      },
      {
        title: "Methodisches Vorgehen",
        purpose: "Beschreibt Design, Daten und Auswertung.",
        children: [
          { title: "Forschungsdesign", purpose: "Begründet die Wahl des Vorgehens." },
          { title: "Daten und Auswertung", purpose: "Nennt Datenbasis und Auswertungsverfahren." },
        ],
      },
      { title: "Zeitplan", purpose: "Legt Arbeitspakete und Meilensteine fest." },
      { title: "Vorläufige Gliederung", purpose: "Skizziert die Kapitel der späteren Arbeit." },
    ],
  },
  imrad: {
    title: "IMRaD",
    nodes: [
      {
        title: "Introduction",
        purpose: "States the problem, the gap and the aim of the paper.",
        children: [
          { title: "Background", purpose: "Summarizes what is known on the topic." },
          {
            title: "Gap and aim",
            purpose: "Names what is missing and what this paper does about it.",
          },
        ],
      },
      {
        title: "Methods",
        purpose: "Describes how the study was done so that others can repeat it.",
        children: [
          { title: "Design", purpose: "Explains the study design and why it fits the question." },
          { title: "Data", purpose: "Describes sources, sample and collection." },
          { title: "Analysis", purpose: "Describes how the data was analyzed." },
        ],
      },
      { title: "Results", purpose: "Reports what was found, without interpretation." },
      {
        title: "Discussion",
        purpose: "Interprets the results and places them in the literature.",
        children: [
          { title: "Findings in context", purpose: "Relates the results to earlier work." },
          { title: "Limitations", purpose: "Names the limits of the study." },
          { title: "Implications", purpose: "Says what follows for theory and practice." },
        ],
      },
    ],
  },
};
