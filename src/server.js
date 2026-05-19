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
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

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

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "delai-backend",
  });
});

app.get("/detect-delays-test", async (req, res) => {
  try {
    const { data: commutes, error: commuteError } = await supabaseAdmin
      .from("commutes")
      .select("*");

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
    const { data: commutes, error: commuteError } = await supabaseAdmin
      .from("commutes")
      .select("*");

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

      const { data: existingDelay, error: existingError } = await supabaseAdmin
        .from("detected_delays")
        .select("id")
        .eq("user_id", commute.user_id)
        .eq("commute_id", commute.id)
        .eq("delay_date", todayDate)
        .eq("direction", "outbound")
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existingDelay) {
        continue;
      }

      const { data: insertedDelay, error: insertError } = await supabaseAdmin
        .from("detected_delays")
        .insert(testDelay)
        .select("*")
        .single();

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

    const { data: claim, error: claimError } = await supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", claim_id)
      .eq("user_id", user_id)
      .single();

    if (claimError || !claim) {
      return res.status(404).json({
        success: false,
        error: "Claim not found",
      });
    }

    const { data: detectedDelay, error: delayError } = await supabaseAdmin
      .from("detected_delays")
      .select("*")
      .eq("id", claim.detected_delay_id)
      .eq("user_id", user_id)
      .single();

    if (delayError || !detectedDelay) {
      return res.status(404).json({
        success: false,
        error: "Linked detected delay not found",
      });
    }

    const { data: seasonTickets, error: ticketError } = await supabaseAdmin
      .from("season_tickets")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (ticketError) {
      throw ticketError;
    }

    const seasonTicket = seasonTickets?.[0] || null;

    const { data: commutes, error: commuteError } = await supabaseAdmin
      .from("commutes")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1);

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

    const { data: updatedClaim, error: updateError } = await supabaseAdmin
      .from("claims")
      .update({
        status: "prepared",
        prepared_summary: preparedSummary,
        prepared_at: new Date().toISOString(),
      })
      .eq("id", claim_id)
      .eq("user_id", user_id)
      .select("*")
      .single();

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