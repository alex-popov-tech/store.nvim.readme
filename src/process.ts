import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import { visit, SKIP } from "unist-util-visit";
import { decode } from "html-entities";
import type { Plugin } from "unified";
import type {
  Root,
  Html,
  Image,
  Link,
  Heading,
  Paragraph,
  PhrasingContent,
  RootContent,
} from "mdast";

// Badge URL patterns — ported from store.nvim's Lua patterns
const BADGE_PATTERNS: RegExp[] = [
  /img\.shields\.io/,
  /badge\.fury\.io/,
  /badgen\.net/,
  /badges\.gitter\.im/,
  /github\.com\/[^)]+\/actions\/workflows\/[^)]+\/badge/,
  /github\.com\/[^)]+\/workflows\/[^)]+\/badge/,
  /github\.com\/[^)]+\/badge/,
  /codecov\.io/,
  /coveralls\.io/,
  /travis-ci/,
  /circleci\.com/,
];

// Extensions unsupported by kitty image protocol
const UNSUPPORTED_IMAGE_PATTERN = /\.(svg|gif)(\?|#|$)/i;

function isBadgeUrl(url: string): boolean {
  return BADGE_PATTERNS.some((p) => p.test(url));
}

function isUnsupportedImageUrl(url: string): boolean {
  return UNSUPPORTED_IMAGE_PATTERN.test(url);
}

/**
 * Extract src attribute from an <img> HTML tag.
 * Handles double-quoted, single-quoted, and unquoted src values.
 */
function extractImgSrc(html: string): string | null {
  const match = html.match(
    /<\s*img\s+[^>]*?src\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))[^>]*\/?>/i,
  );
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Convert HTML <img> tags to MDAST image nodes so downstream plugins
 * can handle all images uniformly.
 */
const remarkConvertImgTags: Plugin<[], Root> = () => (tree) => {
  visit(tree, "html", (node: Html, index, parent) => {
    if (!parent || index === undefined) return;

    // Handle HTML nodes that contain <img> tags
    const imgTagPattern = /<\s*img\s+[^>]*\/?>/gi;
    const imgTags = node.value.match(imgTagPattern);
    if (!imgTags) return;

    // Wrap each image in a paragraph so it's block-level
    const newNodes: RootContent[] = [];

    for (const tag of imgTags) {
      const src = extractImgSrc(tag);
      if (src) {
        newNodes.push({
          type: "paragraph",
          children: [
            {
              type: "image",
              url: src,
              alt: "",
              title: null,
            },
          ],
        });
      }
    }

    // If the HTML node was purely img tags, replace with paragraph-wrapped image nodes.
    // If it had other content mixed in, strip the img tags and keep the rest.
    const stripped = node.value.replace(imgTagPattern, "").trim();
    if (stripped) {
      // Keep the remaining HTML content, add image nodes after it
      node.value = stripped;
      parent.children.splice(index + 1, 0, ...newNodes);
    } else if (newNodes.length > 0) {
      // Pure img tag(s) — replace the HTML node entirely
      parent.children.splice(index, 1, ...newNodes);
    } else {
      // img tags but no src found — remove the node
      parent.children.splice(index, 1);
    }

    return [SKIP, index] as const;
  });
};

/**
 * Remove badge images (shields.io, badge.fury.io, etc.).
 * Handles both standalone images and images wrapped in links.
 */
const remarkRemoveBadges: Plugin<[], Root> = () => (tree) => {
  // First pass: remove links that wrap badge images ([![badge](url)](link))
  visit(tree, "link", (node: Link, index, parent) => {
    if (!parent || index === undefined) return;

    const hasOnlyBadgeImage =
      node.children.length === 1 &&
      node.children[0].type === "image" &&
      isBadgeUrl(node.children[0].url);

    if (hasOnlyBadgeImage) {
      parent.children.splice(index, 1);
      return [SKIP, index] as const;
    }
  });

  // Second pass: remove standalone badge images
  visit(tree, "image", (node: Image, index, parent) => {
    if (!parent || index === undefined) return;

    if (isBadgeUrl(node.url)) {
      parent.children.splice(index, 1);
      return [SKIP, index] as const;
    }
  });
};

