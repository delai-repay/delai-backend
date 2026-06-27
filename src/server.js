import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { query } from "./db.js";
import { supabaseAdmin } from "./lib/supabaseAdmin.js";

dotenv.config();

const app = express();

app.use(helmet());
app.use(express.json());

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://delaiapp.com",
  "https://www.delaiapp.com",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked origin: ${origin}`));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-cron-secret"],
  })
);

const FINAL_CLAIM_OUTCOMES = ["paid", "rejected", "needs_follow_up"];

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

function getSafeLimit(value, fallback = 20, max = 100) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function getOperatorClaimGuidance(operatorName) {
  const operator = (operatorName || "").toLowerCase();

  if (operator.includes("greater anglia")) {
    return {
      operatorName: "Greater Anglia",
      claimPortal: "Greater Anglia Delay Repay",
      delayThreshold:
        "Claims are usually available for delays of 15 minutes or more.",
      evidenceNeeded:
        "Ticket or smartcard details, journey date, origin and destination, and delay length.",
      suggestedWording:
        "The passenger travelled on the delayed Greater Anglia service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
    };
  }

  if (operator.includes("c2c")) {
    return {
      operatorName: "c2c",
      claimPortal: "c2c Delay Repay",
      delayThreshold:
        "Claims are usually available for delays of 15 minutes or more.",
      evidenceNeeded:
        "Ticket or smartcard details, journey date, origin and destination, and delay length.",
      suggestedWording:
        "The passenger travelled on the delayed c2c service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
    };
  }

  if (
    operator.includes("southern") ||
    operator.includes("thameslink") ||
    operator.includes("great northern") ||
    operator.includes("gatwick express")
  ) {
    return {
      operatorName: "Govia Thameslink Railway",
      claimPortal: "GTR Delay Repay",
      delayThreshold:
        "Claims are usually available for delays of 15 minutes or more.",
      evidenceNeeded:
        "Ticket details, journey date, origin and destination, scheduled travel time and delay length.",
      suggestedWording:
        "The passenger travelled on the delayed GTR service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
    };
  }

  if (operator.includes("southeastern")) {
    return {
      operatorName: "Southeastern",
      claimPortal: "Southeastern Delay Repay",
      delayThreshold:
        "Claims are usually available for delays of 15 minutes or more.",
      evidenceNeeded:
        "Ticket details, journey date, origin and destination, and delay length.",
      suggestedWording:
        "The passenger travelled on the delayed Southeastern service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
    };
  }

  if (operator.includes("lner")) {
    return {
      operatorName: "LNER",
      claimPortal: "LNER Delay Repay",
      delayThreshold:
        "Claims are usually available for eligible delayed journeys.",
      evidenceNeeded:
        "Ticket details, journey date, origin and destination, and delay length.",
      suggestedWording:
        "The passenger travelled on the delayed LNER service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
    };
  }

  if (operator.includes("avanti")) {
    return {
      operatorName: "Avanti West Coast",
      claimPortal: "Avanti West Coast Delay Repay",
      delayThreshold:
        "Claims are usually available for eligible delayed journeys.",
      evidenceNeeded:
        "Ticket details, journey date, origin and destination, and delay length.",
      suggestedWording:
        "The passenger travelled on the delayed Avanti West Coast service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
    };
  }

  if (operator.includes("gwr") || operator.includes("great western")) {
    return {
      operatorName: "Great Western Railway",
      claimPortal: "GWR Delay Repay",
      delayThreshold:
        "Claims are usually available for eligible delayed journeys.",
      evidenceNeeded:
        "Ticket details, journey date, origin and destination, and delay length.",
      suggestedWording:
        "The passenger travelled on the delayed Great Western Railway service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
    };
  }

  return {
    operatorName: operatorName || "Unknown operator",
    claimPortal: "Operator Delay Repay claim form",
    delayThreshold:
      "Check the operator's Delay Repay rules before submitting the claim.",
    evidenceNeeded:
      "Ticket details, journey date, origin and destination, and delay length.",
    suggestedWording:
      "The passenger confirmed they travelled on the delayed service shown above and is requesting Delay Repay compensation based on the confirmed delay.",
  };
}

function detectClaimOutcomeFromText(claim) {
  const textToCheck = [
    claim.operator_response,
    claim.outcome_notes,
    claim.operator_reference,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!textToCheck) {
    return "still_waiting";
  }

  if (
    textToCheck.includes("more information") ||
    textToCheck.includes("additional information") ||
    textToCheck.includes("follow up") ||
    textToCheck.includes("follow-up") ||
    textToCheck.includes("evidence") ||
    textToCheck.includes("provide proof") ||
    textToCheck.includes("proof of travel") ||
    textToCheck.includes("need proof") ||
    textToCheck.includes("need evidence") ||
    textToCheck.includes("please provide") ||
    textToCheck.includes("further information") ||
    textToCheck.includes("further evidence")
  ) {
    return "needs_follow_up";
  }

  if (
    textToCheck.includes("rejected") ||
    textToCheck.includes("declined") ||
    textToCheck.includes("not eligible") ||
    textToCheck.includes("unsuccessful") ||
    textToCheck.includes("refused") ||
    textToCheck.includes("cannot be paid") ||
    textToCheck.includes("cannot pay") ||
    textToCheck.includes("not valid") ||
    textToCheck.includes("invalid claim")
  ) {
    return "rejected";
  }

  if (
    textToCheck.includes("paid") ||
    textToCheck.includes("payment") ||
    textToCheck.includes("approved") ||
    textToCheck.includes("compensation paid") ||
    textToCheck.includes("claim successful") ||
    textToCheck.includes("successful claim") ||
    textToCheck.includes("refund issued") ||
    textToCheck.includes("compensation has been issued")
  ) {
    return "paid";
  }

  return "still_waiting";
}

function getClaimOutcomeNotification(outcome) {
  if (outcome === "paid") {
    return {
      type: "claim_paid",
      title: "Claim paid",
      message:
        "Good news — your train delay claim appears to have been approved or paid.",
    };
  }

  if (outcome === "rejected") {
    return {
      type: "claim_rejected",
      title: "Claim rejected",
      message:
        "Your train delay claim appears to have been rejected. You may need to review the reason or provide further evidence.",
    };
  }

  if (outcome === "needs_follow_up") {
    return {
      type: "claim_needs_follow_up",
      title: "Claim needs follow-up",
      message:
        "The train operator appears to need more information or evidence before your claim can progress.",
    };
  }

  return null;
}

function calculateClaimPayment({ compensationAmount, feePercentage = 15 }) {
  const cleanCompensationAmount = Number(compensationAmount);
  const cleanFeePercentage = Number(feePercentage || 15);

  if (
    Number.isNaN(cleanCompensationAmount) ||
    cleanCompensationAmount <= 0
  ) {
    throw new Error("Compensation amount must be greater than 0.");
  }

  if (
    Number.isNaN(cleanFeePercentage) ||
    cleanFeePercentage < 0 ||
    cleanFeePercentage > 100
  ) {
    throw new Error("Fee percentage must be between 0 and 100.");
  }

  const delaiFeeAmount =
    Math.round(cleanCompensationAmount * (cleanFeePercentage / 100) * 100) /
    100;

  const userPayoutAmount =
    Math.round((cleanCompensationAmount - delaiFeeAmount) * 100) / 100;

  return {
    compensationAmount: cleanCompensationAmount,
    feePercentage: cleanFeePercentage,
    delaiFeeAmount,
    userPayoutAmount,
  };
}

async function findExistingClaimNotification({ userId, claimId, type }) {
  const { data, error } = await withTimeout(
    supabaseAdmin
      .from("notifications")
      .select("id, type, created_at")
      .eq("user_id", userId)
      .eq("claim_id", claimId)
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(1),
    10000,
    "Existing notification lookup"
  );

  if (error) {
    console.error("Existing notification lookup error:", error);
    throw error;
  }

  return data?.[0] || null;
}

async function createClaimNotification({
  userId,
  claimId,
  type,
  title,
  message,
}) {
  console.log("Creating claim notification:", {
    userId,
    claimId,
    type,
  });

  const existingNotification = await findExistingClaimNotification({
    userId,
    claimId,
    type,
  });

  if (existingNotification) {
    console.log("Duplicate notification skipped:", {
      claimId,
      type,
      existingNotificationId: existingNotification.id,
    });

    return {
      skipped: true,
      reason: "duplicate_notification",
      notification: existingNotification,
    };
  }

  const { data, error } = await withTimeout(
    supabaseAdmin
      .from("notifications")
      .insert([
        {
          user_id: userId,
          claim_id: claimId,
          type,
          title,
          message,
          read: false,
        },
      ])
      .select("*")
      .single(),
    10000,
    "Create claim notification"
  );

  if (error) {
    console.error("Create claim notification error:", error);
    throw error;
  }

  console.log("Claim notification created:", data?.id);

  return {
    skipped: false,
    notification: data,
  };
}

async function createNotificationForOutcomeChange({
  userId,
  claimId,
  previousOutcome,
  newOutcome,
}) {
  const notificationDetails = getClaimOutcomeNotification(newOutcome);

  if (!notificationDetails) {
    console.log("No notification needed for outcome:", newOutcome);
    return {
      skipped: true,
      reason: "non_final_outcome",
    };
  }

  if (previousOutcome === newOutcome) {
    console.log("Outcome unchanged, skipping notification:", {
      claimId,
      previousOutcome,
      newOutcome,
    });

    return {
      skipped: true,
      reason: "outcome_unchanged",
    };
  }

  return createClaimNotification({
    userId,
    claimId,
    type: notificationDetails.type,
    title: notificationDetails.title,
    message: notificationDetails.message,
  });
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "delai-backend",
  });
});

app.get("/supabase-health", async (req, res) => {
  try {
    console.log("Supabase health check started");

    const { data, error } = await withTimeout(
      supabaseAdmin.from("claims").select("id").limit(1),
      10000,
      "Supabase health check"
    );

    if (error) {
      console.error("Supabase health check error:", error);

      return res.status(500).json({
        ok: false,
        service: "delai-backend",
        supabase: "error",
        error: error.message,
      });
    }

    console.log("Supabase health check successful");

    return res.json({
      ok: true,
      service: "delai-backend",
      supabase: "connected",
      sample_count: data?.length || 0,
    });
  } catch (error) {
    console.error("Supabase health check failed:", error);

    return res.status(500).json({
      ok: false,
      service: "delai-backend",
      supabase: "failed_or_timed_out",
      error: error.message,
    });
  }
});

app.get("/detect-delays-test", async (req, res) => {
  try {
    const { data: commutes, error: commuteError } = await withTimeout(
      supabaseAdmin.from("commutes").select("*"),
      10000,
      "Delay detection test commute lookup"
    );

    if (commuteError) {
      throw commuteError;
    }

    res.json({
      ok: true,
      message: "Delay detection test endpoint is working.",
      commute_count: commutes?.length || 0,
      commutes: commutes || [],
    });
  } catch (error) {
    console.error("Delay detection test failed:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/detect-delays", async (req, res) => {
  try {
    const { data: commutes, error: commuteError } = await withTimeout(
      supabaseAdmin.from("commutes").select("*"),
      10000,
      "Delay detection commute lookup"
    );

    if (commuteError) {
      throw commuteError;
    }

    if (!commutes || commutes.length === 0) {
      return res.json({
        ok: true,
        message: "No commutes found to check.",
        checked_commutes: 0,
        created_count: 0,
        created_delays: [],
      });
    }

    const today = new Date();
    const todayDate = today.toISOString().split("T")[0];
    const todayDay = today.toLocaleDateString("en-GB", {
      weekday: "long",
    });

    const createdDelays = [];

    for (const commute of commutes) {
      const travelDays = Array.isArray(commute.travel_days)
        ? commute.travel_days
        : [];

      if (!travelDays.includes(todayDay)) {
        continue;
      }

      const testDelay = {
        user_id: commute.user_id,
        commute_id: commute.id,
        operator: commute.operator,
        origin_station: commute.origin_station,
        destination_station: commute.destination_station,
        travel_window: commute.outbound_time,
        direction: "outbound",
        delay_date: todayDate,
        scheduled_time: commute.outbound_time,
        actual_time: "Test delay",
        delay_minutes: 18,
        status: "detected",
        source: "manual_test_endpoint",
        updated_at: new Date().toISOString(),
      };

      const { data: existingDelay, error: existingError } = await withTimeout(
        supabaseAdmin
          .from("detected_delays")
          .select("id")
          .eq("user_id", commute.user_id)
          .eq("commute_id", commute.id)
          .eq("delay_date", todayDate)
          .eq("direction", "outbound")
          .maybeSingle(),
        10000,
        "Existing delay lookup"
      );

      if (existingError) {
        throw existingError;
      }

      if (existingDelay) {
        continue;
      }

      const { data: insertedDelay, error: insertError } = await withTimeout(
        supabaseAdmin
          .from("detected_delays")
          .insert(testDelay)
          .select("*")
          .single(),
        10000,
        "Detected delay insert"
      );

      if (insertError) {
        throw insertError;
      }

      createdDelays.push(insertedDelay);
    }

    res.json({
      ok: true,
      message: "Delay detection completed.",
      checked_commutes: commutes.length,
      created_count: createdDelays.length,
      created_delays: createdDelays,
    });
  } catch (error) {
    console.error("Delay detection failed:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/prepare-claim", async (req, res) => {
  try {
    const { user_id, claim_id } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .single(),
      10000,
      "Prepare claim lookup"
    );

    if (claimError || !claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    const { data: detectedDelay, error: delayError } = await withTimeout(
      supabaseAdmin
        .from("detected_delays")
        .select("*")
        .eq("id", claim.detected_delay_id)
        .eq("user_id", user_id)
        .single(),
      10000,
      "Prepare claim linked delay lookup"
    );

    if (delayError || !detectedDelay) {
      return res.status(404).json({
        success: false,
        error: "Linked detected delay not found",
      });
    }

    const { data: seasonTickets, error: ticketError } = await withTimeout(
      supabaseAdmin
        .from("season_tickets")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1),
      10000,
      "Prepare claim season ticket lookup"
    );

    if (ticketError) {
      throw ticketError;
    }

    const seasonTicket = seasonTickets?.[0] || null;

    const { data: commutes, error: commuteError } = await withTimeout(
      supabaseAdmin
        .from("commutes")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1),
      10000,
      "Prepare claim commute lookup"
    );

    if (commuteError) {
      throw commuteError;
    }

    const commute = commutes?.[0] || null;

    const delayRoute =
      detectedDelay.origin_station && detectedDelay.destination_station
        ? `${detectedDelay.origin_station} to ${detectedDelay.destination_station}`
        : "Not recorded";

    const ticketRoute =
      seasonTicket?.origin_station && seasonTicket?.destination_station
        ? `${seasonTicket.origin_station} to ${seasonTicket.destination_station}`
        : "Not recorded";

    const commuteRoute =
      commute?.origin_station && commute?.destination_station
        ? `${commute.origin_station} to ${commute.destination_station}`
        : "Not recorded";

    const travelDays = Array.isArray(commute?.travel_days)
      ? commute.travel_days.join(", ")
      : commute?.travel_days || "Not recorded";

    const operatorGuidance = getOperatorClaimGuidance(
      detectedDelay.operator || commute?.operator || seasonTicket?.operator
    );

    const preparedSummary = `
