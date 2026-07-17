import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { query } from "./db.js";
import { supabaseAdmin } from "./lib/supabaseAdmin.js";
import {
  getOperatorAdapter,
  getOperatorIntegrationStatus,
} from "./operators/operatorRegistry.js";

import { getAllOperators } from "./operators/operatorCatalog.js";
import { buildClaimSubmissionContext } from "./operators/claimSubmissionContext.js";
import { validateSubmissionContext } from "./operators/submissionValidation.js";

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

const AUTOMATION_JOB_TYPES = [
  "claim_prepare",
  "claim_submit",
  "claim_check_outcome",
  "claim_check_payment",
  "claim_collect_fee",
  "send_notification",
];

const AUTOMATION_RETRY_LIMIT = 3;

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

function getFutureIsoDate({ minutes = 0, hours = 0, days = 0 }) {
  const date = new Date();

  date.setMinutes(date.getMinutes() + minutes);
  date.setHours(date.getHours() + hours);
  date.setDate(date.getDate() + days);

  return date.toISOString();
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

function extractCompensationAmountFromText(claim) {
  const textToCheck = [claim.operator_response, claim.outcome_notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!textToCheck) {
    return null;
  }

  const matches = [];

  const poundMatches = textToCheck.matchAll(/£\s*(\d+(?:\.\d{1,2})?)/g);

  for (const match of poundMatches) {
    matches.push(Number(match[1]));
  }

  const gbpMatches = textToCheck.matchAll(/gbp\s*(\d+(?:\.\d{1,2})?)/g);

  for (const match of gbpMatches) {
    matches.push(Number(match[1]));
  }

  const amountMatches = textToCheck.matchAll(
    /(?:compensation|payment|refund|paid|approved)\D{0,20}(\d+(?:\.\d{1,2})?)/g
  );

  for (const match of amountMatches) {
    matches.push(Number(match[1]));
  }

  const cleanMatches = matches.filter(
    (value) => !Number.isNaN(value) && value > 0 && value < 10000
  );

  if (cleanMatches.length === 0) {
    return null;
  }

  return Math.max(...cleanMatches);
}


function normaliseSubmissionIssueText(issue) {
  if (!issue) {
    return "";
  }

  if (typeof issue === "string") {
    return issue;
  }

  const parts = [
    issue.label,
    issue.message,
    issue.field,
    issue.key,
    issue.name,
    issue.path,
    issue.code,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" ");
  }

  try {
    return JSON.stringify(issue);
  } catch {
    return String(issue);
  }
}

