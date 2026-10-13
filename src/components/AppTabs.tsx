import { useNavigate } from "react-router";
import { BottomNav, type NavTab } from "../design/components/layout/BottomNav";
export type AppTab = NavTab;
export function AppTabs({ active }: { active: AppTab }) {
 const navigate = useNavigate();
 return <div className="exora-design fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[540px]">
  <BottomNav active={active} onNavigate={tab => navigate(`/${tab}`, { replace: true })} />
 </div>;
}
