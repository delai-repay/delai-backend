import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getEncryptionKey() {
  const configuredKey = cleanText(process.env.PAYMENT_DATA_ENCRYPTION_KEY);

  if (!configuredKey) {
    throw new Error(
      "PAYMENT_DATA_ENCRYPTION_KEY is required for payment-profile encryption."
    );
  }

  const key = /^[a-f0-9]{64}$/i.test(configuredKey)
    ? Buffer.from(configuredKey, "hex")
    : Buffer.from(configuredKey, "base64");

  if (key.length !== 32) {
    throw new Error(
      "PAYMENT_DATA_ENCRYPTION_KEY must decode to exactly 32 bytes."
    );
  }

  return key;
}

function encryptPaymentValue(value) {
  const plaintext = cleanText(value);

  if (!plaintext) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptPaymentValue(value) {
  const encryptedValue = cleanText(value);

  if (!encryptedValue) return null;

  const [version, ivValue, authTagValue, ciphertextValue, ...extra] =
    encryptedValue.split(".");

  if (
    version !== ENCRYPTION_VERSION ||
    !ivValue ||
    !authTagValue ||
    !ciphertextValue ||
    extra.length > 0
  ) {
    throw new Error("Unsupported or malformed encrypted payment value.");
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function normaliseSortCode(value) {
  return cleanText(value).replace(/\D/g, "");
}

function normaliseAccountNumber(value) {
  return cleanText(value).replace(/\D/g, "");
}

function maskSortCodeLast2(last2) {
  const digits = cleanText(last2).replace(/\D/g, "").slice(-2);
  return digits ? `••-••-${digits}` : null;
}

function maskAccountNumberLast4(last4) {
  const digits = cleanText(last4).replace(/\D/g, "").slice(-4);
  return digits ? `••••${digits}` : null;
}

function verifySignedWebhook({ rawBody, suppliedSignature, secret }) {
  const bodyBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody || "", "utf8");
  const signature = cleanText(suppliedSignature).toLowerCase();
  const webhookSecret = cleanText(secret);

  if (!bodyBuffer.length || !signature || !webhookSecret) return false;

  const expected = createHmac("sha256", webhookSecret)
    .update(bodyBuffer)
    .digest("hex");

  if (signature.length !== expected.length) return false;

  return timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(expected, "utf8")
  );
}

export {
  decryptPaymentValue,
  encryptPaymentValue,
  maskAccountNumberLast4,
  maskSortCodeLast2,
  normaliseAccountNumber,
  normaliseSortCode,
  verifySignedWebhook,
};
