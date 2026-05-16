import { notFound } from "next/navigation";
import { fetchRecordingDetail } from "@/lib/recordings";
import RecordingDetailView from "./_view";

// 캐시 비활성화 — 상태가 자주 바뀌므로 항상 최신 조회
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RecordingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await fetchRecordingDetail(id);

  if (!data) {
    notFound();
  }

  return <RecordingDetailView data={data} />;
}
