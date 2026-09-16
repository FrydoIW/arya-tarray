"use client";

import { useLayoutEffect, useRef, type ChangeEvent, type InputHTMLAttributes } from "react";
import { formatMoneyInput, parseMoneyInput } from "@/lib/format";

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "inputMode"> & {
  value: string;
  onValueChange: (value: string) => void;
};

function caretPosition(display: string, digitIndex: number) {
  if (digitIndex <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < display.length; index += 1) {
    if (/\d/.test(display[index])) {
      seen += 1;
      if (seen >= digitIndex) return index + 1;
    }
  }
  return display.length;
}

export function MoneyInput({ value, onValueChange, ...props }: MoneyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretDigits = useRef<number | null>(null);
  const display = formatMoneyInput(value);

  useLayoutEffect(() => {
    if (caretDigits.current === null) return;
    const input = inputRef.current;
    const position = caretPosition(display, caretDigits.current);
    caretDigits.current = null;
    input?.setSelectionRange(position, position);
  }, [display]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const caret = input.selectionStart ?? input.value.length;
    caretDigits.current = input.value.slice(0, caret).replace(/\D/g, "").length;
    onValueChange(parseMoneyInput(input.value));
  }

  return <input {...props} ref={inputRef} type="text" inputMode="decimal" value={display} onChange={handleChange} />;
}
