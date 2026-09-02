"use client";

import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { currentBusinessMonthValue } from "@/lib/business-time";
import { useEffect, useId, useMemo, useRef, useState } from "react";

type MonthPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  minMonth?: string;
  maxMonth?: string;
  monthsBack?: number;
  ariaLabel?: string;
  className?: string;
};

type ParsedMonth = {
  year: number;
  month: number;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

function parseMonth(value: string): ParsedMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;

  return { year, month };
}

function monthValue(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(value: string, offset: number) {
  const parsed = parseMonth(value);
  if (!parsed) return value;

  const date = new Date(Date.UTC(parsed.year, parsed.month - 1 + offset, 1));
  return monthValue(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function formatMonth(value: string) {
  const parsed = parseMonth(value);
  if (!parsed) return value;
  return `${MONTHS[parsed.month - 1]} ${parsed.year}`;
}

export function MonthPicker({
  value,
  onChange,
  disabled = false,
  minMonth,
  maxMonth = currentBusinessMonthValue(),
  monthsBack = 120,
  ariaLabel = "Month",
  className = ""
}: MonthPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"year" | "month">("year");
  const [horizontalPlacement, setHorizontalPlacement] = useState<"left" | "right">("left");
  const [verticalPlacement, setVerticalPlacement] = useState<"bottom" | "top">("bottom");

  const effectiveMax = parseMonth(maxMonth) ? maxMonth : currentBusinessMonthValue();
  const effectiveValue = parseMonth(value) ? value : effectiveMax;
  const fallbackMin = shiftMonth(effectiveMax, -(Math.max(1, monthsBack) - 1));
  const effectiveMin = parseMonth(minMonth ?? "") ? minMonth! : fallbackMin;

  const selected = parseMonth(effectiveValue)!;
  const min = parseMonth(effectiveMin)!;
  const max = parseMonth(effectiveMax)!;
  const [draftYear, setDraftYear] = useState(selected.year);

  useEffect(() => {
    if (!open) {
      setDraftYear(selected.year);
      setStep("year");
    }
  }, [open, selected.year]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const years = useMemo(() => {
    const result: number[] = [];
    for (let year = max.year; year >= min.year; year -= 1) {
      result.push(year);
    }
    return result;
  }, [max.year, min.year]);

  function openPicker() {
    if (disabled) return;
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      setHorizontalPlacement(bounds.left + 286 > window.innerWidth - 12 ? "right" : "left");
      setVerticalPlacement(bounds.bottom + 300 > window.innerHeight - 12 && bounds.top > 300 ? "top" : "bottom");
    }
    setDraftYear(selected.year);
    setStep("year");
    setOpen((current) => !current);
  }

  function chooseYear(year: number) {
    setDraftYear(year);
    setStep("month");
  }

  function isMonthDisabled(month: number) {
    const candidate = monthValue(draftYear, month);
    return candidate < effectiveMin || candidate > effectiveMax;
  }

  function chooseMonth(month: number) {
    if (isMonthDisabled(month)) return;
    onChange(monthValue(draftYear, month));
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={`ui-month-picker ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-month-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        disabled={disabled}
        onClick={openPicker}
      >
        <CalendarDays size={15} aria-hidden="true" />
        <span>{formatMonth(effectiveValue)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={popoverId}
          className={`ui-month-picker-popover align-${horizontalPlacement} open-${verticalPlacement}`}
          role="dialog"
          aria-label={`${ariaLabel} picker`}
        >
          <div className="ui-month-picker-popover-head">
            <div>
              <strong>{step === "year" ? "Select year" : "Select month"}</strong>
              <small>{step === "year" ? "Choose a year first" : String(draftYear)}</small>
            </div>
            {step === "month" ? (
              <button type="button" className="ui-month-picker-year-back" onClick={() => setStep("year")}>Change year</button>
            ) : null}
          </div>

          {step === "year" ? (
            <div className="ui-month-picker-year-grid">
              {years.map((year) => (
                <button
                  type="button"
                  key={year}
                  className={`ui-month-picker-year ${year === draftYear ? "is-selected" : ""}`.trim()}
                  onClick={() => chooseYear(year)}
                >
                  <span>{year}</span>
                  {year === selected.year ? <Check size={13} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="ui-month-picker-month-grid">
              {MONTHS.map((label, index) => {
                const month = index + 1;
                const candidate = monthValue(draftYear, month);
                const isSelected = candidate === effectiveValue;
                const monthDisabled = isMonthDisabled(month);

                return (
                  <button
                    type="button"
                    key={label}
                    className={`ui-month-picker-month ${isSelected ? "is-selected" : ""}`.trim()}
                    disabled={monthDisabled}
                    onClick={() => chooseMonth(month)}
                  >
                    {label.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
