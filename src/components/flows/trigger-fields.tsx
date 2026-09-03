'use client';

/**
 * Flow-level trigger configuration — shared by both editor views.
 *
 * Lives in its own file (not inlined in flow-builder.tsx / flow-canvas.tsx)
 * because it's rendered from both: the list view puts it inside the
 * `start` node's expanded card, the canvas view puts it inside the
 * `start` node's side-sheet. Trigger data (`trigger_type` /
 * `trigger_config`) is flow-level state, NOT part of the start node's
 * own `config` JSONB (`StartNodeConfig` only ever held `next_node_key`)
 * — this component takes `state`/`setState` directly rather than the
 * `onUpdateConfig` callback every other per-node form uses, and is
 * rendered as a sibling to (not inside) `NodeConfigForm`.
 *
 * Originally a standalone "Gatilho" section above the node list in
 * both views. Moved into the `start` node itself — "what starts the
 * flow" reads more naturally attached to the node that IS the start,
 * and it's the only way the canvas view can configure the trigger at
 * all (it never had its own top-level trigger panel).
 *
 * The trigger-type Select's items are long, full-sentence labels
 * (`Flows.builder.trigger*Title`) — when this lived in a 2-column grid
 * half-width, and the Select's own width defaulted to whatever the
 * CURRENTLY selected option's text measured (`w-fit` on
 * `SelectTrigger`), the popup (which matches the trigger's anchor
 * width) clipped every other, longer option — shadcn's `SelectItem`
 * text is `whitespace-nowrap` with no ellipsis, so a too-narrow popup
 * just cuts text off mid-word. Fixed two ways: `w-full` on every
 * `SelectTrigger` here so the popup always matches the (now
 * single-column, node-card-width) trigger button instead of the
 * previously-selected option's width, and shortened the label copy
 * itself (see the i18n catalogs) so even a fairly narrow node card
 * has room.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type ValidationIssue } from '@/lib/flows/validate';
import { IssueLine } from './validation-panel';
import { DEFAULT_TRIGGER_CONFIG, type BuilderState } from './flow-editor-state';
import { useUserTags, usePipelinesAndStages } from './use-picker-data';
import type { FlowTriggerType } from '@/lib/flows/types';

/** Mirrors the `<SelectItem>` labels in `TriggerFields` below — used to
 *  resolve the closed trigger's display label directly instead of
 *  relying on Base UI's auto-lookup (see the `SelectValue` comment). */
const TRIGGER_TYPE_LABEL_KEY: Record<FlowTriggerType, string> = {
  keyword: 'triggerKeywordTitle',
  new_contact_created: 'triggerNewContactTitle',
  first_inbound_message: 'triggerFirstInboundTitle',
  new_message_received: 'triggerNewMessageTitle',
  tag_added: 'triggerTagAddedTitle',
  deal_stage_changed: 'triggerDealStageTitle',
  manual: 'triggerManualTitle',
};

// ============================================================
// Keyword trigger input
// ============================================================

/**
 * Comma-separated keyword entry. Keeps a local draft string so the
 * comma (and trailing space) the user types survive until they're done
 * — parsing into the keywords array on every keystroke stripped the
 * trailing comma the instant it was typed, making it impossible to
 * start a second keyword (issue #234). We commit on blur / Enter, then
 * re-display the cleaned, rejoined form. Seeded once on mount; the
 * component unmounts/remounts when the trigger type changes, so the
 * seed stays in sync. Mirrors the automations builder's KeywordMatchConfig.
 */
