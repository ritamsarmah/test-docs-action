import fs from "fs";
import path from "path";

import { getInput } from "@actions/core";
import { context } from "@actions/github";
import {
    authenticate,
    createBatch,
    createJob,
    uploadContext,
    uploadFileToBatch,
} from "./smartling.js";
import {
    DEBUG,
    DEFAULT_LOCALE,
    applyChanges,
    chomp,
    createHTMLProcessor,
    createMDXProcessor,
    createPlaceholder,
    handleError,
    shortLocale,
    todo,
} from "./utils.js";

// AST nodes that appear at the top level of document that should be parsed for localization
// TODO: image alt text is not parsed separately (do we want to?)
const TOP_LEVEL_NODE_TYPES = new Set([
    "containerDirective",
    "heading",
    "image",
    "list",
    "mdxJsxFlowElement",
    "paragraph",
    "table",
]);

/**
 * Uploads file contents as JSON to be localized
 */
export async function uploadFiles(filePaths) {
    const mdxProcessor = createMDXProcessor();
    const htmlProcessor = createHTMLProcessor();

    // Map fileUri (from filePaths) to corresponding data
    const data = {};

    for (const filePath of filePaths) {
        const content = fs.readFileSync(filePath, "utf-8");
        let ast = mdxProcessor.parse(content); // TODO: Inject IDs to every root-level node

        if (DEBUG) {
            if (!fs.existsSync("debug")) {
                fs.mkdirSync("debug");
            }

            const basename = path.basename(filePath);
            fs.writeFileSync(
                `debug/ast-${basename}.json`,
                JSON.stringify(ast, null, 4),
                handleError
            );
        }

        console.log(`--- ${filePath} ---\n`);

        // Create list of localization changes
        const strings = [
            ...parseFrontmatter(ast),
            ...parseImports(ast),
            ...parseContent(ast, mdxProcessor),
        ];

        const body = {
            smartling: {
                translate_paths: [
                    {
                        path: "/strings/text",
                        key: "/strings/start", // TODO: Choose better key?
                        instruction: "/strings/notes",
                        key_generation_strategy: "strict",
                    },
                ],
                variants_enabled: "false",
            },
            strings: strings,
        };

        // TODO: Inject IDs associated with each string into the HTML and each change (start from MD AST?) so visual context elements maps precisely to the strings
        const context = await htmlProcessor.process(content);

        data[filePath] = {
            json: JSON.stringify(body),
            context: context.value,
        };
    }

    // Send to Smartling
    try {
        const projectId = getInput("smartling-project-id", { required: true });
        const userId = getInput("smartling-user-id", { required: true });
        const userSecret = getInput("smartling-user-secret", {
            required: true,
        });

        const accessToken = await authenticate(userId, userSecret);
        const jobName = `${context.sha} - ${context.ref}`;
        const jobUid = await createJob(jobName, projectId, accessToken);

        const fileUris = Object.keys(data);
        const batchUid = await createBatch(
            fileUris,
            jobUid,
            projectId,
            accessToken
        );
        const encoder = new TextEncoder();

        // When all files are uploaded, Smartling automatically executes the batch
        for (const fileUri of filePaths) {
            const { json, context } = data[fileUri];

            // Upload JSON
            await uploadFileToBatch(
                encoder.encode(json),
                fileUri,
                batchUid,
                projectId,
                accessToken
            );

            // Upload visual context
            await uploadContext(
                fileUri,
                encoder.encode(context),
                jobUid,
                projectId,
                accessToken
            );
        }
    } catch (error) {
        handleError(error);
    }
}

/* AST Parsing */

function parseFrontmatter(ast) {
    console.log("Parsing frontmatter...\n");

    const frontmatter = ast.children.find(node => node.type === "yaml");
    if (frontmatter == null) {
        console.log("No frontmatter data found\n");
        return [];
    }

    const regex = /(title:\s*)(.+)(?:\n|$)/;
    const match = regex.exec(frontmatter.value);
    if (match == null || match.length < 3) {
        console.log("No title found in frontmatter\n");
        return [];
    }

    const title = match[2];

    console.log(`> title: ${title}\n`);

    // Calculate start/end offsets. The AST does not include the divider in it's start position calculation
    const divider = "---\n";
    const startOffset = divider.length + match.index + match[1].length;
    const endOffset = startOffset + title.length;

    return [
        {
            type: "title",
            text: title,
            notes: "title for document",
            start: frontmatter.position.start.offset + startOffset,
            end: frontmatter.position.start.offset + endOffset,
        },
    ];
}