Delay Repay Claim Summary

Claim status: prepared

Operator-specific guidance:
- Operator: ${operatorGuidance.operatorName}
- Claim portal: ${operatorGuidance.claimPortal}
- Delay threshold: ${operatorGuidance.delayThreshold}
- Evidence needed: ${operatorGuidance.evidenceNeeded}

Delay details:
- Date: ${detectedDelay.delay_date || "Not recorded"}
- Route: ${delayRoute}
- Direction: ${detectedDelay.direction || "Not recorded"}
- Travel window: ${detectedDelay.travel_window || "Not recorded"}
- Scheduled time: ${detectedDelay.scheduled_time || "Not recorded"}
- Actual time: ${detectedDelay.actual_time || "Not recorded"}
- Detected delay: ${
      detectedDelay.delay_minutes
        ? `${detectedDelay.delay_minutes} minutes`
        : "Not recorded"
    }
- Operator: ${detectedDelay.operator || "Not recorded"}

Ticket details:
- Ticket route: ${ticketRoute}
- Ticket type: ${seasonTicket?.ticket_type || "Not recorded"}
- Ticket cost: ${seasonTicket?.ticket_cost || "Not recorded"}
- Ticket start date: ${seasonTicket?.ticket_start_date || "Not recorded"}
- Ticket end date: ${seasonTicket?.ticket_end_date || "Not recorded"}
- Smartcard provider: ${seasonTicket?.smartcard_provider || "Not recorded"}
- Smartcard number: ${seasonTicket?.smartcard_number || "Not recorded"}

