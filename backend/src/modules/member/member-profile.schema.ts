import { z } from "zod";
import { currentBusinessDayValue } from "../../lib/business-time.js";
import { isValidPeriodDate } from "../../lib/period.js";

export const optionalMemberText = (max: number) =>
  z.string().trim().max(max).nullish().transform(value => value || null);

export const memberNameSchema = z.string().trim().min(1).max(150);

export const memberBirthDateSchema = optionalMemberText(10).refine(
  value => !value || (isValidPeriodDate(value) && value <= currentBusinessDayValue()),
  "Birth date must be a valid non-future YYYY-MM-DD date"
);

export const memberEmailSchema = optionalMemberText(150).refine(
  value => !value || z.string().email().safeParse(value).success,
  "Email is invalid"
);

export const memberProfileFieldSchemas = {
  memberName: memberNameSchema,
  initialName: optionalMemberText(100),
  birthDate: memberBirthDateSchema,
  phone: optionalMemberText(50),
  email: memberEmailSchema,
  city: optionalMemberText(100),
  address: optionalMemberText(500),
  remark: optionalMemberText(500)
} as const;
