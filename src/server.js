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

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  })
);

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