Commute details:
- Saved commute route: ${commuteRoute}
- Outbound window: ${commute?.outbound_time || "Not recorded"}
- Return window: ${commute?.return_time || "Not recorded"}
- Travel days: ${travelDays}

Passenger confirmation:
- User confirmed they travelled on this delayed service.

Suggested claim wording:
${operatorGuidance.suggestedWording}

Suggested next action:
- Review this information, then use it to complete the ${operatorGuidance.claimPortal}.
`.trim();

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          status: "prepared",
          prepared_summary: preparedSummary,
          prepared_at: new Date().toISOString(),
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .single(),
      10000,
      "Prepare claim update"
    );

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      claim: updatedClaim,
      prepared_summary: preparedSummary,
    });
  } catch (error) {
    console.error("Prepare claim error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to prepare claim",
      details: error.message,
    });
  }
});

app.post("/mark-claim-ready", async (req, res) => {
  try {
    const { user_id, claim_id } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .single(),
      10000,
      "Mark claim ready lookup"
    );

    if (claimError || !claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status !== "prepared" && claim.status !== "ready_to_submit") {
      return res.status(400).json({
        success: false,
        error:
          "Claim must be prepared before it can be marked ready to submit.",
      });
    }

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          status: "ready_to_submit",
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .single(),
      10000,
      "Mark claim ready update"
    );

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      claim: updatedClaim,
    });
  } catch (error) {
    console.error("Mark claim ready error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to mark claim as ready to submit",
      details: error.message,
    });
  }
});

app.post("/mark-claim-submitted", async (req, res) => {
  try {
    const { user_id, claim_id } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .single(),
      10000,
      "Mark claim submitted lookup"
    );

    if (claimError || !claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status !== "ready_to_submit" && claim.status !== "submitted") {
      return res.status(400).json({
        success: false,
        error:
          "Claim must be ready to submit before it can be marked as submitted.",
      });
    }

    const submittedAt = claim.submitted_at || new Date().toISOString();

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          status: "submitted",
          submitted_at: submittedAt,
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .single(),
      10000,
      "Mark claim submitted update"
    );

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      claim: updatedClaim,
    });
  } catch (error) {
    console.error("Mark claim submitted error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to mark claim as submitted",
      details: error.message,
    });
  }
});

app.post("/update-claim-reference", async (req, res) => {
  try {
    console.log("Update claim reference request received:", req.body);

    const { user_id, claim_id, operator_reference } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    if (!operator_reference || !operator_reference.trim()) {
      return res.status(400).json({
        success: false,
        error: "Missing operator reference",
      });
    }

    const cleanReference = operator_reference.trim();

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .maybeSingle(),
      10000,
      "Claim lookup for reference update"
    );

    if (claimError) {
      return res.status(500).json({
        success: false,
        error: "Failed to look up claim",
        details: claimError.message,
      });
    }

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status !== "submitted") {
      return res.status(400).json({
        success: false,
        error: "Operator reference can only be added to submitted claims.",
        current_status: claim.status,
      });
    }

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          operator_reference: cleanReference,
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .maybeSingle(),
      10000,
      "Operator reference update"
    );

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: "Failed to update claim reference",
        details: updateError.message,
      });
    }

    if (!updatedClaim) {
      return res.status(404).json({
        success: false,
        error: "Claim reference could not be updated",
      });
    }

    return res.json({
      success: true,
      message: "Operator claim reference saved.",
      claim: updatedClaim,
    });
  } catch (error) {
    console.error("Update claim reference error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to update claim reference",
      details: error.message,
    });
  }
});

app.post("/update-operator-response", async (req, res) => {
  try {
    const { user_id, claim_id, operator_response, outcome_notes } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    const cleanOperatorResponse = operator_response?.trim() || "";
    const cleanOutcomeNotes = outcome_notes?.trim() || "";

    if (!cleanOperatorResponse && !cleanOutcomeNotes) {
      return res.status(400).json({
        success: false,
        error: "Please provide an operator response or outcome note.",
      });
    }

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .single(),
      10000,
      "Operator response claim lookup"
    );

    if (claimError || !claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status !== "submitted") {
      return res.status(400).json({
        success: false,
        error: "Operator responses can only be added to submitted claims.",
      });
    }

    const updatePayload = {};

    if (cleanOperatorResponse) {
      updatePayload.operator_response = cleanOperatorResponse;
    }

    if (cleanOutcomeNotes) {
      updatePayload.outcome_notes = cleanOutcomeNotes;
    }

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update(updatePayload)
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .single(),
      10000,
      "Operator response update"
    );

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: "Operator response saved.",
      claim: updatedClaim,
    });
  } catch (error) {
    console.error("Update operator response error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to update operator response",
      details: error.message,
    });
  }
});

app.post("/update-claim-outcome", async (req, res) => {
  try {
    const { user_id, claim_id, outcome } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    if (!outcome || !FINAL_CLAIM_OUTCOMES.includes(outcome)) {
      return res.status(400).json({
        success: false,
        error: "Invalid claim outcome",
      });
    }

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .single(),
      10000,
      "Manual outcome claim lookup"
    );

    if (claimError || !claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status !== "submitted") {
      return res.status(400).json({
        success: false,
        error: "Only submitted claims can have an outcome added.",
      });
    }

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          outcome,
          outcome_updated_at: new Date().toISOString(),
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .single(),
      10000,
      "Manual outcome update"
    );

    if (updateError) {
      throw updateError;
    }

    let notificationResult = null;

    try {
      notificationResult = await createNotificationForOutcomeChange({
        userId: user_id,
        claimId: claim_id,
        previousOutcome: claim.outcome,
        newOutcome: outcome,
      });
    } catch (notificationError) {
      console.error(
        "Manual outcome notification failed, but claim outcome was updated:",
        notificationError
      );

      notificationResult = {
        skipped: true,
        reason: "notification_failed",
        error: notificationError.message,
      };
    }

    res.json({
      success: true,
      claim: updatedClaim,
      notification: notificationResult,
    });
  } catch (error) {
    console.error("Update claim outcome error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to update claim outcome",
      details: error.message,
    });
  }
});

app.post("/check-claim-outcome", async (req, res) => {
  try {
    console.log("Check claim outcome request received:", req.body);

    const { user_id, claim_id } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .maybeSingle(),
      10000,
      "Claim lookup"
    );

    if (claimError) {
      return res.status(500).json({
        success: false,
        error: "Failed to look up claim",
        details: claimError.message,
      });
    }

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status !== "submitted") {
      return res.status(400).json({
        success: false,
        error: "Only submitted claims can be checked for an outcome.",
        current_status: claim.status,
      });
    }

    const detectedOutcome = detectClaimOutcomeFromText(claim);

    if (detectedOutcome === "still_waiting") {
      return res.json({
        success: true,
        outcome: "still_waiting",
        updated: false,
        message: "No final outcome detected yet. Delai will keep checking.",
        claim,
      });
    }

    if (claim.outcome === detectedOutcome) {
      return res.json({
        success: true,
        outcome: detectedOutcome,
        updated: false,
        message: "Claim outcome was already up to date.",
        claim,
      });
    }

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          outcome: detectedOutcome,
          outcome_updated_at: new Date().toISOString(),
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .maybeSingle(),
      10000,
      "Claim outcome update"
    );

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: "Failed to update claim outcome",
        details: updateError.message,
      });
    }

    if (!updatedClaim) {
      return res.status(404).json({
        success: false,
        error: "Claim could not be updated",
      });
    }

    let notificationResult = null;

    try {
      notificationResult = await createNotificationForOutcomeChange({
        userId: user_id,
        claimId: claim_id,
        previousOutcome: claim.outcome,
        newOutcome: detectedOutcome,
      });
    } catch (notificationError) {
      console.error(
        "Outcome notification failed, but claim outcome was updated:",
        notificationError
      );

      notificationResult = {
        skipped: true,
        reason: "notification_failed",
        error: notificationError.message,
      };
    }

    return res.json({
      success: true,
      outcome: detectedOutcome,
      updated: true,
      message: `Claim outcome detected: ${detectedOutcome}.`,
      claim: updatedClaim,
      notification: notificationResult,
    });
  } catch (error) {
    console.error("Check claim outcome error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to check claim outcome",
      details: error.message,
    });
  }
});

async function checkSubmittedClaims({ limit }) {
  const safeLimit = getSafeLimit(limit, 20, 100);

  console.log("Checking submitted claims:", {
    limit: safeLimit,
  });

  const { data: claims, error: claimsError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("status", "submitted")
      .or("outcome.is.null,outcome.eq.still_waiting")
      .order("submitted_at", { ascending: true })
      .limit(safeLimit),
    15000,
    "Submitted claims lookup"
  );

  if (claimsError) {
    throw claimsError;
  }

  if (!claims || claims.length === 0) {
    return {
      success: true,
      checked_count: 0,
      updated_count: 0,
      notification_count: 0,
      message: "No submitted claims need outcome checking.",
      results: [],
    };
  }

  const results = [];
  let updatedCount = 0;
  let notificationCount = 0;

  for (const claim of claims) {
    try {
      const detectedOutcome = detectClaimOutcomeFromText(claim);

      if (detectedOutcome === "still_waiting") {
        results.push({
          claim_id: claim.id,
          user_id: claim.user_id,
          previous_outcome: claim.outcome,
          detected_outcome: "still_waiting",
          updated: false,
          notification_created: false,
          message: "No final outcome detected yet.",
        });

        continue;
      }

      if (claim.outcome === detectedOutcome) {
        results.push({
          claim_id: claim.id,
          user_id: claim.user_id,
          previous_outcome: claim.outcome,
          detected_outcome: detectedOutcome,
          updated: false,
          notification_created: false,
          message: "Outcome already up to date.",
        });

        continue;
      }

      const { data: updatedClaim, error: updateError } = await withTimeout(
        supabaseAdmin
          .from("claims")
          .update({
            outcome: detectedOutcome,
            outcome_updated_at: new Date().toISOString(),
          })
          .eq("id", claim.id)
          .eq("user_id", claim.user_id)
          .select("*")
          .single(),
        10000,
        `Scheduled claim outcome update ${claim.id}`
      );

      if (updateError) {
        results.push({
          claim_id: claim.id,
          user_id: claim.user_id,
          previous_outcome: claim.outcome,
          detected_outcome: detectedOutcome,
          updated: false,
          notification_created: false,
          error: updateError.message,
        });

        continue;
      }

      let notificationResult = null;

      try {
        notificationResult = await createNotificationForOutcomeChange({
          userId: claim.user_id,
          claimId: claim.id,
          previousOutcome: claim.outcome,
          newOutcome: detectedOutcome,
        });

        if (notificationResult && notificationResult.skipped === false) {
          notificationCount += 1;
        }
      } catch (notificationError) {
        console.error(
          "Scheduled outcome notification failed, but claim outcome was updated:",
          notificationError
        );

        notificationResult = {
          skipped: true,
          reason: "notification_failed",
          error: notificationError.message,
        };
      }

      updatedCount += 1;

      results.push({
        claim_id: claim.id,
        user_id: claim.user_id,
        previous_outcome: claim.outcome,
        detected_outcome: detectedOutcome,
        updated: true,
        notification_created: notificationResult?.skipped === false,
        notification: notificationResult,
        claim: updatedClaim,
      });
    } catch (claimError) {
      console.error("Submitted claim check failed for claim:", {
        claim_id: claim.id,
        error: claimError.message,
      });

      results.push({
        claim_id: claim.id,
        user_id: claim.user_id,
        updated: false,
        notification_created: false,
        error: claimError.message,
      });
    }
  }

  return {
    success: true,
    checked_count: claims.length,
    updated_count: updatedCount,
    notification_count: notificationCount,
    message: `Checked ${claims.length} submitted claim(s). Updated ${updatedCount}. Created ${notificationCount} notification(s).`,
    results,
  };
}

async function checkSubmittedClaimsHandler(req, res) {
  try {
    const cronSecret = req.headers["x-cron-secret"];

    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized cron request",
      });
    }

    const limit = req.body?.limit || req.query?.limit || 20;

    const result = await checkSubmittedClaims({
      limit,
    });

    return res.json(result);
  } catch (error) {
    console.error("Check submitted claims error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to check submitted claims",
      details: error.message,
    });
  }
}

app.post("/check-submitted-claims", checkSubmittedClaimsHandler);
app.get("/check-submitted-claims", checkSubmittedClaimsHandler);

app.post("/update-claim-payment", async (req, res) => {
  try {
    const {
      user_id,
      claim_id,
      compensation_amount,
      fee_percentage = 15,
      payment_status = "fee_due",
    } = req.body;

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        error: "Missing user_id or claim_id",
      });
    }

    if (compensation_amount === undefined || compensation_amount === null) {
      return res.status(400).json({
        success: false,
        error: "Missing compensation_amount",
      });
    }

    const allowedPaymentStatuses = [
      "not_paid",
      "paid",
      "fee_due",
      "fee_collected",
    ];

    if (!allowedPaymentStatuses.includes(payment_status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment_status",
      });
    }

    const payment = calculateClaimPayment({
      compensationAmount: compensation_amount,
      feePercentage: fee_percentage,
    });

    const { data: claim, error: claimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .maybeSingle(),
      10000,
      "Payment claim lookup"
    );

    if (claimError) {
      return res.status(500).json({
        success: false,
        error: "Failed to look up claim",
        details: claimError.message,
      });
    }

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status !== "submitted") {
      return res.status(400).json({
        success: false,
        error: "Payments can only be recorded for submitted claims.",
        current_status: claim.status,
      });
    }

    const now = new Date().toISOString();

    const { data: updatedClaim, error: updateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          outcome: "paid",
          outcome_updated_at: claim.outcome_updated_at || now,
          compensation_amount: payment.compensationAmount,
          fee_percentage: payment.feePercentage,
          delai_fee_amount: payment.delaiFeeAmount,
          user_payout_amount: payment.userPayoutAmount,
          payment_status,
          payment_recorded_at: now,
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .maybeSingle(),
      10000,
      "Claim payment update"
    );

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: "Failed to update claim payment",
        details: updateError.message,
      });
    }

    if (!updatedClaim) {
      return res.status(404).json({
        success: false,
        error: "Claim payment could not be updated",
      });
    }

    let outcomeNotification = null;
    let paymentNotification = null;

    try {
      outcomeNotification = await createNotificationForOutcomeChange({
        userId: user_id,
        claimId: claim_id,
        previousOutcome: claim.outcome,
        newOutcome: "paid",
      });
    } catch (notificationError) {
      console.error(
        "Payment outcome notification failed, but payment was recorded:",
        notificationError
      );

      outcomeNotification = {
        skipped: true,
        reason: "notification_failed",
        error: notificationError.message,
      };
    }

    try {
      paymentNotification = await createClaimNotification({
        userId: user_id,
        claimId: claim_id,
        type: "claim_payment_recorded",
        title: "Payment recorded",
        message: `A compensation payment of £${payment.compensationAmount.toFixed(
          2
        )} has been recorded. Delai's fee is £${payment.delaiFeeAmount.toFixed(
          2
        )}, leaving £${payment.userPayoutAmount.toFixed(
          2
        )} for the passenger.`,
      });
    } catch (notificationError) {
      console.error(
        "Payment notification failed, but payment was recorded:",
        notificationError
      );

      paymentNotification = {
        skipped: true,
        reason: "notification_failed",
        error: notificationError.message,
      };
    }

    return res.json({
      success: true,
      message: "Claim payment recorded.",
      claim: updatedClaim,
      payment: {
        compensation_amount: payment.compensationAmount,
        fee_percentage: payment.feePercentage,
        delai_fee_amount: payment.delaiFeeAmount,
        user_payout_amount: payment.userPayoutAmount,
        payment_status,
      },
      notifications: {
        outcome: outcomeNotification,
        payment: paymentNotification,
      },
    });
  } catch (error) {
    console.error("Update claim payment error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to update claim payment",
      details: error.message,
    });
  }
});

app.post("/early-access", async (req, res) => {
  try {
    const {
      full_name,
      email,
      mobile,
      from_station,
      to_station,
      train_operator,
      commute_frequency,
      ticket_type,
      ticket_cost,
      ticket_start_date,
      ticket_end_date,
      smartcard_provider,
      smartcard_number,
      currently_claims_delay_repay,
      biggest_frustration,
    } = req.body;

    if (
      !full_name ||
      !email ||
      !from_station ||
      !to_station ||
      !train_operator ||
      !commute_frequency ||
      !ticket_type ||
      !ticket_cost ||
      !ticket_start_date ||
      !ticket_end_date ||
      !smartcard_provider ||
      !smartcard_number ||
      !currently_claims_delay_repay
    ) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    const result = await query(
      `
      INSERT INTO early_access_signups (
        full_name,
        email,
        mobile,
        from_station,
        to_station,
        train_operator,
        commute_frequency,
        ticket_type,
        ticket_cost,
        ticket_start_date,
        ticket_end_date,
        smartcard_provider,
        smartcard_number,
        currently_claims_delay_repay,
        biggest_frustration
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      )
      RETURNING id, email, created_at
      `,
      [
        full_name,
        email.toLowerCase(),
        mobile || null,
        from_station,
        to_station,
        train_operator,
        commute_frequency,
        ticket_type,
        ticket_cost,
        ticket_start_date,
        ticket_end_date,
        smartcard_provider,
        smartcard_number,
        currently_claims_delay_repay,
        biggest_frustration || null,
      ]
    );

    res.status(201).json({
      ok: true,
      signup: result.rows[0],
    });
  } catch (error) {
    console.error("Early access error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "This email has already joined early access.",
      });
    }

    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Delai backend running on http://localhost:${port}`);
});