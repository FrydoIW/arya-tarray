"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./CollapsibleSection.module.css";

type CollapsibleSectionProps = {
  title: string;
  description?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  description,
  summary,
  actions,
  defaultExpanded = true,
  className = "",
  children
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  const titleId = useId();

  return (
    <section className={`${styles.section} ${className}`.trim()} aria-labelledby={titleId}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={styles.copy}>
          <span id={titleId} className={styles.title} role="heading" aria-level={2}>{title}</span>
          {description ? <span className={styles.description}>{description}</span> : null}
        </span>
        <span className={styles.meta}>
          {summary ? <span>{summary}</span> : null}
          <ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
        </span>
      </button>
      <div id={contentId} className={styles.content} hidden={!expanded}>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
        {children}
      </div>
    </section>
  );
}