function parseImports(ast) {
    console.log("Parsing imports...\n");

    const changes = ast.children
        .filter(node => node.type === "mdxjsEsm")
        .flatMap(node =>
            node.data.estree.body.map(child => {
                if (child.type === "ImportDeclaration") {
                    const original = child.source.raw;
                    const localized = localizeUrl(original);

                    // No localization required for import, skip change
                    if (original === localized) return null;

                    console.log(`> ${localized}`);

                    return {
                        type: "Import",
                        text: localized,
                        start: child.source.start,
                        end: child.source.end,
                    };
                }
            })
        )
        .filter(node => node != null);

    console.log(`\n${changes.length} import(s) parsed\n`);

    return changes;
}

function parseContent(ast, processor) {
    console.log("Parsing content...\n");

    const changes = [];

    for (let node of ast.children) {
        if (node.type && TOP_LEVEL_NODE_TYPES.has(node.type)) {
            console.log(`> ${node.type}`);
            node = parseNode(node, changes, processor, true);
        }
    }

    console.log(`\n${changes.length} content node(s) parsed\n`);

    return changes;
}

/**
 * Recursive function for flattening AST Markdown hierarchies into localization change(s).
 * Specific node types will be unmodified (text), processed (links), or processed into a localization change (paragraph).
 * Modifies the `changes` parameter in-place.
 */
function parseNode(node, changes, processor, root = false) {
    const type = node.type;

    if (type === "link") {
        node.url = localizeUrl(node.url);
    } else if (
        // type === "mdxJsxTextElement" || // JSX element that appears within text chunk
        type === "mdxJsxFlowElement" // JSX element that appears alone in document
    ) {
        if (node.name === "RelativeLink") {
            parseAttribute("title", node, changes);
        } else if (node.name === "AccordionItem") {
            parseAttribute("title", node, changes);
            parseChildrenAsRoot(node, changes, processor);
        }
    } else if (type === "image") {
        // TODO: localize URL?
    } else if (
        type === "list" ||
        type === "listItem" ||
        type === "table" ||
        type === "tableRow"
    ) {
        parseChildrenAsRoot(node, changes, processor);
    } else if (
        type === "heading" ||
        type === "paragraph" ||
        type === "tableCell"
    ) {
        const text = parseChildren(node, changes, processor);

        if (root) {
            changes.push({
                text: text,
                start: node.children[0].position.start.offset,
                end: node.children.slice(-1)[0].position.end.offset,
                notes: "",
            });
        }
    } else if (type === "containerDirective") {
        // Extract the directive label if exists, e.g., :::tip[See also]
        const first = node.children[0];
        if (first.data && first.data.directiveLabel) {
            changes.push({
                type: "containerDirectiveLabel",
                text: first.children[0].value,
                start: first.position.start.offset + 1, // Omit [
                end: first.position.end.offset - 1, // Omit ]
                notes: `title for the "${node.name}" callout`,
            });

            // Remove the title child node to create the text
            node.children.shift();
        }

        const text = parseChildren(node, changes, processor);

        changes.push({
            text: text,
            start: node.children[0].position.start.offset,
            end: node.children.slice(-1)[0].position.end.offset,
            notes: `content for the "${node.name}" callout`,
        });
    }

    return node;
}

function parseChildrenAsRoot(node, changes, processor) {
    // Each child will generate its own change (intended for when we don't include the current node itself as root level change)
    node.children.forEach(child => parseNode(child, changes, processor, true));
}

function parseChildren(node, changes, processor) {
    if (!node.children) return;

    let text = "";

    // Process the children of nodes into single string
    for (let child of node.children) {
        child = parseNode(child, changes, processor);

        if (child.type === "code") {
            text += "\n";
        }

        if (child.type !== "list") {
            text += chomp(processor.stringify(child));
        }
    }

    return text;
}

function parseAttribute(name, node, changes) {
    const attribute = node.attributes.find(attr => attr.name === name);
    if (attribute) {
        changes.push({
            text: attribute.value,
            start: attribute.position.start.offset + attribute.name.length + 1,
            end: attribute.position.end.offset - 1,
            notes: `'${name}' attribute for ${node.name}`,
        });
    } else {
        console.error(`${node.name} did not contain a ${name} attribute`);
    }
}

/**
 * Replace locale in URL with placeholder.
 */
function localizeUrl(url) {
    const placeholder = createPlaceholder("locale");
    const locale = shortLocale(DEFAULT_LOCALE);
    return url.replace(`/${locale}`, `/${placeholder}`);
}