function cleanIssueText(issue) {
  return normaliseSubmissionIssueText(issue)
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCustomerMissingDetailLabel(issue) {
  const readableText = cleanIssueText(issue);
  const lowerText = readableText.toLowerCase();

  if (!lowerText) {
    return "A required claim detail is missing.";
  }

  if (
    lowerText.includes("smartcard") ||
    lowerText.includes("smart card")
  ) {
    return "Smartcard number is missing.";
  }

  if (
    lowerText.includes("booking reference") ||
    lowerText.includes("ticket reference") ||
    lowerText.includes("reference number")
  ) {
    return "Booking reference is missing.";
  }

  if (
    lowerText.includes("ticket cost") ||
    lowerText.includes("ticket price") ||
    lowerText.includes("ticket fare") ||
    lowerText.includes("fare paid") ||
    lowerText.includes("cost paid") ||
    lowerText.includes("ticket amount")
  ) {
    return "Ticket cost is missing.";
  }

  if (
    lowerText.includes("ticket type") ||
    lowerText.includes("season ticket type")
  ) {
    return "Ticket type is missing.";
  }

  if (
    lowerText.includes("valid from") ||
    lowerText.includes("valid until") ||
    lowerText.includes("valid to") ||
    lowerText.includes("ticket start") ||
    lowerText.includes("ticket end") ||
    lowerText.includes("ticket date") ||
    lowerText.includes("season ticket date")
  ) {
    return "Ticket dates are missing.";
  }

  if (
    lowerText.includes("ticket") &&
    (lowerText.includes("origin") ||
      lowerText.includes("destination") ||
      lowerText.includes("route") ||
      lowerText.includes("station"))
  ) {
    return "Ticket route is incomplete.";
  }

  if (
    lowerText.includes("commute") &&
    (lowerText.includes("origin") ||
      lowerText.includes("destination") ||
      lowerText.includes("route") ||
      lowerText.includes("station"))
  ) {
    return "Commute route is incomplete.";
  }

  if (
    lowerText.includes("origin") ||
    lowerText.includes("destination") ||
    lowerText.includes("station") ||
    lowerText.includes("route")
  ) {
    return "Journey route is incomplete.";
  }

  if (
    lowerText.includes("outbound") ||
    lowerText.includes("return") ||
    lowerText.includes("travel window") ||
    lowerText.includes("window") ||
    lowerText.includes("scheduled time") ||
    lowerText.includes("journey time")
  ) {
    return "Travel window is missing.";
  }

  if (
    lowerText.includes("travel days") ||
    lowerText.includes("travel day") ||
    lowerText.includes("commute days")
  ) {
    return "Travel days are missing.";
  }

  if (
    lowerText.includes("operator") ||
    lowerText.includes("train company") ||
    lowerText.includes("toc")
  ) {
    return "Train operator is missing.";
  }

  if (
    lowerText.includes("delay date") ||
    lowerText.includes("journey date") ||
    lowerText.includes("travel date")
  ) {
    return "Delay date is missing.";
  }

  if (
    lowerText.includes("delay minutes") ||
    lowerText.includes("delay length") ||
    lowerText.includes("delay duration")
  ) {
    return "Delay length is missing.";
  }

  if (
    lowerText.includes("profile") ||
    lowerText.includes("passenger") ||
    lowerText.includes("full name") ||
    lowerText.includes("first name") ||
    lowerText.includes("last name") ||
    lowerText.includes("email") ||
    lowerText.includes("phone") ||
    lowerText.includes("mobile")
  ) {
    return "Passenger contact details are missing.";
  }

  const fallbackText = readableText || "Required claim detail";
  return `${fallbackText.charAt(0).toUpperCase()}${fallbackText.slice(1)} is missing.`;
}

function getMissingDetailDestinationFromLabel(label) {
  const lowerLabel = (label || "").toLowerCase();

  if (
    lowerLabel.includes("ticket") ||
    lowerLabel.includes("smartcard") ||
    lowerLabel.includes("booking reference")
  ) {
    return "ticket";
  }

  if (
    lowerLabel.includes("commute") ||
    lowerLabel.includes("journey") ||
    lowerLabel.includes("travel window") ||
    lowerLabel.includes("travel days") ||
    lowerLabel.includes("train operator") ||
    lowerLabel.includes("delay")
  ) {
    return "commute";
  }

  return "claim";
}

function buildCustomerBlockingIssues(validation) {
  const rawIssues = [
    ...(Array.isArray(validation?.missingFields)
      ? validation.missingFields
      : []),
    ...(Array.isArray(validation?.errors)
      ? validation.errors
      : []),
  ];

  const seenLabels = new Set();

  return rawIssues
    .map((issue) => {
      const rawText = normaliseSubmissionIssueText(issue);
      const label = getCustomerMissingDetailLabel(issue);

      if (!label || seenLabels.has(label)) {
        return null;
      }

      seenLabels.add(label);

      return {
        label,
        message: label,
        section: getMissingDetailDestinationFromLabel(label),
        raw: rawText,
      };
    })
    .filter(Boolean);
}

function buildValidationResponse(validation) {
  const blockingIssues = buildCustomerBlockingIssues(validation);
  const blockingLabels = blockingIssues.map((issue) => issue.label);

  return {
    valid: validation.valid,
    ready_for_submission: validation.readyForSubmission,
    readyForSubmission: validation.readyForSubmission,
    blocking_issue_count: validation.blockingIssueCount,
    blockingIssueCount: validation.blockingIssueCount,
    warning_count: validation.warningCount,
    warningCount: validation.warningCount,
    missing_fields: validation.missingFields,
    missingFields: validation.missingFields,
    errors: validation.errors,
    warnings: validation.warnings,
    blocking_issues: blockingIssues,
    blockingIssues,
    missing_detail_labels: blockingLabels,
    customer_missing_details: blockingLabels,
    checked_at: validation.checkedAt,
    checkedAt: validation.checkedAt,
    context_version: validation.contextVersion,
    contextVersion: validation.contextVersion,
  };
}

function buildOperatorIntegrationPendingCopy({ submissionContext, detectedDelay } = {}) {
  const operatorName =
    submissionContext?.operator?.displayName ||
    submissionContext?.operator?.suppliedName ||
    detectedDelay?.operator ||
    "this train operator";

  return {
    customer_status: "operator_submission_pending",
    customer_title: "Claim ready for Delai submission",
    customer_message: `Your claim is ready. Delai is preparing automatic submission for ${operatorName}.`,
    customer_next_step:
      "No further action is needed right now. Delai has saved the claim details and will continue from here as the operator connection is completed.",
  };
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

function calculateClaimPayment({ compensationAmount, feePercentage = 10 }) {
  const cleanCompensationAmount = Number(compensationAmount);
  const cleanFeePercentage = Number(feePercentage || 10);

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

function formatClaimRoute(origin, destination) {
  if (!origin || !destination) {
    return "Not recorded";
  }

  return `${origin} to ${destination}`;
}

async function prepareClaimRecord({ userId, claimId }) {
  const { data: claim, error: claimError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", claimId)
      .eq("user_id", userId)
      .maybeSingle(),
    10000,
    "Automatic claim preparation lookup"
  );

  if (claimError) {
    throw claimError;
  }

  if (!claim) {
    throw new Error("Claim not found.");
  }

  if (claim.status === "submitted") {
    return claim;
  }

  const { data: detectedDelay, error: delayError } = await withTimeout(
    supabaseAdmin
      .from("detected_delays")
      .select("*")
      .eq("id", claim.detected_delay_id)
      .eq("user_id", userId)
      .maybeSingle(),
    10000,
    "Automatic claim delay lookup"
  );

  if (delayError) {
    throw delayError;
  }

  if (!detectedDelay) {
    throw new Error("Linked detected delay not found.");
  }

  const { data: seasonTickets, error: ticketError } = await withTimeout(
    supabaseAdmin
      .from("season_tickets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
    10000,
    "Automatic claim ticket lookup"
  );

  if (ticketError) {
    throw ticketError;
  }

  const { data: commutes, error: commuteError } = await withTimeout(
    supabaseAdmin
      .from("commutes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
    10000,
    "Automatic claim commute lookup"
  );

  if (commuteError) {
    throw commuteError;
  }

  const seasonTicket = seasonTickets?.[0] || null;
  const commute = commutes?.[0] || null;

  const operatorGuidance = getOperatorClaimGuidance(
    detectedDelay.operator || commute?.operator || seasonTicket?.operator
  );

  const travelDays = Array.isArray(commute?.travel_days)
    ? commute.travel_days.join(", ")
    : commute?.travel_days || "Not recorded";

  const preparedSummary = `
Delay Repay Claim Summary

Claim status: prepared automatically by Delai

Operator-specific guidance:
- Operator: ${operatorGuidance.operatorName}
- Claim portal: ${operatorGuidance.claimPortal}
- Delay threshold: ${operatorGuidance.delayThreshold}
- Evidence needed: ${operatorGuidance.evidenceNeeded}

Delay details:
- Date: ${detectedDelay.delay_date || "Not recorded"}
- Route: ${formatClaimRoute(
    detectedDelay.origin_station,
    detectedDelay.destination_station
  )}
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
- Ticket route: ${formatClaimRoute(
    seasonTicket?.origin_station,
    seasonTicket?.destination_station
  )}
- Ticket type: ${seasonTicket?.ticket_type || "Not recorded"}
- Ticket cost: ${seasonTicket?.ticket_cost || "Not recorded"}
- Ticket start date: ${seasonTicket?.ticket_start_date || "Not recorded"}
- Ticket end date: ${seasonTicket?.ticket_end_date || "Not recorded"}
- Smartcard provider: ${seasonTicket?.smartcard_provider || "Not recorded"}
- Smartcard number: ${seasonTicket?.smartcard_number || "Not recorded"}

Commute details:
- Saved commute route: ${formatClaimRoute(
    commute?.origin_station,
    commute?.destination_station
  )}
- Outbound window: ${commute?.outbound_time || "Not recorded"}
- Return window: ${commute?.return_time || "Not recorded"}
- Travel days: ${travelDays}

Passenger confirmation:
- The passenger previously confirmed this commute and ticket information.

Suggested claim wording:
${operatorGuidance.suggestedWording}
`.trim();

  const { data: updatedClaim, error: updateError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .update({
        status: "prepared",
        prepared_summary: preparedSummary,
        prepared_at: new Date().toISOString(),
        submission_status: "not_started",
        submission_error: null,
      })
      .eq("id", claimId)
      .eq("user_id", userId)
      .select("*")
      .single(),
    10000,
    "Automatic claim preparation update"
  );

  if (updateError) {
    throw updateError;
  }

  return updatedClaim;
}
async function loadClaimSubmissionContext({
  claim,
  detectedDelay,
}) {
  if (!claim?.user_id) {
    throw new Error(
      "Claim user ID is required to load submission context."
    );
  }

  if (!detectedDelay?.id) {
    throw new Error(
      "Detected delay is required to load submission context."
    );
  }

  let profile = null;

  const {
    data: profileById,
    error: profileByIdError,
  } = await withTimeout(
    supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", claim.user_id)
      .maybeSingle(),
    10000,
    "Submission profile lookup by ID"
  );

  if (!profileByIdError) {
    profile = profileById;
  } else {
    const {
      data: profileByUserId,
      error: profileByUserIdError,
    } = await withTimeout(
      supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("user_id", claim.user_id)
        .maybeSingle(),
      10000,
      "Submission profile lookup by user ID"
    );

    if (profileByUserIdError) {
      throw profileByUserIdError;
    }

    profile = profileByUserId;
  }

  const {
    data: seasonTickets,
    error: seasonTicketError,
  } = await withTimeout(
    supabaseAdmin
      .from("season_tickets")
      .select("*")
      .eq("user_id", claim.user_id)
      .order("created_at", { ascending: false })
      .limit(1),
    10000,
    "Submission season ticket lookup"
  );

  if (seasonTicketError) {
    throw seasonTicketError;
  }

  const seasonTicket = seasonTickets?.[0] || null;

  let commute = null;

  if (detectedDelay.commute_id) {
    const {
      data: linkedCommute,
      error: linkedCommuteError,
    } = await withTimeout(
      supabaseAdmin
        .from("commutes")
        .select("*")
        .eq("id", detectedDelay.commute_id)
        .eq("user_id", claim.user_id)
        .maybeSingle(),
      10000,
      "Submission linked commute lookup"
    );

    if (linkedCommuteError) {
      throw linkedCommuteError;
    }

    commute = linkedCommute;
  }

  if (!commute) {
    const {
      data: recentCommutes,
      error: recentCommuteError,
    } = await withTimeout(
      supabaseAdmin
        .from("commutes")
        .select("*")
        .eq("user_id", claim.user_id)
        .order("created_at", { ascending: false })
        .limit(1),
      10000,
      "Submission recent commute lookup"
    );

    if (recentCommuteError) {
      throw recentCommuteError;
    }

    commute = recentCommutes?.[0] || null;
  }
  const { data: authUserData, error: authUserError } =
  await withTimeout(
    supabaseAdmin.auth.admin.getUserById(
      claim.user_id
    ),
    10000,
    "Submission context auth user lookup"
  );

    if (authUserError) {
   throw authUserError;
  }

  const authUser = authUserData?.user || null;

  return buildClaimSubmissionContext({
  claim,
  detectedDelay,
  profile,
  authUser,
  seasonTicket,
  commute,
});
}
async function submitClaimThroughOperatorAdapter({
  claim,
  detectedDelay,
  submissionContext,
}) {
  const operatorAdapter = getOperatorAdapter({
    operator:
      submissionContext?.operator?.suppliedName ||
      detectedDelay?.operator,
    allowSimulation:
      process.env.ALLOW_SIMULATED_OPERATOR_SUBMISSION === "true",
  });

  return operatorAdapter.submitClaim({
    claim,
    detectedDelay,
    submissionContext,
  });
}

async function ensureClaimForDetectedDelay(detectedDelay) {
  const { data: existingClaim, error: existingError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("user_id", detectedDelay.user_id)
      .eq("detected_delay_id", detectedDelay.id)
      .maybeSingle(),
    10000,
    "Detected delay claim lookup"
  );

  if (existingError) {
    throw existingError;
  }

  let claim = existingClaim;

  if (!claim) {
    const { data: insertedClaim, error: insertError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .insert([
          {
            user_id: detectedDelay.user_id,
            detected_delay_id: detectedDelay.id,
            status: "draft",
            submission_status: "not_started",
          },
        ])
        .select("*")
        .single(),
      10000,
      "Automatic claim creation"
    );

    if (insertError) {
      throw insertError;
    }

    claim = insertedClaim;
  }

  let jobType = "claim_prepare";

  if (claim.status === "prepared" || claim.status === "ready_to_submit") {
    jobType = "claim_submit";
  }

  if (claim.status === "submitted") {
    jobType = "claim_check_outcome";
  }

  const automationJob = await queueAutomationJob({
    userId: claim.user_id,
    claimId: claim.id,
    jobType,
  });

  return {
    claim,
    automationJob,
  };
}

async function processClaimPrepareJob(job) {
  const { data: currentClaim, error: currentClaimError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", job.claim_id)
      .eq("user_id", job.user_id)
      .maybeSingle(),
    10000,
    "Claim preparation job lookup"
  );

  if (currentClaimError) {
    throw currentClaimError;
  }

  if (!currentClaim) {
    return {
      success: true,
      message: "Claim no longer exists.",
    };
  }

  if (currentClaim.status === "submitted") {
    const outcomeJob = await queueAutomationJob({
      userId: currentClaim.user_id,
      claimId: currentClaim.id,
      jobType: "claim_check_outcome",
    });

    return {
      success: true,
      message: "Claim was already submitted. Outcome monitoring queued.",
      next_job: outcomeJob,
    };
  }

  let preparedClaim = currentClaim;

  if (
    currentClaim.status !== "prepared" &&
    currentClaim.status !== "ready_to_submit"
  ) {
    preparedClaim = await prepareClaimRecord({
      userId: currentClaim.user_id,
      claimId: currentClaim.id,
    });
  }

  const submitJob = await queueAutomationJob({
    userId: preparedClaim.user_id,
    claimId: preparedClaim.id,
    jobType: "claim_submit",
  });

  return {
    success: true,
    message: "Claim prepared automatically. Submission job queued.",
    claim: preparedClaim,
    next_job: submitJob,
  };
}

async function processClaimSubmitJob(job) {
  const { data: claim, error: claimError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", job.claim_id)
      .eq("user_id", job.user_id)
      .maybeSingle(),
    10000,
    "Claim submission job lookup"
  );

  if (claimError) {
    throw claimError;
  }

  if (!claim) {
    return {
      success: true,
      message: "Claim no longer exists.",
    };
  }

  if (claim.status === "submitted") {
    const outcomeJob = await queueAutomationJob({
      userId: claim.user_id,
      claimId: claim.id,
      jobType: "claim_check_outcome",
    });

    return {
      success: true,
      message: "Claim was already submitted. Outcome monitoring queued.",
      next_job: outcomeJob,
    };
  }

  if (claim.status !== "prepared" && claim.status !== "ready_to_submit") {
    throw new Error(
      `Claim is not ready for submission. Current status: ${claim.status}.`
    );
  }

  const { data: detectedDelay, error: delayError } = await withTimeout(
    supabaseAdmin
      .from("detected_delays")
      .select("*")
      .eq("id", claim.detected_delay_id)
      .eq("user_id", claim.user_id)
      .maybeSingle(),
    10000,
    "Submission delay lookup"
  );

  if (delayError) {
    throw delayError;
  }

  if (!detectedDelay) {
    throw new Error("Linked detected delay not found for submission.");
  }
  const submissionContext =
  await loadClaimSubmissionContext({
    claim,
    detectedDelay,
  });

const submissionValidation =
  validateSubmissionContext(submissionContext);

const attemptedAt = new Date().toISOString();

if (!submissionValidation.readyForSubmission) {
  const validationResponse = buildValidationResponse(submissionValidation);
  const customerMessage =
    "A few details are still needed before Delai can submit this claim.";

  const { error: validationUpdateError } =
    await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          status: "ready_to_submit",
          submission_status: "awaiting_information",
          submission_attempted_at: attemptedAt,
          submission_error: customerMessage,
          submission_source:
            "universal_submission_validation",
        })
        .eq("id", claim.id)
        .eq("user_id", claim.user_id),
      10000,
      "Block invalid claim submission"
    );

  if (validationUpdateError) {
    throw validationUpdateError;
  }

  return {
    success: true,
    blocked: true,
    ready: false,
    message: customerMessage,
    customer_message: customerMessage,
    validation: validationResponse,
    blocking_issues: validationResponse.blocking_issues,
    missing_fields: validationResponse.missing_fields,
  };
}

  const { error: processingUpdateError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .update({
        status: "ready_to_submit",
        submission_status: "processing",
        submission_attempted_at: attemptedAt,
        submission_error: null,
      })
      .eq("id", claim.id)
      .eq("user_id", claim.user_id),
    10000,
    "Mark submission processing"
  );

  if (processingUpdateError) {
    throw processingUpdateError;
  }

  const submissionResult = await submitClaimThroughOperatorAdapter({
    claim,
    detectedDelay,
    submissionContext,
   });

  if (!submissionResult.submitted) {
    const { error: blockUpdateError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          status: "ready_to_submit",
          submission_status: "awaiting_operator_integration",
          submission_attempted_at: attemptedAt,
          submission_error: submissionResult.reason,
          submission_source: submissionResult.source,
        })
        .eq("id", claim.id)
        .eq("user_id", claim.user_id),
      10000,
      "Block claim submission"
    );

    if (blockUpdateError) {
      throw blockUpdateError;
    }

    const operatorPendingCopy = buildOperatorIntegrationPendingCopy({
      submissionContext,
      detectedDelay,
    });

    return {
      success: true,
      blocked: true,
      message: operatorPendingCopy.customer_message,
      customer_message: operatorPendingCopy.customer_message,
      customer_title: operatorPendingCopy.customer_title,
      customer_next_step: operatorPendingCopy.customer_next_step,
      customer_status: operatorPendingCopy.customer_status,
      submission: {
        ...submissionResult,
        ...operatorPendingCopy,
      },
    };
  }

  const { data: submittedClaim, error: submissionUpdateError } =
    await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          status: "submitted",
          submitted_at: submissionResult.submittedAt,
          operator_reference: submissionResult.operatorReference,
          submission_status: "submitted",
          submission_attempted_at: attemptedAt,
          submission_error: null,
          submission_source: submissionResult.source,
        })
        .eq("id", claim.id)
        .eq("user_id", claim.user_id)
        .select("*")
        .single(),
      10000,
      "Complete automatic claim submission"
    );

  if (submissionUpdateError) {
    throw submissionUpdateError;
  }

  const outcomeJob = await queueAutomationJob({
    userId: submittedClaim.user_id,
    claimId: submittedClaim.id,
    jobType: "claim_check_outcome",
  });

  return {
    success: true,
    message: "Claim submitted automatically.",
    claim: submittedClaim,
    submission: submissionResult,
    next_job: outcomeJob,
  };
}

