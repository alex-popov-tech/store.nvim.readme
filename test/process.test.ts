import { describe, it, expect } from "vitest";
import {
  processReadme,
  isBadgeUrl,
  isUnsupportedImageUrl,
  extractImgSrc,
  postProcess,
} from "../src/process.js";

describe("extractImgSrc", () => {
  it("extracts double-quoted src", () => {
    expect(extractImgSrc('<img src="https://example.com/img.png">')).toBe(
      "https://example.com/img.png",
    );
  });

  it("extracts single-quoted src", () => {
    expect(extractImgSrc("<img src='https://example.com/img.png'>")).toBe(
      "https://example.com/img.png",
    );
  });

  it("handles self-closing tags", () => {
    expect(extractImgSrc('<img src="https://example.com/img.png" />')).toBe(
      "https://example.com/img.png",
    );
  });

  it("handles extra attributes", () => {
    expect(
      extractImgSrc(
        '<img alt="logo" src="https://example.com/img.png" width="200">',
      ),
    ).toBe("https://example.com/img.png");
  });

  it("returns null for no src", () => {
    expect(extractImgSrc("<img alt='no src'>")).toBe(null);
  });

  it("returns null for non-img tag", () => {
    expect(extractImgSrc("<div>hello</div>")).toBe(null);
  });
});

describe("isBadgeUrl", () => {
  it("matches shields.io", () => {
    expect(isBadgeUrl("https://img.shields.io/badge/build-passing-green")).toBe(
      true,
    );
  });

  it("matches badge.fury.io", () => {
    expect(isBadgeUrl("https://badge.fury.io/rb/rails.svg")).toBe(true);
  });

  it("matches GitHub Actions badge", () => {
    expect(
      isBadgeUrl(
        "https://github.com/user/repo/actions/workflows/ci.yml/badge.svg",
      ),
    ).toBe(true);
  });

  it("matches codecov", () => {
    expect(isBadgeUrl("https://codecov.io/gh/user/repo/branch/main")).toBe(
      true,
    );
  });

  it("matches travis-ci", () => {
    expect(isBadgeUrl("https://travis-ci.org/user/repo.svg")).toBe(true);
  });

  it("does not match normal image URLs", () => {
    expect(isBadgeUrl("https://example.com/screenshot.png")).toBe(false);
  });
});

describe("isUnsupportedImageUrl", () => {
  it("matches .svg", () => {
    expect(isUnsupportedImageUrl("https://example.com/logo.svg")).toBe(true);
  });

  it("matches .gif", () => {
    expect(isUnsupportedImageUrl("https://example.com/demo.gif")).toBe(true);
  });

  it("matches .svg with query string", () => {
    expect(isUnsupportedImageUrl("https://example.com/logo.svg?v=2")).toBe(
      true,
    );
  });

  it("matches .GIF case-insensitive", () => {
    expect(isUnsupportedImageUrl("https://example.com/demo.GIF")).toBe(true);
  });

  it("does not match .png", () => {
    expect(isUnsupportedImageUrl("https://example.com/img.png")).toBe(false);
  });

  it("does not match .jpg", () => {
    expect(isUnsupportedImageUrl("https://example.com/img.jpg")).toBe(false);
  });
});

describe("postProcess", () => {
  it("decodes HTML entities", () => {
    expect(postProcess("Tom &amp; Jerry\n")).toBe("Tom & Jerry\n");
  });

  it("decodes numeric entities", () => {
    expect(postProcess("quote: &#39;\n")).toBe("quote: '\n");
  });

  it("collapses 3+ blank lines to 1", () => {
    expect(postProcess("a\n\n\n\nb\n")).toBe("a\n\nb\n");
  });

  it("strips leading blank lines", () => {
    expect(postProcess("\n\nhello\n")).toBe("hello\n");
  });
});

