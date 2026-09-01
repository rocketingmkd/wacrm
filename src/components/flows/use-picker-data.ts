"use client";

/**
 * Client-side data loaders shared by Flows' node-config forms and the
 * trigger panel — anywhere a builder needs the account's tags or
 * pipelines/stages to render a picker instead of a raw-UUID input.
 *
 * Why this file and not `shared.tsx`: `shared.tsx` documents itself as
 * node-rendering metadata shared by BOTH editor views, has no
 * `'use client'` directive, and is imported by `src/lib/flows/edges.ts`
 * (a lib module, compiled for the server) and exercised by
 * `shared.test.ts` in a node vitest environment. Turning it into a
 * data-fetching module would break that scope. This file is a plain
 * client-only sibling instead.
 *
 * `useUserTags` fetches through `/api/tags` (an existing REST route);
 * `usePipelinesAndStages` queries the browser Supabase client
 * directly, mirroring exactly how Automations' `ResourcesProvider`
 * (`src/components/automations/automation-builder.tsx`) already loads
 * `pipelines`/`pipeline_stages` — RLS already scopes both tables to
 * the caller's account, proven by that code working today, so no new
 * API route is needed. Every hook here falls back to an empty array
 * on a missing/unreachable endpoint; callers render a raw-UUID input
 * fallback in that case, same contract as the tag/AI-agent pickers
 * elsewhere in Flows and Automations.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface UserTag {
  id: string;
  name: string;
  color?: string;
}

/** Moved verbatim from node-config-form.tsx so the trigger panel's
 *  new `tag_added` config can reuse it without duplicating the fetch. */
export function useUserTags(): UserTag[] {
  const [tags, setTags] = useState<UserTag[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tags").catch(() => null);
        if (!res || !res.ok) return;
        const json = (await res.json()) as { tags?: UserTag[] };
        if (!cancelled) setTags(json.tags ?? []);
      } catch {
        // Tags endpoint absent — caller falls back to raw input.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return tags;
}

export interface PipelineOption {
  id: string;
  name: string;
}

export interface PipelineStageOption {
  id: string;
  name: string;
  pipeline_id: string;
  position: number;
}

/** Backs the `deal_stage_changed` trigger's pipeline+stage picker.
 *  Query shape mirrors automation-builder.tsx's ResourcesProvider
 *  exactly (same two tables, same columns, same ordering). */
export function usePipelinesAndStages(): {
  pipelines: PipelineOption[];
  stages: PipelineStageOption[];
} {
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<PipelineStageOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          supabase.from("pipelines").select("id, name").order("name"),
          supabase
            .from("pipeline_stages")
            .select("id, name, pipeline_id, position")
            .order("position"),
        ]);
        if (cancelled) return;
        setPipelines((pRes.data as PipelineOption[] | null) ?? []);
        setStages((sRes.data as PipelineStageOption[] | null) ?? []);
      } catch {
        // Tables unreachable (RLS / network) — caller falls back to
        // raw-UUID inputs.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { pipelines, stages };
}
