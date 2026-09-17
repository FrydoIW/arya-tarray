"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./CollapsibleSection.module.css";

type CollapsibleSectionProps = {
  title: string;
  description?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  headerActions?: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  description,
  summary,
  actions,
  headerActions,
  defaultExpanded = true,
  className = "",
  children
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  const titleId = useId();
  const toggle = () => setExpanded((current) => !current);

  return (
    <section className={`${styles.section} ${className}`.trim()} aria-labelledby={titleId}>
      <div className={`${styles.header} ${headerActions ? styles.headerWithActions : ""} ${expanded ? styles.headerExpanded : ""}`.trim()}>
        <button
          type="button"
          className={styles.headerToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggle}
        >
          <span className={styles.copy}>
            <span id={titleId} className={styles.title} role="heading" aria-level={2}>{title}</span>
            {description ? <span className={styles.description}>{description}</span> : null}
          </span>
          {summary ? <span className={styles.summary}>{summary}</span> : null}
        </button>
        {headerActions ? <div className={styles.headerActions}>{headerActions}</div> : null}
        <button
          type="button"
          className={styles.chevronButton}
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? "Collapse section" : "Expand section"}
          onClick={toggle}
        >
          <ChevronDown className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`.trim()} size={17} aria-hidden="true" />
        </button>
      </div>
      <div id={contentId} className={styles.content} hidden={!expanded}>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
        {children}
      </div>
    </section>
  );
}
