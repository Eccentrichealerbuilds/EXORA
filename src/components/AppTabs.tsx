import { ActivityIcon, ChartCandlestickIcon, HouseIcon, WalletIcon } from "lucide-react";
import { useNavigate } from "react-router";

export type AppTab = "trade" | "portfolio" | "activity" | "home";
const tabs = [
  { id: "home", label: "Home", icon: HouseIcon, path: "/home" },
  { id: "trade", label: "Trade", icon: ChartCandlestickIcon, path: "/trade" },
  { id: "portfolio", label: "Portfolio", icon: WalletIcon, path: "/portfolio" },
  { id: "activity", label: "Activity", icon: ActivityIcon, path: "/activity" },
] as const;

export function AppTabs({ active }: { active: AppTab }) {
  const navigate = useNavigate();
  return <nav aria-label="Primary" className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#10111b]/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
    <div className="mx-auto flex max-w-[540px] items-center gap-1">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const current = active === tab.id;
        return <button key={tab.id} type="button" aria-current={current ? "page" : undefined}
          onClick={() => navigate(tab.path)}
          className={`flex h-[54px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-medium transition-colors ${current ? "bg-[#baa5ff]/15 text-[#d3c4ff]" : "text-[#a6a7b8]"}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={current ? 2.2 : 1.8} aria-hidden="true" />{tab.label}
        </button>;
      })}
    </div>
  </nav>;
}