async function queueAutomationJob({
  userId,
  claimId = null,
  jobType,
  runAfter = null,
  force = false,
}) {
  if (!userId) {
    throw new Error("Missing userId for automation job.");
  }

  if (!jobType || !AUTOMATION_JOB_TYPES.includes(jobType)) {
    throw new Error("Invalid automation job type.");
  }

  if (!force && claimId) {
    const { data: existingJobs, error: existingError } = await withTimeout(
      supabaseAdmin
        .from("automation_jobs")
        .select("id, status, run_after")
        .eq("user_id", userId)
        .eq("claim_id", claimId)
        .eq("job_type", jobType)
        .in("status", ["queued", "retry", "processing"])
        .order("created_at", { ascending: false })
        .limit(1),
      10000,
      "Existing automation job lookup"
    );

    if (existingError) {
      throw existingError;
    }

    if (existingJobs?.length > 0) {
      return {
        skipped: true,
        reason: "existing_job",
        job: existingJobs[0],
      };
    }
  }

  const { data, error } = await withTimeout(
    supabaseAdmin
      .from("automation_jobs")
      .insert([
        {
          user_id: userId,
          claim_id: claimId,
          job_type: jobType,
          status: "queued",
          run_after: runAfter || new Date().toISOString(),
        },
      ])
      .select("*")
      .single(),
    10000,
    "Queue automation job"
  );

  if (error) {
    throw error;
  }

  return {
    skipped: false,
    job: data,
  };
}

