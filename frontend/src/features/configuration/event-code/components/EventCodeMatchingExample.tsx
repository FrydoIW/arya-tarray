import { ArrowRight, CircleDollarSign, Tags } from "lucide-react";
import { EventCodeBadge } from "@/components/domain/EventCodeBadge";

export function EventCodeMatchingExample() {
  return (
    <article className="event-code-example-card">
      <div className="event-code-example-head">
        <span className="event-code-example-icon"><Tags size={19} /></span>
        <div>
          <span className="eyebrow">MATCHING PREVIEW</span>
          <h2>How the 3-digit rule is read</h2>
          <p>Event Code is matched from the final three digits of an incoming credit amount.</p>
        </div>
      </div>

      <div className="event-code-flow">
        <div>
          <small>Incoming amount</small>
          <strong>Rp 1,250,045</strong>
        </div>
        <ArrowRight size={17} />
        <div>
          <small>Suffix</small>
          <EventCodeBadge code="045" />
        </div>
        <ArrowRight size={17} />
        <div>
          <small>Suggested event</small>
          <strong>Waisak</strong>
        </div>
        <ArrowRight size={17} />
        <div>
          <small>Base amount</small>
          <strong className="event-code-base-amount"><CircleDollarSign size={15} /> Rp 1,250,000</strong>
        </div>
      </div>
    </article>
  );
}
