import dotenv from "dotenv";

dotenv.config();

const backendUrl =
  process.env.BACKEND_URL || "https://delai-backend.onrender.com";

const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error("Missing CRON_SECRET environment variable.");
  process.exit(1);
}

async function checkSubmittedClaims() {
  try {
    console.log("Checking submitted claims...");

    const response = await fetch(`${backendUrl}/check-submitted-claims`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        limit: 20,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      console.error("Submitted claims check failed:", result);
      process.exit(1);
    }

    console.log("Submitted claims check completed:", result);
    process.exit(0);
  } catch (error) {
    console.error("Submitted claims check error:", error);
    process.exit(1);
  }
}

checkSubmittedClaims();