async function completeAutomationJob(jobId) {
  const { error } = await withTimeout(
    supabaseAdmin
      .from("automation_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", jobId),
    10000,
    "Complete automation job"
  );

  if (error) {
    throw error;
  }
}

async function blockAutomationJob(jobId, reason) {
  const { error } = await withTimeout(
    supabaseAdmin
      .from("automation_jobs")
      .update({
        status: "blocked",
        last_error: reason || "Automation job is blocked.",
      })
      .eq("id", jobId),
    10000,
    "Block automation job"
  );

  if (error) {
    throw error;
  }
}

async function failAutomationJob(job, error) {
  const nextAttempts = Number(job.attempts || 0) + 1;
  const shouldFail = nextAttempts >= AUTOMATION_RETRY_LIMIT;

  const { error: updateError } = await withTimeout(
    supabaseAdmin
      .from("automation_jobs")
      .update({
        status: shouldFail ? "failed" : "retry",
        attempts: nextAttempts,
        last_error: error.message || "Unknown automation error",
        run_after: shouldFail
          ? job.run_after
          : getFutureIsoDate({ minutes: 20 }),
      })
      .eq("id", job.id),
    10000,
    "Fail automation job"
  );

  if (updateError) {
    console.error("Failed to update failed automation job:", updateError);
  }
}

