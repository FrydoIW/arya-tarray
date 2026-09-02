import { ArrowRight, BadgeCheck, CloudUpload, GitBranch, Landmark, Settings2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import styles from "../styles/bank-account.module.css";

const steps = [
  { title: "Configure Account", detail: "Add and maintain bank account information.", icon: <Settings2 size={19} />, tone: "blue" },
  { title: "Active Account", detail: "Account is enabled for operational use.", icon: <BadgeCheck size={19} />, tone: "green" },
  { title: "Statement Upload", detail: "Active account becomes available for upload.", icon: <CloudUpload size={19} />, tone: "violet" },
  { title: "Reconciliation", detail: "Uploaded statements are validated and reconciled.", icon: <GitBranch size={19} />, tone: "gold" }
] as const;

export function BankAccountFlow() {
  return (
    <Card className={styles.flowCard}>
      <div className={styles.flowIntro}>
        <span className={styles.infoIcon}><Landmark size={18} /></span>
        <div>
          <h2>How bank account works</h2>
          <p>Registered active bank accounts are available for statement upload and account validation.</p>
        </div>
      </div>

      <div className={styles.flowSteps}>
        {steps.map((step, index) => (
          <div className={styles.flowFragment} key={step.title}>
            <article className={styles.flowStep}>
              <span className={styles.stepNumber}>{index + 1}</span>
              <span className={`${styles.flowIcon} ${styles[step.tone]}`}>{step.icon}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </div>
            </article>
            {index < steps.length - 1 ? <ArrowRight className={styles.flowArrow} size={18} /> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
