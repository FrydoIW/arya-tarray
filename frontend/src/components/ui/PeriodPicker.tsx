"use client";

import { CalendarDays } from "lucide-react";
import { MonthPicker } from "./MonthPicker";
import { Select } from "./Select";

export type PeriodMode = "MONTH" | "DAY";

export type PeriodSelection = {
  mode: PeriodMode;
  month: string;
  date: string;
};

type PeriodPickerProps = {
  value: PeriodSelection;
  onChange: (value: PeriodSelection) => void;
  disabled?: boolean;
  maxMonth: string;
  maxDate: string;
  ariaLabel?: string;
  className?: string;
};

function dayForMonth(month: string, currentDate: string) {
  return currentDate.startsWith(`${month}-`) ? currentDate : `${month}-01`;
}

export function PeriodPicker({
  value,
  onChange,
  disabled = false,
  maxMonth,
  maxDate,
  ariaLabel = "Period",
  className = ""
}: PeriodPickerProps) {
  function changeMode(mode: PeriodMode) {
    if (mode === value.mode) return;
    if (mode === "DAY") {
      const date = dayForMonth(value.month, value.date);
      onChange({ mode, month: date.slice(0, 7), date: date > maxDate ? maxDate : date });
      return;
    }
    onChange({ mode, month: value.date.slice(0, 7), date: value.date });
  }

  return (
    <div className={`ui-period-picker ${className}`.trim()}>
      <Select
        className="ui-period-picker-mode"
        value={value.mode}
        disabled={disabled}
        aria-label={`${ariaLabel} mode`}
        onChange={(event) => changeMode(event.target.value as PeriodMode)}
      >
        <option value="MONTH">Month</option>
        <option value="DAY">Day</option>
      </Select>
      {value.mode === "MONTH" ? (
        <MonthPicker
          value={value.month}
          maxMonth={maxMonth}
          disabled={disabled}
          ariaLabel={`${ariaLabel} month`}
          onChange={(month) => onChange({ ...value, month, date: dayForMonth(month, value.date) })}
        />
      ) : (
        <label className="ui-period-picker-day">
          <CalendarDays size={15} aria-hidden="true" />
          <input
            type="date"
            value={value.date}
            max={maxDate}
            disabled={disabled}
            aria-label={`${ariaLabel} day`}
            onChange={(event) => {
              const date = event.target.value;
              if (date) onChange({ ...value, month: date.slice(0, 7), date });
            }}
          />
        </label>
      )}
    </div>
  );
}
