"use client";

// ============================================
// Flash AI — Multi-Step Wizard Card
// ============================================
// Galileo-style conversational wizard rendered as a single card.
// Shows one step at a time with pill-style option buttons,
// optional custom input, and smooth step transitions.

import { memo, useState, useCallback, useRef, useEffect } from "react";

// ---- Types ----

interface WizardStep {
  question: string;
  options: string[];
  allowCustom?: boolean;
  customPlaceholder?: string;
}

interface WizardCardProps {
  intro: string;
  steps: WizardStep[];
  onComplete: (answers: string[]) => void;
}

// ---- Component ----

const WizardCard = memo(function WizardCard({ intro, steps, onComplete }: WizardCardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<(string | null)[]>(() => Array(steps.length).fill(null));
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [animating, setAnimating] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);
  const answeredCount = answers.filter((a) => a !== null).length;
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  // Focus custom input when revealed
  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [showCustomInput]);

  const animateTransition = useCallback((dir: "forward" | "back", cb: () => void) => {
    setDirection(dir);
    setAnimating(true);
    // Wait for exit animation, then swap content, then enter
    const timeout = setTimeout(() => {
      cb();
      setAnimating(false);
    }, 160);
    return () => clearTimeout(timeout);
  }, []);

  const selectOption = useCallback(
    (value: string) => {
      const next = [...answers];
      next[currentStep] = value;
      setAnswers(next);
      setShowCustomInput(false);
      setCustomValue("");

      if (isLastStep) {
        // All done — call onComplete with finalized answers
        onComplete(next.filter((a): a is string => a !== null));
        return;
      }

      animateTransition("forward", () => {
        setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
      });
    },
    [answers, currentStep, isLastStep, onComplete, steps.length, animateTransition],
  );

  const goBack = useCallback(() => {
    if (currentStep === 0) return;
    setShowCustomInput(false);
    setCustomValue("");
    animateTransition("back", () => {
      setCurrentStep((s) => s - 1);
    });
  }, [currentStep, animateTransition]);

  const handleCustomSubmit = useCallback(() => {
    const trimmed = customValue.trim();
    if (!trimmed) return;
    selectOption(trimmed);
  }, [customValue, selectOption]);

  const handleCustomKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCustomSubmit();
      }
      if (e.key === "Escape") {
        setShowCustomInput(false);
        setCustomValue("");
      }
    },
    [handleCustomSubmit],
  );

  // Animation style for step content
  const contentStyle: React.CSSProperties = animating
    ? {
        opacity: 0,
        transform: direction === "forward" ? "translateX(12px)" : "translateX(-12px)",
        transition: "opacity 140ms ease-out, transform 140ms ease-out",
      }
    : {
        opacity: 1,
        transform: "translateX(0)",
        transition: "opacity 180ms ease-out, transform 180ms ease-out",
      };

  return (
    <div
      className="glass-card-solid"
      style={{
        maxWidth: 480,
        padding: "20px 22px 18px",
        animation: "slideUp 200ms ease-out",
      }}
    >
      {/* Intro message */}
      <p
        className="text-text-secondary"
        style={{ fontSize: 13, lineHeight: 1.55, margin: "0 0 16px" }}
      >
        {intro}
      </p>

      {/* Step indicator bar */}
      <div
        className="flex items-center justify-between"
        style={{
          marginBottom: 14,
          paddingBottom: 12,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <span className="text-text-tertiary" style={{ fontSize: 11, fontWeight: 500 }}>
          Question {currentStep + 1} of {steps.length}
        </span>
        <span className="text-text-tertiary" style={{ fontSize: 11, fontWeight: 500 }}>
          {answeredCount}/{steps.length} answered
        </span>
      </div>

      {/* Step content — animated */}
      <div style={contentStyle}>
        {/* Question */}
        <p
          className="text-text-primary"
          style={{ fontSize: 14, fontWeight: 500, margin: "0 0 14px", lineHeight: 1.45 }}
        >
          {step?.question}
        </p>

        {/* Option pills */}
        <div className="flex flex-col" style={{ gap: 8 }}>
          {step?.options.map((option) => {
            const isSelected = answers[currentStep] === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => selectOption(option)}
                className="group text-left cursor-pointer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 450,
                  border: isSelected
                    ? "1px solid rgba(51,201,161,0.3)"
                    : "1px solid rgba(255,255,255,0.06)",
                  background: isSelected
                    ? "rgba(51,201,161,0.06)"
                    : "transparent",
                  color: isSelected
                    ? "var(--color-brand-cyan)"
                    : "var(--color-text-primary)",
                  transition: "all 140ms ease-out",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <span>{option}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  style={{ opacity: isSelected ? 1 : 0, transition: "opacity 120ms" }}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            );
          })}

          {/* Other... custom input toggle */}
          {step?.allowCustom && !showCustomInput && (
            <button
              type="button"
              onClick={() => setShowCustomInput(true)}
              className="text-left cursor-pointer"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 450,
                border: "1px dashed rgba(255,255,255,0.08)",
                background: "transparent",
                color: "var(--color-text-tertiary)",
                transition: "all 140ms ease-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
                e.currentTarget.style.color = "var(--color-text-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                e.currentTarget.style.color = "var(--color-text-tertiary)";
              }}
            >
              Other...
            </button>
          )}

          {/* Custom input field */}
          {step?.allowCustom && showCustomInput && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                ref={customInputRef}
                type="text"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={handleCustomKeyDown}
                placeholder={step.customPlaceholder ?? "Enter custom value..."}
                className="text-text-primary"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "var(--color-bg-input)",
                  outline: "none",
                  transition: "border-color 120ms",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-accent-lime)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                }}
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={!customValue.trim()}
                className="cursor-pointer"
                style={{
                  padding: "9px 14px",
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  background: customValue.trim()
                    ? "var(--color-accent-lime)"
                    : "rgba(255,255,255,0.06)",
                  color: customValue.trim() ? "#0A0E13" : "var(--color-text-tertiary)",
                  transition: "all 140ms ease-out",
                  whiteSpace: "nowrap",
                }}
              >
                OK
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation footer */}
      <div
        className="flex items-center justify-between"
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {/* Back button */}
        <button
          type="button"
          onClick={goBack}
          disabled={currentStep === 0}
          className="cursor-pointer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "7px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            border: "none",
            background: "transparent",
            color:
              currentStep === 0
                ? "var(--color-text-tertiary)"
                : "var(--color-text-secondary)",
            opacity: currentStep === 0 ? 0.4 : 1,
            transition: "all 120ms",
          }}
          onMouseEnter={(e) => {
            if (currentStep > 0) e.currentTarget.style.color = "var(--color-text-primary)";
          }}
          onMouseLeave={(e) => {
            if (currentStep > 0) e.currentTarget.style.color = "var(--color-text-secondary)";
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* Progress dots */}
        <div className="flex items-center" style={{ gap: 4 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === currentStep ? 16 : 5,
                height: 5,
                borderRadius: 3,
                background:
                  answers[i] !== null
                    ? "var(--color-accent-lime)"
                    : i === currentStep
                      ? "var(--color-text-secondary)"
                      : "rgba(255,255,255,0.08)",
                transition: "all 200ms ease-out",
              }}
            />
          ))}
        </div>

        {/* Next / Review button */}
        <button
          type="button"
          onClick={() => {
            // If current step has an answer, advance or complete
            const currentAnswer = answers[currentStep];
            if (currentAnswer === null) return;
            if (isLastStep) {
              onComplete(answers.filter((a): a is string => a !== null));
            } else {
              animateTransition("forward", () => {
                setCurrentStep((s) => s + 1);
              });
            }
          }}
          disabled={answers[currentStep] === null}
          className="cursor-pointer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "7px 14px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            border: "none",
            background:
              answers[currentStep] !== null
                ? "var(--color-accent-lime)"
                : "rgba(255,255,255,0.06)",
            color:
              answers[currentStep] !== null
                ? "#0A0E13"
                : "var(--color-text-tertiary)",
            transition: "all 140ms ease-out",
          }}
        >
          {isLastStep ? "Review Answers" : "Next Question"}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
});

export default WizardCard;
export type { WizardStep, WizardCardProps };
