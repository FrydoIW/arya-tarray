"use client";

import { currentBusinessDayValue } from "@/lib/business-time";

export type MemberProfileFormValues = {
  memberName: string;
  initialName: string;
  birthDate: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  remark: string;
};

type FieldKey = keyof MemberProfileFormValues;
type MemberProfileInitialValues = { [Key in FieldKey]?: string | null };
const fields = [
  { key: "memberName", registrationLabel: "Member Name *", profileLabel: "Nama Donatur *", max: 150, type: "text" },
  { key: "initialName", registrationLabel: "Initial Name", profileLabel: "Initial", max: 100, type: "text" },
  { key: "birthDate", registrationLabel: "Birth Date", profileLabel: "Tanggal Lahir", max: 10, type: "date" },
  { key: "phone", registrationLabel: "Phone", profileLabel: "Telepon", max: 50, type: "tel" },
  { key: "email", registrationLabel: "Email", profileLabel: "Email", max: 150, type: "email" },
  { key: "city", registrationLabel: "City", profileLabel: "Kota", max: 100, type: "text" },
  { key: "address", registrationLabel: "Address", profileLabel: "Alamat", max: 500, type: "text", long: true },
  { key: "remark", registrationLabel: "Remark", profileLabel: "Catatan", max: 500, type: "text", long: true }
] as const satisfies ReadonlyArray<{
  key: FieldKey;
  registrationLabel: string;
  profileLabel: string;
  max: number;
  type: string;
  long?: boolean;
}>;

export function createMemberProfileFormValues(initial: MemberProfileInitialValues = {}): MemberProfileFormValues {
  return {
    memberName: initial.memberName ?? "",
    initialName: initial.initialName ?? "",
    birthDate: initial.birthDate ?? "",
    phone: initial.phone ?? "",
    email: initial.email ?? "",
    city: initial.city ?? "",
    address: initial.address ?? "",
    remark: initial.remark ?? ""
  };
}

export function normalizeMemberProfileForm(values: MemberProfileFormValues) {
  return {
    memberName: values.memberName.trim(),
    initialName: values.initialName.trim() || null,
    birthDate: values.birthDate || null,
    phone: values.phone.trim() || null,
    email: values.email.trim() || null,
    city: values.city.trim() || null,
    address: values.address.trim() || null,
    remark: values.remark.trim() || null
  };
}

export function MemberProfileFields({
  values,
  disabled,
  context,
  fieldClassName,
  wideClassName = "",
  onChange
}: {
  values: MemberProfileFormValues;
  disabled: boolean;
  context: "registration" | "profile";
  fieldClassName: string;
  wideClassName?: string;
  onChange: (key: FieldKey, value: string) => void;
}) {
  return fields.map(field => {
    const isLong = "long" in field && field.long;
    const className = `${fieldClassName} ${isLong && context === "profile" ? wideClassName : ""}`.trim();
    const label = context === "registration" ? field.registrationLabel : field.profileLabel;
    const common = {
      name: field.key,
      value: values[field.key],
      maxLength: field.max,
      disabled,
      required: field.key === "memberName",
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(field.key, event.target.value)
    };
    return (
      <label className={className} key={field.key}>
        <span>{label}</span>
        {isLong && context === "profile"
          ? <textarea {...common} rows={3} />
          : <input {...common} type={field.type} max={field.key === "birthDate" ? currentBusinessDayValue() : undefined} />}
      </label>
    );
  });
}