/**
 * Remove images with extensions unsupported by kitty image protocol (.svg, .gif).
 * Same linked + standalone pattern as badge removal.
 */
const remarkRemoveUnsupportedImages: Plugin<[], Root> = () => (tree) => {
  // Remove links wrapping unsupported images
  visit(tree, "link", (node: Link, index, parent) => {
    if (!parent || index === undefined) return;

    const hasOnlyUnsupportedImage =
      node.children.length === 1 &&
      node.children[0].type === "image" &&
      isUnsupportedImageUrl(node.children[0].url);

    if (hasOnlyUnsupportedImage) {
      parent.children.splice(index, 1);
      return [SKIP, index] as const;
    }
  });

  // Remove standalone unsupported images
  visit(tree, "image", (node: Image, index, parent) => {
    if (!parent || index === undefined) return;

    if (isUnsupportedImageUrl(node.url)) {
      parent.children.splice(index, 1);
      return [SKIP, index] as const;
    }
  });
};

/**
 * Strip all tags from an HTML string, returning only text content.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * Convert HTML nodes to their markdown equivalents where possible,
 * extract text content otherwise, or drop if empty.
 *
 * - <h1>-<h6> → heading node with correct depth
 * - <p> → paragraph node
 * - everything else → paragraph with extracted text, or dropped if empty
 *
 * Code blocks are already safe — remark parses them as `code` nodes, not `html`.
 */
const remarkConvertHtml: Plugin<[], Root> = () => (tree) => {
  visit(tree, "html", (node: Html, index, parent) => {
    if (!parent || index === undefined) return;

    const value = node.value;
    const replacements: RootContent[] = [];

    // Try <h1>-<h6> conversion
    const headingMatch = value.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (headingMatch) {
      const depth = parseInt(headingMatch[1], 10) as Heading["depth"];
      const text = stripTags(headingMatch[2]);
      if (text) {
        replacements.push({
          type: "heading",
          depth,
          children: [{ type: "text", value: text }],
        });
      }
    }

    // Try <p> conversion
    const pMatches = value.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const m of pMatches) {
      const text = stripTags(m[1]);
      if (text) {
        replacements.push({
          type: "paragraph",
          children: [{ type: "text", value: text }],
        });
      }
    }

    // If we found semantic elements, use them
    if (replacements.length > 0) {
      parent.children.splice(index, 1, ...replacements);
      return [SKIP, index] as const;
    }

    // Fallback: strip all tags, keep text if non-empty
    const text = stripTags(value);
    if (text) {
      const paragraph: Paragraph = {
        type: "paragraph",
        children: [{ type: "text", value: text }],
      };
      parent.children.splice(index, 1, paragraph);
    } else {
      parent.children.splice(index, 1);
    }
    return [SKIP, index] as const;
  });
};

/**
 * Post-stringify cleanup:
 * - Decode HTML entities
 * - Collapse consecutive blank lines to max 1
 * - Strip leading/trailing blank lines
 */
function postProcess(text: string): string {
  // Decode HTML entities
  let result = decode(text);

  // Collapse consecutive blank lines to max 1
  result = result.replace(/\n{3,}/g, "\n\n");

  // Strip leading blank lines
  result = result.replace(/^\n+/, "");

  // Strip trailing whitespace but keep single final newline
  result = result.replace(/\n*\s*$/, "\n");

  return result;
}

// Build the unified pipeline once
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkConvertImgTags)
  .use(remarkRemoveBadges)
  .use(remarkRemoveUnsupportedImages)
  .use(remarkConvertHtml)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    rule: "-",
  });

/**
 * Process a raw README markdown string into cleaned markdown.
 */
export async function processReadme(raw: string): Promise<string> {
  const file = await processor.process(raw);
  return postProcess(String(file));
}

// Re-export for testing individual pieces
export {
  BADGE_PATTERNS,
  UNSUPPORTED_IMAGE_PATTERN,
  isBadgeUrl,
  isUnsupportedImageUrl,
  extractImgSrc,
  remarkConvertImgTags,
  remarkRemoveBadges,
  remarkRemoveUnsupportedImages,
  remarkConvertHtml,
  postProcess,
};
