"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { cx } from "./classNames";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      invalid = false,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => (
    <input
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={cx("field", invalid && "field-error", className)}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export interface TextFieldProps extends InputProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
  labelClassName?: string;
  hintClassName?: string;
  errorClassName?: string;
}

const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      id,
      label,
      hint,
      error,
      invalid,
      containerClassName,
      labelClassName,
      hintClassName,
      errorClassName,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [ariaDescribedBy, hintId, errorId]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={cx("min-w-0", containerClassName)}>
        {label ? (
          <label htmlFor={inputId} className={cx("label", labelClassName)}>
            {label}
          </label>
        ) : null}
        <Input
          ref={ref}
          id={inputId}
          invalid={invalid || Boolean(error)}
          aria-describedby={describedBy || undefined}
          {...props}
        />
        {hint ? (
          <p id={hintId} className={cx("field-hint", hintClassName)}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p
            id={errorId}
            role="alert"
            className={cx("field-error-text", errorClassName)}
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);

TextField.displayName = "TextField";

export default TextField;
