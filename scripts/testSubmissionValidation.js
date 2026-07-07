import { validateSubmissionContext } from "../src/operators/submissionValidation.js";

const validContext = {
  contextVersion: "1.0",

  claim: {
    id: "test-claim-1",
    userId: "test-user-1",
  },

  operator: {
    key: "greater_anglia",
    displayName: "Greater Anglia",
    suppliedName: "Greater Anglia",
    knownOperator: true,
  },

  passenger: {
    fullName: "Test Passenger",
    email: "test@example.com",
    mobile: "07123456789",
  },

  journey: {
    date: "2026-07-06",
    originStation: "Hatfield Peverel",
    destinationStation: "London Liverpool Street",
    scheduledTime: "07:15",
    delayMinutes: 18,
  },

  ticket: {
    type: "Weekly",
    cost: 120,
    smartcardProvider: "Greater Anglia Smartcard",
    smartcardNumber: "TEST123456",
    startDate: "2026-07-01",
    endDate: "2026-07-07",
    originStation: "Hatfield Peverel",
    destinationStation: "London Liverpool Street",
  },
};

const invalidContext = {
  ...validContext,

  passenger: {
    ...validContext.passenger,
    email: null,
  },

  ticket: {
    ...validContext.ticket,
    smartcardNumber: null,
  },
};

console.log("VALID CONTEXT RESULT");
console.dir(validateSubmissionContext(validContext), {
  depth: null,
});

console.log("\nINVALID CONTEXT RESULT");
console.dir(validateSubmissionContext(invalidContext), {
  depth: null,
});