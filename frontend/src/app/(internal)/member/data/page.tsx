import { MemberDataScreen } from "@/features/member/data/components/MemberDataScreen";
import { Suspense } from "react";
export default function MemberDataPage() { return <Suspense fallback={<p>Memuat Data Donatur…</p>}><MemberDataScreen /></Suspense>; }
