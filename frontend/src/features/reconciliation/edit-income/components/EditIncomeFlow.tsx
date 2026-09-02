import { ArrowRight, CheckCircle2, Clock3, Info, PencilLine } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/edit-income.module.css";

const steps = [
  { title: "Complete", detail: "Income has been approved and finalized.", icon: CheckCircle2, tone: "green" },
  { title: "Edit Income", detail: "Correct Final Event and/or Remark.", icon: PencilLine, tone: "blue" },
  { title: "Pending Approval", detail: "Submit changes for re-approval.", icon: Clock3, tone: "gold" },
  { title: "Complete", detail: "Changes approved and finalized.", icon: CheckCircle2, tone: "green" }
] as const;

export function EditIncomeFlow() {
  return (
    <Card className={styles.flowCard}>
      <div className={styles.flowHeader}>
        <span className={styles.flowHeaderIcon}><Info size={17} /></span>
        <div>
          <h2>How edit income works</h2>
          <p>Changes to completed transactions require approval again.</p>
        </div>
      </div>
      <div className={styles.flowSteps}>
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div className={styles.flowFragment} key={`${step.title}-${index}`}>
              <div className={`${styles.flowStep} ${index === 1 ? styles.activeStep : ""}`}>
                <span className={styles.stepNumber}>{index + 1}</span>
                <span className={`${styles.flowIcon} ${styles[step.tone]}`}><Icon size={19} /></span>
                <div><strong>{step.title}</strong><p>{step.detail}</p></div>
              </div>
              {index < steps.length - 1 ? <ArrowRight size={18} className={styles.flowArrow} /> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
