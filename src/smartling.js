import path from "path";
import { LOCALES } from "./utils.js";

const BASE_URL = "https://api.smartling.com";
const MAX_JOB_NAME_LENGTH = 170; // Smartling API constraint

/**
 * Authenticate with Smartling and retrieve access token.
 * https://api-reference.smartling.com/#tag/Authentication/operation/authenticate
 */
export async function authenticate(userId, userSecret) {
    const url = `${BASE_URL}/auth-api/v2/authenticate`;
    const body = {
        userIdentifier: userId,
        userSecret: userSecret,
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const json = await validateResponse(
        response,
        "authentication with Smartling"
    );

    return json["response"]["data"]["accessToken"];
}

/**
 * Creates a job within Smartling. Returns the job number
 * https://api-reference.smartling.com/#tag/Jobs/operation/addJob
 */
export async function createJob(name, projectId, accessToken) {
    const url = `${BASE_URL}/jobs-api/v3/projects/${projectId}/jobs`;
    const body = {
        jobName:
            name.length > MAX_JOB_NAME_LENGTH
                ? str.slice(0, MAX_JOB_NAME_LENGTH)
                : name,
        targetLocaleIds: [LOCALES.zh, LOCALES.ja],
    };

    const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
        },
    });

    const json = await validateResponse(response, "job creation in Smartling");

    return json["response"]["data"]["translationJobUid"];
}

/**
 * Creates a new batch for the given job with a list of file names to be uploaded.
 * https://api-reference.smartling.com/#tag/Job-Batches-V2/operation/createJobBatchV2
 */
export async function createBatch(fileUris, jobUid, projectId, accessToken) {
    const url = `${BASE_URL}/job-batches-api/v2/projects/${projectId}/batches`;
    const body = {
        authorize: false, // Don't authorize the job automatically; localization team can handle this
        translationJobUid: jobUid,
        fileUris: fileUris,
    };

    const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
        },
    });

    const json = await validateResponse(
        response,
        "batch creation for job in Smartling"
    );

    return json["response"]["data"]["batchUid"];
}

export async function uploadFileToBatch(
    fileContent,
    fileUri,
    batchUid,
    projectId,
    accessToken
) {
    const url = `${BASE_URL}/job-batches-api/v2/projects/${projectId}/batches/${batchUid}/file`;

    const body = new FormData();
    const blob = new Blob([fileContent], { fileType: "application/json" });
    body.set("file", blob);
    body.set("fileUri", fileUri);
    body.set("fileType", "json");

    [LOCALES.ja, LOCALES.zh].forEach(locale =>
        body.append("localeIdsToAuthorize[]", locale)
    );

    const response = await fetch(url, {
        method: "POST",
        body: body,
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    await validateResponse(response, `file upload to batch for ${fileUri}`);
}

export async function uploadContext(
    fileUri,
    content,
    jobUid,
    projectId,
    accessToken
) {
    const url = `${BASE_URL}/context-api/v2/projects/${projectId}/contexts/upload-and-match-async`;

    const body = new FormData();
    const blob = new Blob([content], { fileType: "text/html" });
    body.set("content", blob, fileUri);
    body.set("name", fileUri);

    // TODO: Switch back to just uploading context, and call context bindings API instead after uploading (new function called from upload.js)
    // https://api.smartling.com/context-api/v2/projects/{projectId}/bindings
    body.set(
        "matchParams",
        JSON.stringify({
            translationJobUids: [jobUid],
        })
    );

    const response = await fetch(url, {
        method: "POST",
        body: body,
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    await validateResponse(response, `context upload for ${fileUri}`);
}

/* Utilities */

async function validateResponse(response, description) {
    const json = await response.json();
    if (response.status < 200 || response.status > 299) {
        const message = json["response"]["errors"][0].message;
        throw new Error(
            `Failed ${description}: ${message} (${response.status})`
        );
    } else {
        console.log(`✅ Successful ${description}`);
    }

    return json;
}
