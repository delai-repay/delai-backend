import dotenv from "dotenv";

dotenv.config();

const backendUrl =
  process.env.BACKEND_URL || "https://delai-backend.onrender.com";

const cronSecret = process.env.CRON_SECRET;
const timeoutMs = Number(process.env.CRON_TIMEOUT_MS || 30000);
const jobLimit = Number(process.env.CRON_JOB_LIMIT || 20);

if (!cronSecret) {
  console.error("Missing CRON_SECRET environment variable.");
  process.exitCode = 1;
}

function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: "Backend returned non-JSON response.",
      raw_response: text,
    };
  }
}

async function processAutomationJobs() {
  if (!cronSecret) {
    return;
  }

  const endpoint = `${backendUrl}/process-automation-jobs`;

  try {
    console.log("Processing Delai automation jobs...");
    console.log("Backend:", backendUrl);
    console.log("Limit:", jobLimit);

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({
          limit: jobLimit,
        }),
      },
      timeoutMs
    );

    const result = await readJsonResponse(response);

    if (!response.ok || !result.success) {
      console.error("Automation job processing failed.");
      console.error("Status:", response.status);
      console.error("Result:", result);
      process.exitCode = 1;
      return;
    }

    console.log("Automation job processing completed successfully.");
    console.log("Queued submitted claims:", result.queued_submitted_claims);
    console.log("Processed:", result.processed_count ?? 0);
    console.log("Completed:", result.completed_count ?? 0);
    console.log("Failed:", result.failed_count ?? 0);

    if (Array.isArray(result.results) && result.results.length > 0) {
      console.log("Results:");

      for (const item of result.results) {
        console.log({
          job_id: item.job_id,
          job_type: item.job_type,
          claim_id: item.claim_id,
          success: item.success,
          result: item.result?.message || item.result?.outcome || null,
          error: item.error || null,
        });
      }
    }

    process.exitCode = 0;
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(`Automation job processing timed out after ${timeoutMs}ms.`);
    } else {
      console.error("Automation job processing error:", error);
    }

    process.exitCode = 1;
  }
}

await processAutomationJobs();