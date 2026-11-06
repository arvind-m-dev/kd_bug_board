// Deterministic conversion between BugFlow's plain text and Jira's description format (Atlassian Document
// Format, ADF). Pure: no network, no database.
//
// A synced Jira description is laid out as:
//   the bug description (plain paragraphs)
//   "Steps to reproduce"  — numbered list
//   "Expected result"     — paragraphs
//   "Actual result"       — paragraphs
//   "Bug Board details"   — one "Label: value" line each
// Each section starts at a heading with that exact title and runs to the next such heading. Reading a document
// built here gives back exactly the text that went in. Writing changes only the parts that are named and leaves
// every other node as Jira holds it, so an edit to one part never rewrites another.

export type AdfMark = { type: string; attrs?: Record<string, unknown> };
export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
  content?: AdfNode[];
};
export type AdfDoc = { type: "doc"; version: 1; content: AdfNode[] };

export const SECTION_TITLES = {
  steps: "Steps to reproduce",
  expected: "Expected result",
  actual: "Actual result",
  details: "Bug Board details",
} as const;
export type SectionKey = keyof typeof SECTION_TITLES;
const SECTION_ORDER: readonly SectionKey[] = ["steps", "expected", "actual", "details"];
/** The parts of a description: the free text plus the four sections. */
export type DescriptionPart = "description" | SectionKey;

export type DescriptionParts = {
  description: string;
  steps: string[];
  expected: string;
  actual: string;
  /** "Label: value" lines. */
  details: string[];
};

/** One spelling for comparison: unix newlines, no trailing spaces, at most one blank line, trimmed. */
export function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** A single line: all whitespace runs become one space. */
export const cleanLine = (value: string) => value.replace(/\s+/g, " ").trim();

function inline(text: string): AdfNode[] {
  const out: AdfNode[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) out.push({ type: "hardBreak" });
    if (line) out.push({ type: "text", text: line });
  });
  return out;
}
/** Plain text as paragraphs: a blank line starts a new paragraph, a single newline is a line break. */
export function paragraphs(text: string): AdfNode[] {
  const clean = cleanText(text);
  if (!clean) return [];
  return clean.split("\n\n").map((p) => ({ type: "paragraph", content: inline(p) }));
}
export const plainDoc = (text: string): AdfDoc => ({
  type: "doc",
  version: 1,
  content: paragraphs(text),
});

const heading = (title: string): AdfNode => ({
  type: "heading",
  attrs: { level: 3 },
  content: [{ type: "text", text: title }],
});
function sectionNodes(key: SectionKey, parts: DescriptionParts): AdfNode[] {
  if (key === "steps") {
    const steps = parts.steps.map(cleanText).filter(Boolean);
    if (!steps.length) return [];
    return [
      heading(SECTION_TITLES.steps),
      {
        type: "orderedList",
        attrs: { order: 1 },
        content: steps.map((s) => ({ type: "listItem", content: paragraphs(s) })),
      },
    ];
  }
  if (key === "details") {
    const lines = parts.details.map(cleanLine).filter(Boolean);
    if (!lines.length) return [];
    return [
      heading(SECTION_TITLES.details),
      { type: "paragraph", content: inline(lines.join("\n")) },
    ];
  }
  const body = paragraphs(parts[key]);
  return body.length ? [heading(SECTION_TITLES[key]), ...body] : [];
}

export function buildDescription(parts: DescriptionParts): AdfDoc {
  return {
    type: "doc",
    version: 1,
    content: [
      ...paragraphs(parts.description),
      ...SECTION_ORDER.flatMap((key) => sectionNodes(key, parts)),
    ],
  };
}

// ---- reading ----

type Text = { text: string; lossy: boolean };

function inlineText(nodes: AdfNode[] | undefined): Text {
  let text = "";
  let lossy = false;
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      text += n.text ?? "";
      if (n.marks?.length) lossy = true;
    } else if (n.type === "hardBreak") text += "\n";
    else {
      // Mentions, emoji, dates, smart links…: keep their visible text, and remember plain text cannot hold them.
      const a = n.attrs ?? {};
      const shown = a["text"] ?? a["shortName"] ?? a["url"] ?? "";
      text += typeof shown === "string" ? shown : "";
      lossy = true;
    }
  }
  return { text, lossy };
}

/** Block nodes as plain text. `lossy` is true when the nodes hold something plain text cannot (formatting, lists, media…). */
export function blocksText(nodes: AdfNode[] | undefined): Text {
  const out: string[] = [];
  let lossy = false;
  for (const n of nodes ?? []) {
    if (n.type === "paragraph") {
      const t = inlineText(n.content);
      lossy ||= t.lossy;
      out.push(t.text);
      continue;
    }
    lossy = true;
    if (n.type === "bulletList" || n.type === "orderedList") {
      (n.content ?? []).forEach((item, i) => {
        const t = blocksText(item.content).text;
        out.push(`${n.type === "orderedList" ? `${i + 1}.` : "-"} ${t}`);
      });
    } else if (n.type === "heading" || n.type === "codeBlock") out.push(inlineText(n.content).text);
    else if (n.content?.length) out.push(blocksText(n.content).text);
  }
  return { text: cleanText(out.filter((t) => t.trim()).join("\n\n")), lossy };
}

