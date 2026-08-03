const REDACTED = "[redacted]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
]);

const SENSITIVE_FIELD_NAMES = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bridgetoken",
  "clientsecret",
  "cookie",
  "password",
  "postdata",
  "proxyauthorization",
  "refreshtoken",
  "requestpostdata",
  "responsebodybase64",
  "secret",
  "setcookie",
  "token",
]);

export function redactSensitiveData(value: unknown): unknown {
  return redactValue(value, "");
}

export function redactApprovalArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  return redactSensitiveData(args) as Record<string, unknown>;
}

export function redactHeaderCollection(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!isRecord(entry)) {
        return redactValue(entry, "headers");
      }
      const name = typeof entry.name === "string" ? entry.name : "";
      return {
        ...entry,
        ...(SENSITIVE_HEADER_NAMES.has(name.trim().toLowerCase())
          ? { value: REDACTED }
          : { value: redactValue(entry.value, name) }),
      };
    });
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, headerValue]) => [
        name,
        SENSITIVE_HEADER_NAMES.has(name.trim().toLowerCase())
          ? REDACTED
          : redactValue(headerValue, name),
      ]),
    );
  }
  return value;
}

function redactValue(value: unknown, parentKey: string): unknown {
  const normalizedParentKey = normalizeFieldName(parentKey);
  if (
    normalizedParentKey === "cookie" &&
    isValueOmittedCookieMetadata(value)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, key)]),
    );
  }
  if (SENSITIVE_FIELD_NAMES.has(normalizedParentKey)) {
    return REDACTED;
  }
  if (isHeaderField(parentKey)) {
    return redactHeaderCollection(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, parentKey));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, key)]),
    );
  }
  return value;
}

function isHeaderField(key: string): boolean {
  const normalized = normalizeFieldName(key);
  return normalized === "headers" || normalized.endsWith("headers");
}

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isValueOmittedCookieMetadata(
  value: unknown,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.valueIncluded === false &&
    !Object.prototype.hasOwnProperty.call(value, "value") &&
    typeof value.name === "string" &&
    typeof value.domain === "string" &&
    typeof value.path === "string" &&
    typeof value.secure === "boolean" &&
    typeof value.httpOnly === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
