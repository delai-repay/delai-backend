import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { query } from "./db.js";

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