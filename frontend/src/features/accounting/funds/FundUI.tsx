'use client';

import Link from 'next/link';
import { AccountingStatusIndicator } from '../components/AccountingFoundation';
import { CorePolicyNote } from '../core/CoreUI';
import styles from '../core/core.module.css';
import type { Fund, FundClass } from './types';

export const fundsHref = '/accounting/funds';
export const fundHref = (id: string) => fundsHref + '/' + id;
export const restrictionHref = (id: string) => fundsHref + '/restrictions/' + id;
export const designationHref = (id: string) => fundsHref + '/designations/' + id;
export const movementHref = (id: string) => fundsHref + '/movements/' + id;
export const classLabel: Record<FundClass, string> = {
  UNRESTRICTED: 'Unrestricted', DONOR_RESTRICTED: 'Donor Restricted',
  CONDITIONAL_LIABILITY: 'Conditional Liability', CONDITIONAL_REVIEW: 'Conditional Funding Review'
};
export const classHelp: Record<FundClass, string> = {
  UNRESTRICTED: 'Resources without a donor-imposed purpose or time restriction.',
  DONOR_RESTRICTED: 'Resources governed by evidenced donor purpose or time terms.',
  CONDITIONAL_LIABILITY: 'Conditional funding classified as a liability under an explicit adopted policy.',
  CONDITIONAL_REVIEW: 'Conditional evidence awaiting policy review. It must not be treated as verified recognition.'
};

export function FundNavigation({ fund }: { fund?: Fund | null }) {
  const suffix = fund ? '?fundId=' + encodeURIComponent(fund.id) : '';
  return <>
    <nav className={styles.toolbar} aria-label="Fund Accounting sections">
      <Link className={styles.link} href={fundsHref}>Fund register</Link>
      <Link className={styles.link} href={fundsHref + '/restrictions' + suffix}>Donor restrictions</Link>
      <Link className={styles.link} href={fundsHref + '/designations' + suffix}>Internal designations</Link>
      <Link className={styles.link} href={fundsHref + '/movements' + suffix}>Fund movements</Link>
      <Link className={styles.link} href={fundsHref + '/reconciliation' + suffix}>Fund–GL reconciliation</Link>
    </nav>
    <CorePolicyNote />
  </>;
}

export function FundClassEvidence({ fund }: { fund: Fund }) {
  return <div className={styles.page}>
    <div className={styles.summary}><strong>{classLabel[fund.fundClass]}</strong><AccountingStatusIndicator status={fund.policyStatus ?? (fund.policy ? 'APPROVED_POLICY' : 'PENDING_POLICY')} /></div>
    <p className={styles.note}>{classHelp[fund.fundClass]}</p>
    <p className={styles.note}>A fund balance is not cash availability. Campaign wallet, donor restriction, internal designation and GL net assets retain separate meanings.</p>
  </div>;
}
