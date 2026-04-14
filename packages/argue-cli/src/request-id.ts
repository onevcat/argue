import { randomBytes } from "node:crypto";

export const REQUEST_ID_PATTERN = /^argue_\d+(?:_[a-f0-9]+)?$/;

export function newRequestId(): string {
  return `argue_${Date.now()}_${randomBytes(3).toString("hex")}`;
}
