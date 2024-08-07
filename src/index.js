import { setOutput, setFailed, getInput } from "@actions/core";
import { context } from "@actions/github";
import { uploadFiles } from "./upload.js";
import { updateFiles } from "./update.js";
import { handleError } from "./utils.js";

await main();

async function main() {
    try {
        const action = getInput("action");
        const filePaths = getInput("file-paths").split(" ");

        switch (action) {
            case "upload":
                await uploadFiles(filePaths);
                setOutput("status", "Successfully uploaded files to Smartling");
                break;
            case "update":
                // await updateFiles(filePaths);
                setOutput("status", "Successfully updated local source files");
                break;
            default:
                setFailed("Unrecognized action. Expected 'upload' or 'update'");
                break;
        }
    } catch (error) {
        handleError(error);
    }
}
