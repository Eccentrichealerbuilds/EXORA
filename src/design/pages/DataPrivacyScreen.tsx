import React from 'react';
import { ArrowLeftIcon, ChevronRightIcon } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { PreferenceRow } from '../components/ui/PreferenceRow';
import { Switch } from '../components/ui/Switch';
import { TitleBand } from '../components/ui/TitleBand';

export type PrivacySettingKey =
'dataSaver' |
'keepRecentCharts' |
'lockOnReturn' |
'hideWalletInShares' |
'hapticFeedback' |
'notificationSounds';

export type PrivacySettings = Record<PrivacySettingKey, boolean>;

interface DataPrivacyScreenProps {
  settings: PrivacySettings;
  onSettingChange: (key: PrivacySettingKey, value: boolean) => void;
  historyLoadingLabel: string;
  onHistoryLoading: () => void;
  lastSync?: string | null;
  onManageStorage: () => void;
  onBack: () => void;
}

const TOGGLES: Record<PrivacySettingKey, {title: string;description: string;}> = {
  dataSaver: { title: 'Data saver', description: 'Stream detailed data for the market you open.' },
  keepRecentCharts: { title: 'Keep recent charts', description: 'Read saved charts while reconnecting.' },
  lockOnReturn: { title: 'Lock on return', description: 'Unlock the app with device biometrics.' },
  hideWalletInShares: { title: 'Hide wallet in shares', description: 'Share trade results without your address.' },
  hapticFeedback: { title: 'Haptic feedback', description: 'Subtle feedback for controls and confirmations.' },
  notificationSounds: { title: 'Notification sounds', description: 'Play sounds for in-app notifications. Device sounds follow system settings.' }
};

export function DataPrivacyScreen(props: DataPrivacyScreenProps) {
  const toggle = (key: PrivacySettingKey) =>
  <PreferenceRow
    key={key}
    title={TOGGLES[key].title}
    description={TOGGLES[key].description}
    control={<Switch label={TOGGLES[key].title} checked={props.settings[key]} onChange={(v) => props.onSettingChange(key, v)} />} />;



  return (
    <>
      <TitleBand
        eyebrow="APP PREFERENCES"
        title="Data & privacy"
        action={
        <IconButton label="Back" tone="ink" onClick={props.onBack}>
            <ArrowLeftIcon className="h-5 w-5" strokeWidth={1.7} />
          </IconButton>
        } />

      <div className="flex flex-col gap-1 px-[18px] py-3">
        <SectionHeading>Mobile data</SectionHeading>
        {toggle('dataSaver')}
        {toggle('keepRecentCharts')}
        <LinkRow title="Load older history" value={props.historyLoadingLabel} onClick={props.onHistoryLoading} />
        <p className="whitespace-pre text-micro font-medium text-muted">Last sync {props.lastSync ?? '—'} · Saved data shows its update time.</p>

        <SectionHeading>Privacy</SectionHeading>
        {toggle('lockOnReturn')}
        {toggle('hideWalletInShares')}

        <SectionHeading>Feedback</SectionHeading>
        {toggle('hapticFeedback')}
        {toggle('notificationSounds')}

        <SectionHeading>Storage</SectionHeading>
        <LinkRow title="Saved charts & activity" value="Manage" onClick={props.onManageStorage} />
        <p className="text-micro font-medium text-muted">Trading always requires a live connection.</p>
      </div>
    </>);

}

function SectionHeading({ children }: {children: React.ReactNode;}) {
  return <h2 className="pt-3 text-sm font-semibold text-fg first:pt-0">{children}</h2>;
}

function LinkRow({ title, value, onClick }: {title: string;value: string;onClick: () => void;}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">

      <span className="text-xs font-medium text-fg">{title}</span>
      <span className="flex items-center gap-1 text-xs text-muted">
        {value}
        <ChevronRightIcon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />
      </span>
    </button>);

}