async function queueSubmittedClaimOutcomeJobs({ limit = 20 }) {
  const safeLimit = getSafeLimit(limit, 20, 100);

  const { data: claims, error } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("id, user_id, status, outcome")
      .eq("status", "submitted")
      .or("outcome.is.null,outcome.eq.still_waiting")
      .order("submitted_at", { ascending: true })
      .limit(safeLimit),
    15000,
    "Submitted claims automation lookup"
  );

  if (error) {
    throw error;
  }

  let queuedCount = 0;
  let skippedCount = 0;

  for (const claim of claims || []) {
    const result = await queueAutomationJob({
      userId: claim.user_id,
      claimId: claim.id,
      jobType: "claim_check_outcome",
    });

    if (result.skipped) {
      skippedCount += 1;
    } else {
      queuedCount += 1;
    }
  }

  return {
    found_count: claims?.length || 0,
    queued_count: queuedCount,
    skipped_count: skippedCount,
  };
}

async function processClaimCheckOutcomeJob(job) {
  const { data: claim, error: claimError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", job.claim_id)
      .eq("user_id", job.user_id)
      .maybeSingle(),
    10000,
    "Automation outcome claim lookup"
  );

  if (claimError) {
    throw claimError;
  }

  if (!claim) {
    return {
      success: true,
      message: "Claim no longer exists.",
    };
  }

  if (claim.status !== "submitted") {
    return {
      success: true,
      message: `Claim is not submitted. Current status: ${claim.status}.`,
    };
  }

  const detectedOutcome = detectClaimOutcomeFromText(claim);

  if (detectedOutcome === "still_waiting") {
    await queueAutomationJob({
      userId: claim.user_id,
      claimId: claim.id,
      jobType: "claim_check_outcome",
      runAfter: getFutureIsoDate({ hours: 24 }),
      force: true,
    });

    return {
      success: true,
      outcome: "still_waiting",
      updated: false,
      message: "No final outcome detected. Queued another check.",
    };
  }

  if (claim.outcome === detectedOutcome) {
    if (detectedOutcome === "paid") {
      await queueAutomationJob({
        userId: claim.user_id,
        claimId: claim.id,
        jobType: "claim_check_payment",
      });
    }

    return {
      success: true,
      outcome: detectedOutcome,
      updated: false,
      message: "Claim outcome already up to date.",
    };
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
    "Automation claim outcome update"
  );

  if (updateError) {
    throw updateError;
  }

  let notificationResult = null;

  try {
    notificationResult = await createNotificationForOutcomeChange({
      userId: claim.user_id,
      claimId: claim.id,
      previousOutcome: claim.outcome,
      newOutcome: detectedOutcome,
    });
  } catch (notificationError) {
    console.error(
      "Automation outcome notification failed, but outcome was updated:",
      notificationError
    );

    notificationResult = {
      skipped: true,
      reason: "notification_failed",
      error: notificationError.message,
    };
  }

  if (detectedOutcome === "paid") {
    await queueAutomationJob({
      userId: claim.user_id,
      claimId: claim.id,
      jobType: "claim_check_payment",
    });
  }

  return {
    success: true,
    outcome: detectedOutcome,
    updated: true,
    notification: notificationResult,
    claim: updatedClaim,
  };
}

