import { setFailed } from "@actions/core";

import { unified } from "unified";
import remarkDefinitionList from "remark-definition-list";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import rehypeDocument from "rehype-document";
import rehypeFormat from "rehype-format";
import rehypeStringify from "rehype-stringify";

export const DEBUG = true;
export const ARTIFACTS_DIR_PATH = "artifacts/";
export const LOCALES = {
    en: "en-US",
    ja: "ja-JP",
    zh: "zh-CN",
    ko: "ko-KR",
};
export const DEFAULT_LOCALE = LOCALES.en;

export function createMDXProcessor() {
    return (
        unified()
            // MDX -> AST
            .use(remarkMdx)
            .use(remarkParse)
            // MDX Plugins
            .use(remarkDefinitionList)
            .use(remarkDirective)
            .use(remarkFrontmatter)
            .use(remarkGfm)
            // AST -> MDX
            // https://www.npmjs.com/package/remark-stringify#options
            .use(remarkStringify, {
                bullet: "-",
                bulletOrdered: ".",
                emphasis: "*",
                fence: "`",
                incrementListMarker: false,
                resourceLink: true,
                rule: "-",
                strong: "*",
            })
    );
}

export function createHTMLProcessor() {
    return (
        unified()
            .use(remarkMdx)
            .use(remarkParse)
            .use(remarkRehype, {
                unknownHandler: (state, node) => {
                    // TODO: Add custom tagName and properties for UILabel, asides, etc. reflecting final output of Astro site
                    return {
                        type: "element",
                        tagName: "span",
                        properties: {},
                        children: state.all(node),
                    };
                },
            })
            // MDX Plugins
            .use(remarkDefinitionList)
            .use(remarkDirective)
            .use(remarkFrontmatter)
            .use(remarkGfm)
            // MDX -> HTML
            .use(rehypeDocument)
            .use(rehypeFormat)
            .use(rehypeStringify)
    );
}

export function createPlaceholder(value) {
    return `%%${value}%%`;
}

export function shortLocale(locale) {
    return locale.slice(0, 2);
}

export function replaceSubstring(original, change) {
    const start = change.start;
    const end = change.end;

    if (start < 0 || end > original.length || start >= end) {
        throw new Error(`Invalid indices provided: (${start}, ${end})`);
    }

    const text = !DEBUG
        ? change.text
        : change.text.toLocaleUpperCase().replace(/ /g, ".."); // Make the changes more apparent

    return original.substring(0, start) + text + original.substring(end);
}

// Removes newline from the end of the string
export function chomp(str) {
    return str.replace(/\n$/, "");
}

export function handleError(error) {
    if (error == null) return;

    setFailed(error);
}

/* Debugging */

export function todo() {
    console.warn("Not implemented");
    process.exit(2);
}

export function applyChanges(content, changes) {
    let result = content;

    changes
        .sort((a, b) => b.start - a.start)
        .forEach(change => {
            result = replaceSubstring(result, change);
        });

    return result;
}