describe("processReadme", () => {
  describe("img tag conversion", () => {
    it("converts <img> with double-quoted src to markdown image", async () => {
      const input = '<img src="https://example.com/logo.png">';
      const result = await processReadme(input);
      expect(result).toContain("![](https://example.com/logo.png)");
    });

    it("converts <img> with single-quoted src", async () => {
      const input = "<img src='https://example.com/logo.png'>";
      const result = await processReadme(input);
      expect(result).toContain("![](https://example.com/logo.png)");
    });

    it("converts <img> with extra attributes", async () => {
      const input =
        '<img alt="screenshot" src="https://example.com/screen.png" width="600">';
      const result = await processReadme(input);
      expect(result).toContain("![](https://example.com/screen.png)");
    });

    it("removes <img> without src", async () => {
      const input = "before\n\n<img alt='no source'>\n\nafter";
      const result = await processReadme(input);
      expect(result).not.toContain("<img");
      expect(result).toContain("before");
      expect(result).toContain("after");
    });
  });

  describe("badge removal", () => {
    it("removes standalone shields.io badge", async () => {
      const input =
        "# Title\n\n![build](https://img.shields.io/badge/build-passing-green)\n\nContent here";
      const result = await processReadme(input);
      expect(result).not.toContain("shields.io");
      expect(result).toContain("# Title");
      expect(result).toContain("Content here");
    });

    it("removes linked shields.io badge", async () => {
      const input =
        "[![CI](https://img.shields.io/badge/ci-passing-green)](https://github.com/user/repo/actions)";
      const result = await processReadme(input);
      expect(result).not.toContain("shields.io");
      expect(result).not.toContain("[CI]");
    });

    it("removes codecov badge", async () => {
      const input =
        "![coverage](https://codecov.io/gh/user/repo/branch/main/graph/badge.svg)";
      const result = await processReadme(input);
      expect(result).not.toContain("codecov");
    });

    it("removes GitHub Actions badge", async () => {
      const input =
        "![CI](https://github.com/user/repo/actions/workflows/ci.yml/badge.svg)";
      const result = await processReadme(input);
      expect(result).not.toContain("badge.svg");
    });

    it("preserves non-badge images", async () => {
      const input = "![screenshot](https://example.com/screenshot.png)";
      const result = await processReadme(input);
      expect(result).toContain("![screenshot](https://example.com/screenshot.png)");
    });
  });

  describe("unsupported image removal", () => {
    it("removes .svg images", async () => {
      const input = "![logo](https://example.com/logo.svg)";
      const result = await processReadme(input);
      expect(result).not.toContain("logo.svg");
    });

    it("removes .gif images", async () => {
      const input = "![demo](https://example.com/demo.gif)";
      const result = await processReadme(input);
      expect(result).not.toContain("demo.gif");
    });

    it("removes linked svg images", async () => {
      const input =
        "[![logo](https://example.com/logo.svg)](https://example.com)";
      const result = await processReadme(input);
      expect(result).not.toContain("logo.svg");
    });

    it("removes .svg with query string", async () => {
      const input = "![icon](https://example.com/icon.svg?v=2)";
      const result = await processReadme(input);
      expect(result).not.toContain("icon.svg");
    });

    it("preserves .png images", async () => {
      const input = "![photo](https://example.com/photo.png)";
      const result = await processReadme(input);
      expect(result).toContain("![photo](https://example.com/photo.png)");
    });

    it("preserves .jpg images", async () => {
      const input = "![photo](https://example.com/photo.jpg)";
      const result = await processReadme(input);
      expect(result).toContain("![photo](https://example.com/photo.jpg)");
    });
  });

  describe("HTML conversion", () => {
    it("converts <h3> to ### heading", async () => {
      const input = "<h3 align='center'>My Plugin</h3>";
      const result = await processReadme(input);
      expect(result).toContain("### My Plugin");
      expect(result).not.toContain("<h3");
    });

    it("converts <h1> to # heading", async () => {
      const input = "<h1>Title</h1>";
      const result = await processReadme(input);
      expect(result).toContain("# Title");
    });

    it("converts <h2> to ## heading", async () => {
      const input = "<h2>Section</h2>";
      const result = await processReadme(input);
      expect(result).toContain("## Section");
    });

    it("converts <p> to paragraph text", async () => {
      const input = "<p align='center'>Some text</p>";
      const result = await processReadme(input);
      expect(result).toContain("Some text");
      expect(result).not.toContain("<p");
    });

    it("strips inner tags from <p>", async () => {
      const input = "<p><strong>Bold text</strong> and normal</p>";
      const result = await processReadme(input);
      expect(result).toContain("Bold text and normal");
      expect(result).not.toContain("<strong>");
    });

    it("strips inner tags from headings", async () => {
      const input = '<h3><a href="https://example.com">Plugin Name</a></h3>';
      const result = await processReadme(input);
      expect(result).toContain("### Plugin Name");
    });

    it("extracts text from <div>", async () => {
      const input = "<div>Hello world</div>";
      const result = await processReadme(input);
      expect(result).toContain("Hello world");
      expect(result).not.toContain("<div>");
    });

    it("drops empty <br> tags", async () => {
      const input = "line one<br>line two";
      const result = await processReadme(input);
      expect(result).not.toContain("<br>");
    });

    it("extracts text from <details>", async () => {
      const input =
        "<details>\n<summary>Click me</summary>\nHidden content\n</details>";
      const result = await processReadme(input);
      expect(result).not.toContain("<details>");
      expect(result).not.toContain("<summary>");
      expect(result).toContain("Click me");
      expect(result).toContain("Hidden content");
    });

    it("preserves heading + description from centered HTML layout", async () => {
      const input =
        "<h3 align='center'>\nMy Plugin Name\n</h3>\n\n<p align='center'>\nA description of the plugin\n</p>\n\n## Features\n\n- Feature one";
      const result = await processReadme(input);
      expect(result).toContain("### My Plugin Name");
      expect(result).toContain("A description of the plugin");
      expect(result).toContain("## Features");
    });
  });

  describe("code block preservation", () => {
    it("preserves HTML inside fenced code blocks", async () => {
      const input =
        "# Example\n\n```html\n<div class='container'>\n  <img src='test.png'>\n</div>\n```\n";
      const result = await processReadme(input);
      expect(result).toContain("<div class='container'>");
      expect(result).toContain("<img src='test.png'>");
    });

    it("preserves inline code with HTML", async () => {
      const input = "Use `<img>` for images";
      const result = await processReadme(input);
      expect(result).toContain("`<img>`");
    });

    it("preserves code block content verbatim", async () => {
      const input =
        '```lua\nlocal x = "hello"\nprint(x)\n```';
      const result = await processReadme(input);
      expect(result).toContain('local x = "hello"');
      expect(result).toContain("print(x)");
    });
  });

  describe("HTML entity decoding", () => {
    it("decodes &amp;", async () => {
      const input = "Tom &amp; Jerry";
      const result = await processReadme(input);
      expect(result).toContain("Tom & Jerry");
    });

    it("decodes &lt; and &gt;", async () => {
      const input = "Use &lt;img&gt; tag";
      const result = await processReadme(input);
      // remark-stringify escapes < to \< to prevent HTML interpretation
      expect(result).toContain("Use \\<img> tag");
    });

    it("decodes numeric entities", async () => {
      const input = "Quote: &#39;hello&#39;";
      const result = await processReadme(input);
      expect(result).toContain("Quote: 'hello'");
    });
  });

  describe("empty line collapsing", () => {
    it("collapses multiple empty lines to one", async () => {
      const input = "# Title\n\n\n\n\nContent";
      const result = await processReadme(input);
      // Should not have more than one empty line between content
      expect(result).not.toMatch(/\n{3,}/);
    });

    it("strips leading blank lines", async () => {
      const input = "\n\n\n# Title\n";
      const result = await processReadme(input);
      expect(result).toMatch(/^#/);
    });
  });

  describe("real-world smoke tests", () => {
    it("handles a README with badges, HTML, and code blocks", async () => {
      const input = `
<p align="center">
  <img src="https://example.com/logo.svg" width="200">
</p>

# My Plugin

[![CI](https://img.shields.io/badge/ci-passing-green)](https://github.com/user/repo)
[![Coverage](https://codecov.io/gh/user/repo/badge.svg)](https://codecov.io/gh/user/repo)

A great Neovim plugin for doing things.

## Installation

![demo](https://example.com/demo.gif)

\`\`\`lua
require("my-plugin").setup({
  option = true,
})
\`\`\`

## Features

- Feature one &amp; feature two
- Works with &lt;Neovim&gt; 0.9+

<details>
<summary>Advanced usage</summary>

More documentation here.

</details>

![screenshot](https://example.com/screenshot.png)
`;

      const result = await processReadme(input);

      // Badges removed
      expect(result).not.toContain("shields.io");
      expect(result).not.toContain("codecov.io");

      // SVG/GIF removed
      expect(result).not.toContain("logo.svg");
      expect(result).not.toContain("demo.gif");

      // HTML stripped
      expect(result).not.toContain("<p ");
      expect(result).not.toContain("<details>");
      expect(result).not.toContain("<summary>");

      // Content preserved
      expect(result).toContain("# My Plugin");
      expect(result).toContain("A great Neovim plugin");
      expect(result).toContain('require("my-plugin").setup');
      expect(result).toContain("option = true");

      // Entities decoded
      expect(result).toContain("Feature one & feature two");
      // remark-stringify escapes < to \< to prevent HTML interpretation
      expect(result).toContain("Works with \\<Neovim> 0.9+");

      // Screenshot preserved (it's a .png)
      expect(result).toContain("screenshot.png");

      // Code block preserved
      expect(result).toContain("```lua");

      // No excessive blank lines
      expect(result).not.toMatch(/\n{3,}/);
    });
  });
});
