import { useState } from 'react';
import { SettingsIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { PreferenceRow } from '../components/ui/PreferenceRow';
import { Segmented } from '../components/ui/Segmented';
import { SelectField, SelectOption } from '../components/ui/SelectField';
import { Switch } from '../components/ui/Switch';
import { Tabs } from '../components/ui/Tabs';
import { TextField } from '../components/ui/TextField';
import { TitleBand } from '../components/ui/TitleBand';

export interface PriceAlertDraft {
  market: string;
  watch: string;
  direction: 'above' | 'below';
  targetPrice: string;
}

export interface AlertPreferences {
  orderFills: boolean;
  slTpUpdates: boolean;
  liquidationThreshold: string;
}

interface AlertsScreenProps {
  initialAlert: PriceAlertDraft;
  marketOptions: SelectOption[];
  watchOptions: SelectOption[];
  thresholdOptions: SelectOption[];
  preferences: AlertPreferences;
  onPreferencesChange: (preferences: AlertPreferences) => void;
  onCreateAlert: (alert: PriceAlertDraft) => void;
  onOpenSettings: () => void;
}

export function AlertsScreen(props: AlertsScreenProps) {
  const { preferences, thresholdOptions } = props;
  const [tab, setTab] = useState<'create' | 'preferences'>('create');
  const [alert, setAlert] = useState<PriceAlertDraft>(props.initialAlert);
  const [attempted, setAttempted] = useState(false);
  const update = <K extends keyof PriceAlertDraft,>(key: K, value: PriceAlertDraft[K]) => setAlert((a) => ({ ...a, [key]: value }));
  const setPreference = <K extends keyof AlertPreferences,>(key: K, value: AlertPreferences[K]) =>
  props.onPreferencesChange({ ...preferences, [key]: value });

  const handleCreate = () => {
    setAttempted(true);
    if (alert.targetPrice.trim()) props.onCreateAlert(alert);
  };

  return (
    <>
      <TitleBand
        eyebrow="NOTIFICATIONS"
        title="Alerts"
        subtitle="Prices, orders and position health"
        action={
        <IconButton label="Alert settings" tone="ink" onClick={props.onOpenSettings}>
            <SettingsIcon className="h-5 w-5" strokeWidth={1.7} />
          </IconButton>
        } />

      <div className="flex flex-col gap-1 px-[18px] py-3">
        <Tabs
          size="sm"
          label="Alert view"
          items={[
          { value: 'create', label: 'Create alert' },
          { value: 'preferences', label: 'Preferences' }]
          }
          value={tab}
          onChange={setTab} />


        {tab === 'create' &&
        <>
            <SelectField layout="inline" label="Market" value={alert.market} options={props.marketOptions} onChange={(v) => update('market', v)} />
            <SelectField layout="inline" label="Watch" value={alert.watch} options={props.watchOptions} onChange={(v) => update('watch', v)} />
            <div className="flex h-8 items-center justify-between gap-2">
              <span className="text-xs text-muted">Condition</span>
              <Segmented
              label="Condition"
              className="w-44"
              options={[
              { value: 'above', label: 'Above', activeClassName: 'bg-accent text-ink rounded' },
              { value: 'below', label: 'Below', activeClassName: 'bg-accent text-ink rounded' }]
              }
              value={alert.direction}
              onChange={(v) => update('direction', v)}
              inactiveClassName="bg-surface text-muted"
              itemClassName="h-7" />

            </div>
            <TextField
            label="Target price"
            suffix="USD"
            value={alert.targetPrice}
            onChange={(v) => update('targetPrice', v)}
            error={attempted && !alert.targetPrice.trim() ? 'Enter an amount' : undefined} />

            <p className="text-micro font-medium text-muted">Alert once when the condition is met.</p>
            <Button onClick={handleCreate}>Create alert</Button>
            <div className="h-2" />
          </>
        }

        <h2 className="text-sm font-semibold text-fg">Order &amp; position alerts</h2>
        <PreferenceRow
          title="Order fills"
          description="Full and partial fills"
          control={<Switch label="Order fills" checked={preferences.orderFills} onChange={(v) => setPreference('orderFills', v)} />} />

        <PreferenceRow
          title="SL / TP updates"
          description="Trigger and execution status"
          control={<Switch label="SL / TP updates" checked={preferences.slTpUpdates} onChange={(v) => setPreference('slTpUpdates', v)} />} />

        <SelectField
          layout="preference"
          className="border-b border-line"
          label="Liquidation distance"
          placeholder="Choose a warning threshold"
          value={preferences.liquidationThreshold}
          options={thresholdOptions.map((o) => ({ value: o.value, label: o.value === "off" ? "Off" : `Warn at ${o.label}` }))}
          onChange={(v) => setPreference('liquidationThreshold', v)} />

      </div>
    </>);

}