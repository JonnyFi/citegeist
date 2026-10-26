import type { PlanTemplate } from "@citegeist/schema";

export interface TemplateNode {
  title: string;
  purpose: string;
  children?: TemplateNode[];
}

export interface Template {
  title: string;
  nodes: TemplateNode[];
}

export type TemplateLanguage = "de" | "en";

/** The language of a template: German for "de" and its variants such as "de-AT", English for anything else. */
export function templateLanguage(language: string | undefined): TemplateLanguage {
  return language?.toLowerCase().split(/[-_]/)[0] === "de" ? "de" : "en";
}

const EXPOSE_DE: Template = {
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
};

const EXPOSE_EN: Template = {
  title: "Proposal",
  nodes: [
    {
      title: "Introduction and problem statement",
      purpose: "Introduces the topic and explains why the problem needs research.",
      children: [
        {
          title: "Background",
          purpose: "Describes the context and the observation that prompts the project.",
        },
        { title: "Relevance", purpose: "Shows for whom the answer changes something." },
      ],
    },
    {
      title: "State of research",
      purpose: "Organizes the existing literature and names the gap.",
      children: [
        {
          title: "Current state",
          purpose: "Summarizes what the literature shows so far.",
        },
        { title: "Research gap", purpose: "Names what remains open and why that matters." },
      ],
    },
    {
      title: "Research questions",
      purpose: "Formulates the questions and, where they fit, hypotheses.",
    },
    {
      title: "Theoretical framework",
      purpose: "Fixes the concepts and theories the work builds on.",
    },
    {
      title: "Methodological approach",
      purpose: "Describes design, data and analysis.",
      children: [
        { title: "Research design", purpose: "Justifies the choice of approach." },
        { title: "Data and analysis", purpose: "Names the data basis and the analysis methods." },
      ],
    },
    { title: "Timeline", purpose: "Sets work packages and milestones." },
    { title: "Preliminary outline", purpose: "Sketches the chapters of the later thesis." },
  ],
};

const IMRAD_DE: Template = {
  title: "IMRaD",
  nodes: [
    {
      title: "Einleitung",
      purpose: "Benennt das Problem, die Lücke und das Ziel des Papers.",
      children: [
        { title: "Hintergrund", purpose: "Fasst zusammen, was zum Thema bekannt ist." },
        {
          title: "Lücke und Ziel",
          purpose: "Benennt, was fehlt und was dieses Paper dagegen tut.",
        },
      ],
    },
    {
      title: "Methoden",
      purpose: "Beschreibt die Durchführung so, dass andere sie wiederholen können.",
      children: [
        { title: "Design", purpose: "Erklärt das Studiendesign und warum es zur Frage passt." },
        { title: "Daten", purpose: "Beschreibt Quellen, Stichprobe und Erhebung." },
        { title: "Auswertung", purpose: "Beschreibt, wie die Daten ausgewertet wurden." },
      ],
    },
    { title: "Ergebnisse", purpose: "Berichtet, was gefunden wurde, ohne zu deuten." },
    {
      title: "Diskussion",
      purpose: "Deutet die Ergebnisse und ordnet sie in die Literatur ein.",
      children: [
        {
          title: "Befunde im Kontext",
          purpose: "Setzt die Ergebnisse zu früheren Arbeiten in Bezug.",
        },
        { title: "Grenzen", purpose: "Benennt die Grenzen der Studie." },
        { title: "Folgerungen", purpose: "Sagt, was für Theorie und Praxis folgt." },
      ],
    },
  ],
};

const IMRAD_EN: Template = {
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
};

/**
 * Starting outlines (docs/decisions/0019-multiple-plans-and-templates.md), in German and in
 * English. A new plan takes the language of its project's AI language, else the library's.
 * More text types arrive later as further entries.
 */
export const TEMPLATES: Record<TemplateLanguage, Record<PlanTemplate, Template>> = {
  de: { expose: EXPOSE_DE, imrad: IMRAD_DE },
  en: { expose: EXPOSE_EN, imrad: IMRAD_EN },
};