function asDoc(value: unknown): AdfNode[] {
  if (!value || typeof value !== "object") return [];
  const doc = value as { type?: unknown; content?: unknown };
  return doc.type === "doc" && Array.isArray(doc.content) ? (doc.content as AdfNode[]) : [];
}
function sectionOf(node: AdfNode): SectionKey | null {
  if (node.type !== "heading") return null;
  const title = cleanLine(inlineText(node.content).text).toLowerCase();
  return SECTION_ORDER.find((k) => SECTION_TITLES[k].toLowerCase() === title) ?? null;
}
/** The document's top-level nodes, split at the section headings. Section node lists include their heading. */
function split(value: unknown): {
  free: AdfNode[];
  sections: Partial<Record<SectionKey, AdfNode[]>>;
} {
  const free: AdfNode[] = [];
  const sections: Partial<Record<SectionKey, AdfNode[]>> = {};
  let current: AdfNode[] = free;
  for (const node of asDoc(value)) {
    const key = sectionOf(node);
    // A repeated heading does not start a second copy: its nodes stay with the first one.
    if (key && !sections[key]) current = sections[key] = [];
    current.push(node);
  }
  return { free, sections };
}

/** The items of the lists in these nodes. Text typed without a list counts as one item per paragraph. */
function listItems(nodes: AdfNode[]): { items: string[]; lossy: boolean } {
  const items: string[] = [];
  let lossy = false;
  for (const node of nodes) {
    if (node.type === "orderedList" || node.type === "bulletList") {
      for (const item of node.content ?? []) {
        const t = blocksText(item.content);
        lossy ||= t.lossy;
        if (t.text) items.push(t.text);
      }
    } else {
      const t = blocksText([node]);
      lossy = true;
      if (t.text) items.push(t.text);
    }
  }
  return { items, lossy };
}
/** For a custom field that holds rich text: the whole document as plain text, or as list items. */
export const docText = (value: unknown) => blocksText(asDoc(value));
export const docList = (value: unknown) => listItems(asDoc(value));
export const listDoc = (items: string[]): AdfDoc => ({
  type: "doc",
  version: 1,
  content: sectionNodes("steps", {
    description: "",
    steps: items,
    expected: "",
    actual: "",
    details: [],
  }).slice(1),
});

export type ReadDescription = DescriptionParts & {
  /** Parts whose Jira content holds something plain text cannot: rewriting them would lose it. */
  lossy: Record<DescriptionPart, boolean>;
};

/** A Jira description (ADF, or null) as BugFlow's parts. A description not laid out by BugFlow is all free text. */
export function readDescription(value: unknown): ReadDescription {
  const { free, sections } = split(value);
  const body = (key: SectionKey) => (sections[key] ?? []).slice(1);
  const description = blocksText(free);
  const expected = blocksText(body("expected"));
  const actual = blocksText(body("actual"));

  const steps = listItems(body("steps"));
  // The details section is BugFlow's own: links and formatting there are regenerated, never preserved.
  const details = blocksText(body("details")).text.split("\n").map(cleanLine).filter(Boolean);
  return {
    description: description.text,
    steps: steps.items,
    expected: expected.text,
    actual: actual.text,
    details,
    lossy: {
      description: description.lossy,
      steps: steps.lossy,
      expected: expected.lossy,
      actual: actual.lossy,
      details: false,
    },
  };
}

/**
 * The current Jira description with only the named parts replaced. Every other node is returned exactly as given,
 * so content BugFlow did not write survives. Sections come out in the standard order.
 */
export function patchDescription(current: unknown, changes: Partial<DescriptionParts>): AdfDoc {
  const { free, sections } = split(current);
  const parts: DescriptionParts = {
    description: "",
    steps: [],
    expected: "",
    actual: "",
    details: [],
    ...changes,
  };
  return {
    type: "doc",
    version: 1,
    content: [
      ...(changes.description === undefined ? free : paragraphs(changes.description)),
      ...SECTION_ORDER.flatMap((key) =>
        changes[key] === undefined ? (sections[key] ?? []) : sectionNodes(key, parts),
      ),
    ],
  };
}

/** `Label: value` out of the details lines; "" when the label is absent. */
export function detail(lines: string[], label: string): string {
  const prefix = `${label.toLowerCase()}:`;
  const line = lines.find((l) => l.toLowerCase().startsWith(prefix));
  return line ? cleanLine(line.slice(prefix.length)) : "";
}