async function processClaimCheckPaymentJob(job) {
  const { data: claim, error: claimError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", job.claim_id)
      .eq("user_id", job.user_id)
      .maybeSingle(),
    10000,
    "Automation payment claim lookup"
  );

  if (claimError) {
    throw claimError;
  }

  if (!claim) {
    return {
      success: true,
      message: "Claim no longer exists.",
    };
  }

  if (claim.outcome !== "paid") {
    return {
      success: true,
      message: "Claim has not been paid, so payment checking is not needed.",
    };
  }

  if (claim.compensation_amount) {
    if (claim.payment_status === "fee_due") {
      await queueAutomationJob({
        userId: claim.user_id,
        claimId: claim.id,
        jobType: "claim_collect_fee",
      });
    }

    return {
      success: true,
      message: "Payment already recorded.",
      compensation_amount: claim.compensation_amount,
      payment_status: claim.payment_status,
    };
  }

  const extractedAmount = extractCompensationAmountFromText(claim);

  if (!extractedAmount) {
    await queueAutomationJob({
      userId: claim.user_id,
      claimId: claim.id,
      jobType: "claim_check_payment",
      runAfter: getFutureIsoDate({ hours: 24 }),
      force: true,
    });

    return {
      success: true,
      message:
        "Claim is paid, but no compensation amount was detected yet. Queued another payment check.",
    };
  }

  const payment = calculateClaimPayment({
    compensationAmount: extractedAmount,
    feePercentage: claim.fee_percentage || 10,
  });

  const now = new Date().toISOString();

  const { data: updatedClaim, error: updateError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .update({
        compensation_amount: payment.compensationAmount,
        fee_percentage: payment.feePercentage,
        delai_fee_amount: payment.delaiFeeAmount,
        user_payout_amount: payment.userPayoutAmount,
        payment_status: "fee_due",
        payment_recorded_at: now,
      })
      .eq("id", claim.id)
      .eq("user_id", claim.user_id)
      .select("*")
      .single(),
    10000,
    "Automation payment update"
  );

  if (updateError) {
    throw updateError;
  }

  let paymentNotification = null;

  try {
    paymentNotification = await createClaimNotification({
      userId: claim.user_id,
      claimId: claim.id,
      type: "claim_payment_recorded",
      title: "Payment recorded",
      message: `A compensation payment of £${payment.compensationAmount.toFixed(
        2
      )} has been recorded. Delai's success fee is £${payment.delaiFeeAmount.toFixed(
        2
      )}, and you keep £${payment.userPayoutAmount.toFixed(2)}.`,
    });
  } catch (notificationError) {
    console.error(
      "Automation payment notification failed, but payment was recorded:",
      notificationError
    );

    paymentNotification = {
      skipped: true,
      reason: "notification_failed",
      error: notificationError.message,
    };
  }

  await queueAutomationJob({
    userId: claim.user_id,
    claimId: claim.id,
    jobType: "claim_collect_fee",
  });

  return {
    success: true,
    message: "Payment amount detected and recorded.",
    payment,
    notification: paymentNotification,
    claim: updatedClaim,
  };
}

async function processClaimCollectFeeJob(job) {
  const { data: claim, error: claimError } = await withTimeout(
    supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", job.claim_id)
      .eq("user_id", job.user_id)
      .maybeSingle(),
    10000,
    "Automation fee claim lookup"
  );

  if (claimError) {
    throw claimError;
  }

  if (!claim) {
    return {
      success: true,
      message: "Claim no longer exists.",
    };
  }

  if (claim.payment_status === "fee_collected") {
    return {
      success: true,
      message: "Delai success fee has already been collected.",
    };
  }

  if (claim.payment_status !== "fee_due") {
    return {
      success: true,
      message: `Fee collection not ready. Current payment status: ${
        claim.payment_status || "not_paid"
      }.`,
    };
  }

  await createClaimNotification({
    userId: claim.user_id,
    claimId: claim.id,
    type: "claim_fee_due",
    title: "Delai success fee due",
    message: `Your claim compensation has been recorded. Delai's success fee is £${Number(
      claim.delai_fee_amount || 0
    ).toFixed(2)}.`,
  });

  return {
    success: true,
    message:
      "Fee due notification created. Stripe fee collection will be connected next.",
  };
}

async function processAutomationJob(job) {
  if (job.job_type === "claim_prepare") {
    return processClaimPrepareJob(job);
  }

  if (job.job_type === "claim_submit") {
    return processClaimSubmitJob(job);
  }

  if (job.job_type === "claim_check_outcome") {
    return processClaimCheckOutcomeJob(job);
  }

  if (job.job_type === "claim_check_payment") {
    return processClaimCheckPaymentJob(job);
  }

  if (job.job_type === "claim_collect_fee") {
    return processClaimCollectFeeJob(job);
  }

  return {
    success: true,
    message: `No processor yet for job type: ${job.job_type}`,
  };
}

