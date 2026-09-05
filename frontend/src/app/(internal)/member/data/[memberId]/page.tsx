import { MemberDetailScreen } from "@/features/member/data/components/MemberDetailScreen";
export default async function MemberDetailPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  return <MemberDetailScreen memberId={memberId} />;
}
