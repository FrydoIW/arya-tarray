import { ArrowRight, CircleDollarSign, Tags } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EventCodeBadge } from "@/components/domain/EventCodeBadge";
import styles from "../styles/event-code.module.css";

export function EventCodeMatchingRule() {
  return (
    <Card className={styles.exampleCard}>
      <div className={styles.exampleHead}>
        <span className={styles.exampleIcon}><Tags size={19} /></span>
        <div>
          <h2>How the 3-digit rule is read</h2>
          <p>Event Code is matched from the final three digits of an incoming credit amount.</p>
        </div>
      </div>

      <div className={styles.flow}>
        <div>
          <small>Incoming amount</small>
          <strong>Rp 1,250,045</strong>
        </div>
        <ArrowRight size={18} />
        <div>
          <small>Suffix (last 3 digits)</small>
          <EventCodeBadge code="045" />
        </div>
        <ArrowRight size={18} />
        <div>
          <small>Suggested event</small>
          <strong>Waisak</strong>
        </div>
        <ArrowRight size={18} />
        <div>
          <small>Base amount</small>
          <strong className={styles.baseAmount}><CircleDollarSign size={16} /> Rp 1,250,000</strong>
        </div>
      </div>
    </Card>
  );
}
