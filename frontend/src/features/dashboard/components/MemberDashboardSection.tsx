import Link from "next/link";
import { ArrowRight, BadgeDollarSign, ReceiptText, UserRoundSearch, UsersRound } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatDate, formatMoney } from "@/lib/format";
import type { DashboardSummary } from "../types";
import { DashboardPanelLoading } from "./DashboardPanelLoading";

const EMPTY_MEMBER_SUMMARY: DashboardSummary["memberSummary"] = {
  linkedAmount: "0.00", contributingMemberCount: 0, linkedTransactionCount: 0,
  linkedIdentityCount: 0, unlinkedTransactionCount: 0, unlinkedIdentityCount: 0,
  unlinkedObservedAmount: "0.00", unverifiedIdentityCount: 0
};

export function MemberDashboardSection({ data, loading, periodLabel, canViewMemberData, canViewMemberRegistration }: {
  data: DashboardSummary | null;
  loading: boolean;
  periodLabel: string;
  canViewMemberData: boolean;
  canViewMemberRegistration: boolean;
}) {
  const summary = data?.memberSummary ?? EMPTY_MEMBER_SUMMARY;
  const topMembers = data?.topMembers ?? [];
  const eventGroups = data?.memberEventGroups ?? [];
  const followUp = data?.registrationFollowUp ?? { unverifiedIdentityCount: 0, identities: [] };

  return (
    <section className="dashboard-member-section" aria-labelledby="dashboard-member-title">
      <div className="dashboard-member-heading">
        <div><span>Member monitoring</span><h2 id="dashboard-member-title">Donatur</h2><p>Finalized Member donations and registration coverage for {periodLabel}.</p></div>
        <span className="dashboard-member-period">{periodLabel}</span>
      </div>

      <div className="dashboard-member-metrics">
        <MetricCard label="Donasi Terhubung" value={loading ? "—" : formatMoney(summary.linkedAmount)} detail="Finalized · verified Member" icon={<BadgeDollarSign size={19} />} tone="maroon" />
        <MetricCard label="Donatur Aktif" value={loading ? "—" : summary.contributingMemberCount.toLocaleString("id-ID")} detail="Distinct contributing Members" icon={<UsersRound size={19} />} tone="green" />
        <MetricCard label="Transaksi Donatur" value={loading ? "—" : summary.linkedTransactionCount.toLocaleString("id-ID")} detail={`${summary.linkedIdentityCount.toLocaleString("id-ID")} linked identities`} icon={<ReceiptText size={19} />} tone="blue" />
        <MetricCard label="Identitas Belum Terdaftar" value={loading ? "—" : summary.unverifiedIdentityCount.toLocaleString("id-ID")} detail="Observed identities needing review" icon={<UserRoundSearch size={19} />} tone="gold" />
      </div>

      <div className="dashboard-member-grid">
        <article className="ui-card dashboard-panel">
          <div className="dashboard-panel-header">
            <div><h2>Top Donatur</h2><p>Current canonical ownership · finalized donation only</p></div>
            {canViewMemberData ? <Link href="/member/data" className="dashboard-panel-link">Data Donatur <ArrowRight size={13} /></Link> : null}
          </div>
          {loading ? <DashboardPanelLoading label="Loading Top Donatur…" /> : topMembers.length === 0 ? (
            <div className="dashboard-empty-panel">No linked Member donation in {periodLabel}.</div>
          ) : (
            <div className="dashboard-member-ranking">
              {topMembers.map((member, index) => (
                <div className="dashboard-member-rank" key={member.memberId}>
                  <span>{index + 1}</span>
                  <div>
                    {canViewMemberData ? <Link href={`/member/data/${member.memberId}`}>{member.memberCode}</Link> : <strong>{member.memberCode}</strong>}
                    <small>{member.memberName}{member.activeFlag ? "" : " · Inactive"}</small>
                  </div>
                  <small>{member.transactionCount.toLocaleString("id-ID")} tx</small>
                  <strong>{formatMoney(member.amount)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="ui-card dashboard-panel">
          <div className="dashboard-panel-header">
            <div><h2>Identity Coverage</h2><p>Operational linkage, separate from official Member totals</p></div>
          </div>
          {loading ? <DashboardPanelLoading label="Loading identity coverage…" /> : (
            <div className="dashboard-member-coverage">
              <div className="is-linked"><span>Terhubung</span><strong>{summary.linkedTransactionCount.toLocaleString("id-ID")} transactions</strong><small>{summary.linkedIdentityCount.toLocaleString("id-ID")} identities · {formatMoney(summary.linkedAmount)}</small></div>
              <div className="is-unlinked"><span>Belum Terhubung</span><strong>{summary.unlinkedTransactionCount.toLocaleString("id-ID")} transactions</strong><small>{summary.unlinkedIdentityCount.toLocaleString("id-ID")} observed identities · source coverage {formatMoney(summary.unlinkedObservedAmount)}</small></div>
              <p>Belum Terhubung is source coverage only and is not included in Donasi Terhubung.</p>
            </div>
          )}
        </article>

        <article className="ui-card dashboard-panel">
          <div className="dashboard-panel-header">
            <div><h2>Registration Follow-up</h2><p>Most recently observed UNVERIFIED identities</p></div>
            {canViewMemberRegistration ? <Link href="/member/registration" className="dashboard-panel-link">Registrasi <ArrowRight size={13} /></Link> : null}
          </div>
          {loading ? <DashboardPanelLoading label="Loading registration follow-up…" /> : followUp.identities.length === 0 ? (
            <div className="dashboard-empty-panel">No unverified observed identities in {periodLabel}.</div>
          ) : (
            <div className="dashboard-follow-up-list">
              {followUp.identities.map(identity => (
                <div key={identity.memberIdentityId}>
                  <strong>{identity.accountName}</strong>
                  <span>{identity.transactionCount.toLocaleString("id-ID")} transactions</span>
                  <small>{formatDate(identity.firstSeenAt)} → {formatDate(identity.lastSeenAt)}</small>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="ui-card dashboard-panel dashboard-member-events">
          <div className="dashboard-panel-header">
            <div><h2>Member Event &amp; Category</h2><p>Actual Final Event distribution for linked Member donations</p></div>
          </div>
          {loading ? <DashboardPanelLoading label="Loading Member event breakdown…" /> : eventGroups.length === 0 ? (
            <div className="dashboard-empty-panel">No linked Member Event data in {periodLabel}.</div>
          ) : (
            <div className="dashboard-member-event-list">
              {eventGroups.map(group => (
                <details key={group.category}>
                  <summary><strong>{group.category}</strong><span>{group.memberCount.toLocaleString("id-ID")} Members · {group.transactionCount.toLocaleString("id-ID")} tx</span><em>{formatMoney(group.amount)}</em></summary>
                  <div>
                    {group.events.map(event => (
                      <div className="dashboard-member-event-row" key={event.eventCodeId}>
                        <strong>{event.eventCode}</strong><span>{event.eventName}</span><small>{event.memberCount.toLocaleString("id-ID")} Members · {event.transactionCount.toLocaleString("id-ID")} tx</small><em>{formatMoney(event.amount)}</em>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
