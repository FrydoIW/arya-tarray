import { MemberDetailScreen } from "@/features/member/data/components/MemberDetailScreen";
export default async function MemberDetailPage({ params, searchParams }: { params: Promise<{ memberId: string }>; searchParams: Promise<{ editProfile?: string }> }) {
  const { memberId } = await params;
  const { editProfile } = await searchParams;
  return <MemberDetailScreen memberId={memberId} editProfileInitially={editProfile === "1"} />;
}
