import { ArrowRight, CheckCircle2, Clock3, Search, UploadCloud } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/statement-upload.module.css";

const steps = [
  {
    number: "1",
    title: "Upload Statement",
    description: "Upload bank statement files.",
    icon: <UploadCloud size={18} />,
    tone: styles.blue
  },
  {
    number: "2",
    title: "Draft Review",
    description: "Review and classify draft transactions.",
    icon: <Search size={18} />,
    tone: styles.blue,
    active: true
  },
  {
    number: "3",
    title: "Pending Approval",
    description: "Submit resolved drafts for approver review.",
    icon: <Clock3 size={18} />,
    tone: styles.gold
  },
  {
    number: "4",
    title: "Complete",
    description: "Approved statement is finalized.",
    icon: <CheckCircle2 size={18} />,
    tone: styles.green
  }
];

export function StatementUploadFlow() {
  return (
    <Card className={styles.flowCard}>
      <div className={styles.flowHeader}>
        <div className={styles.flowHeaderIcon}><UploadCloud size={17} /></div>
        <div>
          <h2>How statement upload works</h2>
          <p>Upload statements, review draft transactions, and submit only when every required classification is resolved.</p>
        </div>
      </div>

      <div className={styles.flowSteps}>
        {steps.map((step, index) => (
          <div className={styles.flowFragment} key={step.title}>
            <div className={`${styles.flowStep} ${step.active ? styles.activeStep : ""}`}>
              <span className={styles.stepNumber}>{step.number}</span>
              <span className={`${styles.flowIcon} ${step.tone}`}>{step.icon}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
            </div>
            {index < steps.length - 1 ? <ArrowRight className={styles.flowArrow} size={18} /> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
