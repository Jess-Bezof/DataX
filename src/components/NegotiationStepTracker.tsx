"use client";

import type { DealStatus } from "@/types/datax";

const STEPS = [
  { key: "CONNECTED",    label: "Connected"    },
  { key: "OFFER_MADE",   label: "Offer Made"   },
  { key: "COUNTERED",    label: "Countered"    },
  { key: "ACCEPTED",     label: "Accepted"     },
  { key: "PAYMENT_SENT", label: "Payment Sent" },
  { key: "RELEASED",     label: "Released"     },
];

function getReachedStepIndex(status: DealStatus): number {
  switch (status) {
    case "offer_pending":          return 1;
    case "seller_counter_pending": return 2;
    case "awaiting_payment":       return 3;
    case "buyer_marked_sent":      return 4;
    case "released":               return 5;
    case "offer_rejected":         return 1;
    default:                       return 0;
  }
}

export function NegotiationStepTracker({ status }: { status: DealStatus }) {
  const reached = getReachedStepIndex(status);
  const isRejected = status === "offer_rejected";

  return (
    <div className="flex w-full items-start py-2">
      {STEPS.map((step, i) => {
        const isCompleted = i < reached;
        const isActive = i === reached;
        const isPending = i > reached;

        let circleClass = "w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold shrink-0 ";
        if (isCompleted) {
          circleClass += "bg-[var(--accent)] border-[var(--accent)] text-black";
        } else if (isActive && isRejected) {
          circleClass += "border-red-400 text-red-400";
        } else if (isActive) {
          circleClass += "border-[var(--accent)] text-[var(--accent)]";
        } else {
          circleClass += "border-[var(--border)] text-[var(--muted)]";
        }

        let labelClass = "text-[10px] text-center mt-1 w-14 leading-tight ";
        if (isCompleted) {
          labelClass += "text-[var(--accent)]";
        } else if (isActive && isRejected) {
          labelClass += "text-red-400";
        } else if (isActive) {
          labelClass += "text-[var(--foreground)]";
        } else {
          labelClass += "text-[var(--muted)]";
        }

        const connectorClass =
          "flex-1 h-px mt-[10px] mx-1 " +
          (isCompleted ? "bg-[var(--accent)]" : "bg-[var(--border)]");

        return (
          <div key={step.key} className="flex items-start flex-1 min-w-0">
            <div className="flex flex-col items-center">
              <div className={circleClass}>
                {isCompleted ? "✓" : isActive ? "●" : ""}
              </div>
              <span className={labelClass}>
                {step.label}
                {isActive && isRejected && (
                  <span className="block text-[9px] text-red-400 mt-0.5">REJECTED</span>
                )}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={connectorClass} />
            )}
          </div>
        );
      })}
    </div>
  );
}