function KeywordsInput({
  keywords,
  onChange,
  t,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [draft, setDraft] = useState(keywords.join(', '));

  function commit() {
    const parsed = draft
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    setDraft(parsed.join(', '));
    onChange(parsed);
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      placeholder={t('keywordsPlaceholder')}
      className="bg-muted"
    />
  );
}

// ============================================================
// tag_added / deal_stage_changed trigger config
// ============================================================

/** Tag picker for the `tag_added` trigger. Same visual shape as
 *  SetTagForm's tag block (node-config-form.tsx) — copied rather than
 *  shared, since the two live in different panels with different
 *  labels/layout. */
function TagTriggerFields({
  tagId,
  onChange,
  t,
}: {
  tagId: string;
  onChange: (tagId: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tags = useUserTags();
  if (tags.length === 0) {
    return (
      <Input
        value={tagId}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('form.tagUuidPlaceholder')}
        className="bg-muted font-mono text-xs"
      />
    );
  }
  return (
    <Select value={tagId} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className="bg-muted w-full">
        <SelectValue placeholder={t('form.pickTag')} />
      </SelectTrigger>
      <SelectContent>
        {tags.map((tag) => (
          <SelectItem key={tag.id} value={tag.id}>
            {tag.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Pipeline + stage picker for the `deal_stage_changed` trigger.
 *  Mirrors DealPipelineFields in the Automations builder — pipeline
 *  select, dependent stage select, auto-picks the first stage on
 *  pipeline change — but uses SelectValue's placeholder instead of an
 *  `<option value="">`, since shadcn's Select (used here, unlike
 *  Automations' native <select>) can't have an empty-string item. */
function DealStageTriggerFields({
  pipelineId,
  stageId,
  onChange,
  t,
}: {
  pipelineId: string;
  stageId: string;
  onChange: (patch: { pipeline_id: string; stage_id: string }) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { pipelines, stages } = usePipelinesAndStages();
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId);

  if (pipelines.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          value={pipelineId}
          onChange={(e) => onChange({ pipeline_id: e.target.value, stage_id: stageId })}
          placeholder={t('triggerPipelineIdPlaceholder')}
          className="bg-muted font-mono text-xs"
        />
        <Input
          value={stageId}
          onChange={(e) => onChange({ pipeline_id: pipelineId, stage_id: e.target.value })}
          placeholder={t('triggerStageIdPlaceholder')}
          className="bg-muted font-mono text-xs"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Select
        value={pipelineId}
        onValueChange={(v) => {
          const nextPipelineId = v ?? '';
          const firstStage = stages.find((s) => s.pipeline_id === nextPipelineId);
          onChange({ pipeline_id: nextPipelineId, stage_id: firstStage?.id ?? '' });
        }}
      >
        <SelectTrigger className="bg-muted w-full">
          <SelectValue placeholder={t('triggerPipelinePlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {pipelines.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={stageId}
        onValueChange={(v) => onChange({ pipeline_id: pipelineId, stage_id: v ?? '' })}
        disabled={!pipelineId}
      >
        <SelectTrigger className="bg-muted w-full">
          <SelectValue
            placeholder={
              pipelineId ? t('triggerStagePlaceholder') : t('triggerStagePickPipelineFirst')
            }
          />
        </SelectTrigger>
        <SelectContent>
          {stageOptions.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================================
// Trigger fields — the exported piece both views mount
// ============================================================

export function TriggerFields({
  state,
  setState,
  triggerIssues,
  t,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  triggerIssues: ValidationIssue[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {t('triggerTitle')}
      </p>
      <div>
        <label className="text-muted-foreground mb-1 block text-xs">
          {t('whenLabel')}
        </label>
        <Select
          value={state.trigger_type}
          onValueChange={(v) =>
            setState((s) => ({
              ...s,
              trigger_type: v as FlowTriggerType,
              trigger_config: DEFAULT_TRIGGER_CONFIG[v as FlowTriggerType],
            }))
          }
        >
          <SelectTrigger className="bg-muted w-full">
            {/* Explicit label lookup, not the bare-`<SelectValue />`
                auto-resolve — Base UI can't resolve an item's label
                until the popup has mounted once (on first open), so
                the closed trigger would show the raw `trigger_type`
                value (e.g. "new_message_received") until then. */}
            <SelectValue>{() => TRIGGER_TYPE_LABEL_KEY[state.trigger_type] ? t(TRIGGER_TYPE_LABEL_KEY[state.trigger_type]) : state.trigger_type}</SelectValue>
          </SelectTrigger>
          {/* Options ordered to match the entry-match priority
              (selectEntryFlow in src/lib/flows/engine.ts): most
              specific first, catch-all near the end. The order itself
              is free documentation of the resolution rule for a
              non-technical author. */}
          <SelectContent>
            <SelectItem value="keyword">{t('triggerKeywordTitle')}</SelectItem>
            <SelectItem value="new_contact_created">
              {t('triggerNewContactTitle')}
            </SelectItem>
            <SelectItem value="first_inbound_message">
              {t('triggerFirstInboundTitle')}
            </SelectItem>
            <SelectItem value="new_message_received">
              {t('triggerNewMessageTitle')}
            </SelectItem>
            <SelectItem value="tag_added">{t('triggerTagAddedTitle')}</SelectItem>
            <SelectItem value="deal_stage_changed">
              {t('triggerDealStageTitle')}
            </SelectItem>
            <SelectItem value="manual">{t('triggerManualTitle')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground mt-1 text-[11px]">
          {t(`triggerHint.${state.trigger_type}`)}
        </p>
      </div>
      {state.trigger_type === 'keyword' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t('keywordsLabel')}
          </label>
          <KeywordsInput
            keywords={
              Array.isArray(state.trigger_config.keywords)
                ? (state.trigger_config.keywords as string[])
                : []
            }
            onChange={(keywords) =>
              setState((s) => ({
                ...s,
                trigger_config: { ...s.trigger_config, keywords },
              }))
            }
            t={t}
          />
        </div>
      )}
      {state.trigger_type === 'tag_added' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t('triggerTagLabel')}
          </label>
          <TagTriggerFields
            tagId={(state.trigger_config.tag_id as string) ?? ''}
            onChange={(tag_id) =>
              setState((s) => ({ ...s, trigger_config: { tag_id } }))
            }
            t={t}
          />
        </div>
      )}
      {state.trigger_type === 'deal_stage_changed' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t('triggerPipelineLabel')} / {t('triggerStageLabel')}
          </label>
          <DealStageTriggerFields
            pipelineId={(state.trigger_config.pipeline_id as string) ?? ''}
            stageId={(state.trigger_config.stage_id as string) ?? ''}
            onChange={(patch) =>
              setState((s) => ({ ...s, trigger_config: patch }))
            }
            t={t}
          />
        </div>
      )}
      {triggerIssues.length > 0 && (
        <div className="flex flex-col gap-1">
          {triggerIssues.map((i, ix) => (
            <IssueLine key={ix} issue={i} />
          ))}
        </div>
      )}
    </div>
  );
}
