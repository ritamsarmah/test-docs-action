import { context } from "@actions/github";

export async function updateFiles() {
    // https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
    const pr = context.payload.pull_request;
    // TODO: for each file in pr (they will be JSON), apply changes and commit
}
