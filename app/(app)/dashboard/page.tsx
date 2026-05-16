import { fetchDashboardData } from "@/lib/dashboard";
import DashboardView from "./_view";

// 운영 지표는 자주 바뀌므로 캐시 비활성화
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const data = await fetchDashboardData();
  return <DashboardView data={data} />;
}