async function processAutomationJobs({ limit = 20 }) {
  const safeLimit = getSafeLimit(limit, 20, 100);

  const queuedSubmittedClaims = await queueSubmittedClaimOutcomeJobs({
    limit: safeLimit,
  });

  const { data: jobs, error: jobsError } = await withTimeout(
    supabaseAdmin
      .from("automation_jobs")
      .select("*")
      .in("status", ["queued", "retry"])
      .lte("run_after", new Date().toISOString())
      .order("run_after", { ascending: true })
      .limit(safeLimit),
    15000,
    "Automation jobs lookup"
  );

  if (jobsError) {
    throw jobsError;
  }

  const results = [];
  let completedCount = 0;
  let blockedCount = 0;
  let failedCount = 0;

  for (const job of jobs || []) {
    try {
      const nextAttempts = Number(job.attempts || 0) + 1;

      const { data: processingJob, error: processingError } = await withTimeout(
        supabaseAdmin
          .from("automation_jobs")
          .update({
            status: "processing",
            attempts: nextAttempts,
            last_error: null,
          })
          .eq("id", job.id)
          .select("*")
          .single(),
        10000,
        "Mark automation job processing"
      );

      if (processingError) {
        throw processingError;
      }

      const result = await processAutomationJob(processingJob);

      if (result?.blocked) {
        await blockAutomationJob(
          processingJob.id,
          result.message || "Operator integration is not connected."
        );

        blockedCount += 1;
      } else {
        await completeAutomationJob(processingJob.id);
        completedCount += 1;
      }

      results.push({
        job_id: processingJob.id,
        job_type: processingJob.job_type,
        claim_id: processingJob.claim_id,
        success: true,
        result,
      });
    } catch (jobError) {
      console.error("Automation job failed:", {
        job_id: job.id,
        job_type: job.job_type,
        error: jobError.message,
      });

      await failAutomationJob(job, jobError);

      failedCount += 1;

      results.push({
        job_id: job.id,
        job_type: job.job_type,
        claim_id: job.claim_id,
        success: false,
        error: jobError.message,
      });
    }
  }

  return {
    success: true,
    queued_submitted_claims: queuedSubmittedClaims,
    processed_count: jobs?.length || 0,
    completed_count: completedCount,
    blocked_count: blockedCount,
    failed_count: failedCount,
    results,
  };
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "delai-backend",
  });
});
app.get("/operators", (req, res) => {
  const operators = getAllOperators().map((operator) => {
    const integration = getOperatorIntegrationStatus(
      operator.key
    );

    return {
      key: operator.key,
      display_name: operator.displayName,
      aliases: operator.aliases,
      submission_adapter_connected:
        integration.adapterRegistered,
      integration_status:
        integration.integrationStatus,
    };
  });

  return res.json({
    ok: true,
    operator_count: operators.length,
    operators,
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

    const forceDetection = req.body?.force === true;

     if (!forceDetection && !travelDays.includes(todayDay)) {
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

      try {
        const claimAutomation = await ensureClaimForDetectedDelay(insertedDelay);

        console.log("Automatic claim pipeline started:", {
          delay_id: insertedDelay.id,
          claim_id: claimAutomation.claim?.id,
          job_type: claimAutomation.automationJob?.job?.job_type,
        });
      } catch (automationError) {
        console.error(
          "Delay created, but automatic claim pipeline could not start:",
          {
            delay_id: insertedDelay.id,
            error: automationError.message,
          }
        );
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
app.post("/validate-claim-submission", async (req, res) => {
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
        .maybeSingle(),
      10000,
      "Submission validation claim lookup"
    );

    if (claimError) {
      throw claimError;
    }

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (!claim.detected_delay_id) {
      return res.status(400).json({
        success: false,
        error: "Claim has no linked detected delay",
      });
    }

    const { data: detectedDelay, error: delayError } =
      await withTimeout(
        supabaseAdmin
          .from("detected_delays")
          .select("*")
          .eq("id", claim.detected_delay_id)
          .eq("user_id", user_id)
          .maybeSingle(),
        10000,
        "Submission validation delay lookup"
      );

    if (delayError) {
      throw delayError;
    }

    if (!detectedDelay) {
      return res.status(404).json({
        success: false,
        error: "Linked detected delay not found",
      });
    }

    const submissionContext =
      await loadClaimSubmissionContext({
        claim,
        detectedDelay,
      });

    const validation =
      validateSubmissionContext(submissionContext);

    return res.json({
      success: true,
      ready_for_submission:
        validation.readyForSubmission,
      claim: {
        id: claim.id,
        status: claim.status,
        submission_status:
          claim.submission_status || null,
      },
      operator: {
        key: submissionContext.operator?.key || null,
        display_name:
          submissionContext.operator?.displayName || null,
        known_operator:
          submissionContext.operator?.knownOperator === true,
      },
      validation: buildValidationResponse(validation),
    });
  } catch (error) {
    console.error(
      "Validate claim submission error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Failed to validate claim submission",
      details: error.message,
    });
  }
});


app.post("/submit-claim-with-delai", async (req, res) => {
  try {
    const { user_id, claim_id } = req.body || {};

    if (!user_id || !claim_id) {
      return res.status(400).json({
        success: false,
        ready: false,
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
      "Submit with Delai claim lookup"
    );

    if (claimError) {
      throw claimError;
    }

    if (!claim) {
      return res.status(404).json({
        success: false,
        ready: false,
        error: "Claim not found",
      });
    }

    if (claim.status === "submitted") {
      return res.json({
        success: true,
        ready: true,
        submitted: true,
        message:
          "This claim has already been submitted. Delai will continue tracking it automatically.",
        claim,
        claim_status: claim.status,
        submission_status: claim.submission_status || "submitted",
      });
    }

    if (!claim.detected_delay_id) {
      return res.status(400).json({
        success: false,
        ready: false,
        error: "Claim has no linked detected delay",
      });
    }

    const { data: detectedDelay, error: delayError } = await withTimeout(
      supabaseAdmin
        .from("detected_delays")
        .select("*")
        .eq("id", claim.detected_delay_id)
        .eq("user_id", user_id)
        .maybeSingle(),
      10000,
      "Submit with Delai detected delay lookup"
    );

    if (delayError) {
      throw delayError;
    }

    if (!detectedDelay) {
      return res.status(404).json({
        success: false,
        ready: false,
        error: "Linked detected delay not found",
      });
    }

    const submissionContext = await loadClaimSubmissionContext({
      claim,
      detectedDelay,
    });

    const validation = validateSubmissionContext(submissionContext);
    const validationResponse = buildValidationResponse(validation);

    if (!validation.readyForSubmission) {
      const customerMessage =
        "A few details are still needed before Delai can submit this claim.";

      return res.status(400).json({
        success: false,
        ready: false,
        message: customerMessage,
        customer_message: customerMessage,
        validation: validationResponse,
        blocking_issues: validationResponse.blocking_issues,
        missing_fields: validationResponse.missing_fields,
        missing_detail_labels: validationResponse.missing_detail_labels,
      });
    }

    const preparedClaim = await prepareClaimRecord({
      userId: user_id,
      claimId: claim_id,
    });

    const { data: readyClaim, error: readyError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .update({
          status: "ready_to_submit",
          submission_status: "not_started",
          submission_error: null,
        })
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .select("*")
        .single(),
      10000,
      "Submit with Delai mark ready"
    );

    if (readyError) {
      throw readyError;
    }

    const submissionResult = await processClaimSubmitJob({
      id: `direct-submit-${claim_id}`,
      user_id,
      claim_id,
      job_type: "claim_submit",
    });

    const { data: latestClaim, error: latestClaimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .maybeSingle(),
      10000,
      "Submit with Delai latest claim lookup"
    );

    if (latestClaimError) {
      throw latestClaimError;
    }

    const finalClaim =
      submissionResult.claim || latestClaim || readyClaim || preparedClaim;

    if (submissionResult.blocked) {
      const submissionStatus =
        finalClaim?.submission_status ||
        submissionResult.submission?.status ||
        "awaiting_operator_integration";

      const awaitingInformation =
        submissionStatus === "awaiting_information";

      const operatorPendingCopy = buildOperatorIntegrationPendingCopy({
        submissionContext,
        detectedDelay,
      });

      const customerMessage = awaitingInformation
        ? "A few details are still needed before Delai can submit this claim."
        : submissionResult.customer_message ||
          submissionResult.submission?.customer_message ||
          operatorPendingCopy.customer_message;

      return res.json({
        success: true,
        ready: true,
        blocked: true,
        claim: finalClaim,
        claim_status: finalClaim?.status || "ready_to_submit",
        submission_status: submissionStatus,
        validation: validationResponse,
        submission: submissionResult.submission || submissionResult,
        message: customerMessage,
        customer_message: customerMessage,
        customer_title: awaitingInformation
          ? "More details needed"
          : submissionResult.customer_title ||
            submissionResult.submission?.customer_title ||
            operatorPendingCopy.customer_title,
        customer_next_step: awaitingInformation
          ? "Update the missing details, then Delai will check the claim again automatically."
          : submissionResult.customer_next_step ||
            submissionResult.submission?.customer_next_step ||
            operatorPendingCopy.customer_next_step,
        customer_status: awaitingInformation
          ? "awaiting_information"
          : submissionResult.customer_status ||
            submissionResult.submission?.customer_status ||
            operatorPendingCopy.customer_status,
      });
    }

    return res.json({
      success: true,
      ready: true,
      submitted: finalClaim?.status === "submitted",
      claim: finalClaim,
      claim_status: finalClaim?.status || "ready_to_submit",
      submission_status:
        finalClaim?.submission_status ||
        submissionResult.submission?.status ||
        null,
      validation: validationResponse,
      prepared_summary: preparedClaim?.prepared_summary || null,
      submission: submissionResult,
      message:
        submissionResult.message ||
        "Delai has started the claim submission process.",
    });
  } catch (error) {
    console.error("Submit claim with Delai error:", error);

    return res.status(500).json({
      success: false,
      ready: false,
      error: "Failed to submit claim with Delai",
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
        .maybeSingle(),
      10000,
      "Mark claim submitted lookup"
    );

    if (claimError) {
      throw claimError;
    }

    if (!claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    if (claim.status === "submitted") {
      return res.json({
        success: true,
        claim,
        message:
          "This claim has already been submitted. Delai will continue tracking it automatically.",
      });
    }

    if (claim.status !== "ready_to_submit") {
      return res.status(400).json({
        success: false,
        error:
          "Claim must be ready to submit before Delai can submit it automatically.",
        current_status: claim.status,
      });
    }

    const submissionResult = await processClaimSubmitJob({
      id: `manual-submit-${claim_id}`,
      user_id,
      claim_id,
      job_type: "claim_submit",
    });

    const { data: latestClaim, error: latestClaimError } = await withTimeout(
      supabaseAdmin
        .from("claims")
        .select("*")
        .eq("id", claim_id)
        .eq("user_id", user_id)
        .maybeSingle(),
      10000,
      "Mark claim submitted latest claim lookup"
    );

    if (latestClaimError) {
      throw latestClaimError;
    }

    return res.json({
      success: true,
      blocked: submissionResult.blocked === true,
      message:
        submissionResult.message ||
        "Delai has started the claim submission process.",
      claim: submissionResult.claim || latestClaim || claim,
      submission: submissionResult.submission || submissionResult,
      automation_job: submissionResult.next_job || null,
    });
  } catch (error) {
    console.error("Mark claim submitted error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to submit claim automatically",
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

    try {
      await queueAutomationJob({
        userId: user_id,
        claimId: claim_id,
        jobType: "claim_check_outcome",
      });
    } catch (automationError) {
      console.error(
        "Reference saved, but automation job could not be queued:",
        automationError
      );
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

    let automationJob = null;

    try {
      automationJob = await queueAutomationJob({
        userId: user_id,
        claimId: claim_id,
        jobType: "claim_check_outcome",
        force: true,
      });
    } catch (automationError) {
      console.error(
        "Operator response saved, but automation job could not be queued:",
        automationError
      );

      automationJob = {
        skipped: true,
        reason: "automation_queue_failed",
        error: automationError.message,
      };
    }

    res.json({
      success: true,
      message: "Operator response saved.",
      claim: updatedClaim,
      automation_job: automationJob,
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

    if (outcome === "paid") {
      try {
        await queueAutomationJob({
          userId: user_id,
          claimId: claim_id,
          jobType: "claim_check_payment",
        });
      } catch (automationError) {
        console.error(
          "Outcome updated, but payment automation could not be queued:",
          automationError
        );
      }
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

    const result = await processClaimCheckOutcomeJob({
      user_id,
      claim_id,
      job_type: "claim_check_outcome",
    });

    return res.json(result);
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
      const result = await processClaimCheckOutcomeJob({
        user_id: claim.user_id,
        claim_id: claim.id,
        job_type: "claim_check_outcome",
      });

      if (result.updated) {
        updatedCount += 1;
      }

      if (result.notification?.skipped === false) {
        notificationCount += 1;
      }

      results.push({
        claim_id: claim.id,
        user_id: claim.user_id,
        previous_outcome: claim.outcome,
        detected_outcome: result.outcome,
        updated: Boolean(result.updated),
        notification_created: result.notification?.skipped === false,
        result,
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

async function processAutomationJobsHandler(req, res) {
  try {
    const cronSecret = req.headers["x-cron-secret"];

    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized automation request",
      });
    }

    const limit = req.body?.limit || req.query?.limit || 20;

    const result = await processAutomationJobs({
      limit,
    });

    return res.json(result);
  } catch (error) {
    console.error("Process automation jobs error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to process automation jobs",
      details: error.message,
    });
  }
}

app.post("/process-automation-jobs", processAutomationJobsHandler);
app.get("/process-automation-jobs", processAutomationJobsHandler);

app.post("/update-claim-payment", async (req, res) => {
  try {
    const {
      user_id,
      claim_id,
      compensation_amount,
      fee_percentage = 10,
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
    let feeJob = null;

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
        )} has been recorded. Delai's success fee is £${payment.delaiFeeAmount.toFixed(
          2
        )}, and you keep £${payment.userPayoutAmount.toFixed(2)}.`,
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

    if (payment_status === "fee_due") {
      try {
        feeJob = await queueAutomationJob({
          userId: user_id,
          claimId: claim_id,
          jobType: "claim_collect_fee",
        });
      } catch (automationError) {
        console.error(
          "Payment recorded, but fee collection job could not be queued:",
          automationError
        );

        feeJob = {
          skipped: true,
          reason: "automation_queue_failed",
          error: automationError.message,
        };
      }
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
      automation_job: feeJob,
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