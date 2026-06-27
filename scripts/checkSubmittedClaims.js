import dotenv from "dotenv";

dotenv.config();

const backendUrl =
  process.env.BACKEND_URL || "https://delai-backend.onrender.com";

const cronSecret = process.env.CRON_SECRET;
const timeoutMs = Number(process.env.CRON_TIMEOUT_MS || 30000);
const claimLimit = Number(process.env.CRON_CLAIM_LIMIT || 20);

if (!cronSecret) {
  console.error("Missing CRON_SECRET environment variable.");
  process.exit(1);
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
  } catch (error) {
    return {
      success: false,
      error: "Backend returned non-JSON response.",
      raw_response: text,
    };
  }
}

async function checkSubmittedClaims() {
  const endpoint = `${backendUrl}/check-submitted-claims`;

  try {
    console.log("Checking submitted claims...");
    console.log("Backend:", backendUrl);
    console.log("Limit:", claimLimit);

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({
          limit: claimLimit,
        }),
      },
      timeoutMs
    );

    const result = await readJsonResponse(response);

    if (!response.ok || !result.success) {
      console.error("Submitted claims check failed.");
      console.error("Status:", response.status);
      console.error("Result:", result);
      process.exit(1);
    }

    console.log("Submitted claims check completed successfully.");
    console.log("Checked:", result.checked_count ?? 0);
    console.log("Updated:", result.updated_count ?? 0);
    console.log("Notifications:", result.notification_count ?? 0);
    console.log("Message:", result.message || "No message returned.");

    if (Array.isArray(result.results) && result.results.length > 0) {
      console.log("Results:");

      for (const item of result.results) {
        console.log({
          claim_id: item.claim_id,
          user_id: item.user_id,
          previous_outcome: item.previous_outcome,
          detected_outcome: item.detected_outcome || item.outcome,
          updated: item.updated,
          notification_created: item.notification_created,
          error: item.error || null,
        });
      }
    }

    process.exit(0);
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(`Submitted claims check timed out after ${timeoutMs}ms.`);
    } else {
      console.error("Submitted claims check error:", error);
    }

    process.exit(1);
  }
}

checkSubmittedClaims();