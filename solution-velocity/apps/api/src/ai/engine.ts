/**
 * The assistant engine.
 *
 * `runAssistant` is the single seam where a hosted model could be plugged in. It is
 * deliberately provider-agnostic: it takes a fully-built, project-scoped context and
 * returns a grounded reply plus *proposed* actions. Proposed actions are never applied
 * here — the user confirms them through /assistant/actions/:id/apply, which validates
 * them again server-side before any write happens.
 *
 * With no model provider configured, `groundedAssistant` answers deterministically from
 * the project's real records. Nothing is invented: every figure and title comes from
 * the database.
 */
import type { ProjectContext } from './context.js';
import type { AssistantActionType, JourneyPayload } from '@sv/shared';

export type ProposedAction = {
  actionType: AssistantActionType;
  payload: Record<string, unknown>;
  summary: string;
};

export type AssistantResult = {
  content: string;
  actions: ProposedAction[];
  suggestedPrompts: string[];
};

export type AssistantEngine = (input: {
  message: string;
  context: ProjectContext;
  history: { role: string; content: string }[];
}) => Promise<AssistantResult>;

/* ------------------------------------------------------------------ */
/* Deterministic, evidence-grounded assistant                          */
/* ------------------------------------------------------------------ */

const pct = (n: number) => `${Math.round(n * 100)}%`;

const dateLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date';

function stageOf(p: JourneyPayload, id: number | null) {
  return id == null ? null : (p.stages.find((s) => s.id === id) ?? null);
}

function lines(...items: (string | null | undefined | false)[]) {
  return items.filter(Boolean).join('\n');
}

/** Reads the intent from free text without pretending to be a general-purpose model. */
type Intent =
  | 'status'
  | 'next'
  | 'blockers'
  | 'requirements'
  | 'documents'
  | 'design'
  | 'milestones'
  | 'review'
  | 'create_requirement'
  | 'create_activity'
  | 'create_document'
  | 'create_risk'
  | 'create_milestone'
  | 'assign'
  | 'dependency'
  | 'summary'
  | 'help'
  | 'unknown';

export function detectIntent(message: string): Intent {
  const m = message.toLowerCase();
  if (/\b(create|add|draft|write|generate|propose)\b.*\brequirement/.test(m)) return 'create_requirement';
  if (/\b(create|add)\b.*\b(activit|task)/.test(m)) return 'create_activity';
  if (/\b(create|add|draft|generate|write)\b.*\b(document|doc|report|spec)/.test(m)) return 'create_document';
  if (/\b(create|add|log|raise)\b.*\brisk/.test(m)) return 'create_risk';
  if (/\b(create|add|plan)\b.*\bmilestone/.test(m)) return 'create_milestone';
  if (/\b(assign|give)\b/.test(m)) return 'assign';
  if (/\b(dependenc|depends|blocked by|prerequisite)/.test(m)) return 'dependency';
  if (/\b(what|which)\b.*\bnext\b|\bnext step|\bwhat should (i|we) (do|work)/.test(m)) return 'next';
  if (/\b(block|stuck|delay|at risk|risk)/.test(m)) return 'blockers';
  if (/\b(requirement)/.test(m)) return 'requirements';
  if (/\b(document|doc)\b/.test(m)) return 'documents';
  if (/\b(design|artifact|studio)/.test(m)) return 'design';
  if (/\b(milestone)/.test(m)) return 'milestones';
  if (/\b(review|approv)/.test(m)) return 'review';
  if (/\b(summar|status|progress|where.*(stand|are)|how.*going)/.test(m)) return 'status';
  if (/\b(help|can you|what can)/.test(m)) return 'help';
  return 'unknown';
}

/** Pulls a quoted or "for/about X" subject out of a message to seed an action. */
function extractSubject(message: string): string {
  const quoted = message.match(/"([^"]{3,120})"/) ?? message.match(/'([^']{3,120})'/);
  if (quoted) return quoted[1].trim();
  const about = message.match(/\b(?:for|about|on|regarding)\s+(?:the\s+)?([a-z0-9][^.,;?!]{2,100})/i);
  if (about) return about[1].trim().replace(/\s+(stage|activity|project|milestone)$/i, '').trim();
  return '';
}

function currentStage(p: JourneyPayload) {
  return p.stages.find((s) => s.id === p.project.currentStageId) ?? p.stages.find((s) => s.status === 'active') ?? null;
}

function groundedAssistant(input: {
  message: string;
  context: ProjectContext;
  history: { role: string; content: string }[];
}): AssistantResult {
  const { message, context } = input;
  const p = context.journey;
  const intent = detectIntent(message);
  const stage = currentStage(p);
  const actions: ProposedAction[] = [];
  const subject = extractSubject(message);

  const suggestedPrompts = [
    'Summarise everything outstanding in this project',
    'What is blocking progress right now?',
    'What should we work on next?',
    'Create a requirement for ' + (stage?.name.toLowerCase() ?? 'the current stage'),
    'Draft a progress report for this stage',
    'Identify dependencies that could delay the next milestone',
  ];

  const header = `**${p.project.name}** · ${p.project.templateName} · ${pct(p.project.progress)} complete${
    stage ? ` · current stage: ${stage.name}` : ''
  }`;

  switch (intent) {
    case 'status':
    case 'summary': {
      const s = p.stats;
      const stageLines = p.stages
        .map(
          (st) =>
            `- **${st.name}** — ${st.status}, ${st.completedCount}/${st.activityCount} activities${
              st.milestone ? `, milestone "${st.milestone.name}" ${st.milestone.status}` : ''
            }`,
        )
        .join('\n');
      const content = lines(
        header,
        '',
        `Overall progress is ${pct(p.project.progress)}: ${s.completed} of ${s.activities} activities are complete, ${s.inProgress} in progress, ${s.blocked} blocked.`,
        '',
        '**Journey**',
        stageLines,
        '',
        '**Outstanding**',
        p.nextActions.length
          ? p.nextActions.map((a) => `- ${a.title} — ${a.detail}`).join('\n')
          : '- Nothing outstanding',
        '',
        `Requirements: ${s.requirements} · Documents: ${s.documents} · Design artifacts: ${s.artifacts} · Open risks: ${s.openRisks} · Decisions recorded: ${s.decisions}`,
        p.pendingApprovals.length ? `\n**Pending approvals:** ${p.pendingApprovals.length}` : '',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'next': {
      const list = p.nextActions.slice(0, 4);
      const content = lines(
        header,
        '',
        list.length ? 'The most useful next actions, based on the actual state of this Journey:' : 'Nothing is outstanding.',
        list.map((a, i) => `${i + 1}. **${a.title}** — ${a.detail}`).join('\n'),
        '',
        stage
          ? `This stage's objective is: _${stage.objective}_`
          : 'Every stage is currently complete — the next decision is whether to close the project or extend the Journey.',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'blockers': {
      const blockers = p.blockers;
      const content = lines(
        header,
        '',
        blockers.length ? `**${blockers.length} item(s) are blocking progress:**` : 'Nothing is currently blocking progress.',
        blockers
          .map((b) => `- **${b.title}** (${b.stageName || 'project'}) — ${b.reason}${b.owner ? ` · owned by ${b.owner}` : ''}`)
          .join('\n'),
        context.risks.filter((r) => r.status !== 'closed').length
          ? `\nOpen risks recorded: ${context.risks
              .filter((r) => r.status !== 'closed')
              .map((r) => `${r.title} (${r.severity})`)
              .join(', ')}`
          : '',
        '',
        'Clearing a blocker is almost always higher value than starting new work — the Journey will not advance while one is open.',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'requirements': {
      const reqs = context.requirements;
      const content = lines(
        header,
        '',
        reqs.length
          ? `**${reqs.length} requirement(s)** are recorded for this project:`
          : 'No requirements are recorded for this project yet.',
        reqs
          .slice(0, 15)
          .map(
            (r) =>
              `- \`${r.ref}\` ${r.title} — ${r.type}, ${r.status}${r.stageId ? ` · ${stageOf(p, r.stageId)?.name ?? ''}` : ''}`,
          )
          .join('\n'),
        '',
        reqs.filter((r) => r.status === 'draft').length
          ? `${reqs.filter((r) => r.status === 'draft').length} are still drafts and cannot be verified yet.`
          : '',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'documents': {
      const docs = context.documents;
      const content = lines(
        header,
        '',
        docs.length
          ? `**${docs.length} document(s)** in this project:`
          : 'No documents have been created in this project yet.',
        docs
          .slice(0, 12)
          .map((d) => `- **${d.title}** (${d.kind}${d.aiGenerated ? ', AI-generated' : ''})${d.stageId ? ` · ${stageOf(p, d.stageId)?.name}` : ''}`)
          .join('\n'),
        '',
        docs.length
          ? `Most recent excerpt from "${docs[0].title}":\n> ${docs[0].excerpt.replace(/\n/g, ' ').slice(0, 280)}${docs[0].excerpt.length > 280 ? '…' : ''}`
          : '',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'design': {
      const arts = context.artifacts;
      const content = lines(
        header,
        '',
        arts.length
          ? `**${arts.length} design artifact(s)** are linked to this project:`
          : 'No design artifacts are linked to this project yet.',
        arts
          .slice(0, 12)
          .map(
            (a) =>
              `- **${a.name}** (${a.type}, ${a.shapes} shape${a.shapes === 1 ? '' : 's'})${
                a.stageId ? ` · ${stageOf(p, a.stageId)?.name}` : ' · not linked to a stage'
              }${a.description ? ` — ${a.description}` : ''}`,
          )
          .join('\n'),
        '',
        arts.some((a) => a.stageId == null)
          ? 'Some artifacts are not linked to a Journey stage. Linking them keeps the design traceable to the work it supports.'
          : '',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'milestones': {
      const ms = p.milestones;
      const content = lines(
        header,
        '',
        ms.length ? '**Milestones in this Journey:**' : 'This Journey has no milestones.',
        ms
          .map(
            (m) =>
              `- **${m.name}** — ${m.status}, target ${dateLabel(m.dueDate)}${
                m.stageId ? ` · ${stageOf(p, m.stageId)?.name}` : ''
              }`,
          )
          .join('\n'),
        '',
        'A milestone completes when its stage activities are done and any pending approvals are decided.',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'review': {
      const content = lines(
        header,
        '',
        p.pendingApprovals.length
          ? `**${p.pendingApprovals.length} approval(s) are waiting:**`
          : 'No approvals are pending.',
        p.pendingApprovals
          .map((a) => `- **${a.title}** (${a.kind}) · ${a.stageName} · requested by ${a.requestedBy}`)
          .join('\n'),
        '',
        p.pendingApprovals.length
          ? 'Approvals gate stage completion, so deciding them is the fastest way to unblock the Journey.'
          : '',
      );
      return { content, actions, suggestedPrompts };
    }

    case 'create_requirement': {
      const title = subject || `New requirement for ${stage?.name ?? p.project.name}`;
      actions.push({
        actionType: 'create_requirement',
        summary: `Create requirement "${title}" in ${stage?.name ?? p.project.name}`,
        payload: {
          title,
          statement: requirementStatement(p.project.name, title),
          type: 'functional',
          priority: 'high',
          stageId: stage?.id ?? null,
          status: 'draft',
        },
      });
      return {
        content: lines(
          header,
          '',
          `I can add this requirement to **${stage?.name ?? 'the project'}** and link it to the current stage so it appears in that activity's requirement list.`,
          '',
          `Proposed: \`${title}\` — a functional requirement, high priority, linked to ${stage?.name ?? 'the project'}.`,
          '',
          'Review and confirm below — nothing is written until you apply it.',
        ),
        actions,
        suggestedPrompts,
      };
    }

    case 'create_activity': {
      const title = subject || `Additional activity for ${stage?.name ?? p.project.name}`;
      actions.push({
        actionType: 'create_activity',
        summary: `Add activity "${title}" to ${stage?.name ?? 'the Journey'}`,
        payload: {
          title,
          description: `Added from the AI Assistant to support ${stage?.name ?? p.project.name}.`,
          stageId: stage?.id ?? p.stages[0]?.id ?? null,
          priority: 'medium',
        },
      });
      return {
        content: lines(
          header,
          '',
          `I can add **"${title}"** as an activity in **${stage?.name ?? 'the first stage'}**.`,
          'It will appear on the Journey path with the standard controls: assignee, due date, dependencies, deliverables and approvals.',
          '',
          'Confirm below to add it.',
        ),
        actions,
        suggestedPrompts,
      };
    }

    case 'create_document': {
      const title = subject || `${stage?.name ?? p.project.name} — progress report`;
      const body = buildReportBody(context, title);
      actions.push({
        actionType: 'create_document',
        summary: `Create document "${title}" in ${stage?.name ?? p.project.name}`,
        payload: { title, kind: 'report', stageId: stage?.id ?? null, content: body, activityId: null },
      });
      return {
        content: lines(
          header,
          '',
          `I've drafted **"${title}"** from this project's current records. Preview:`,
          '',
          body.split('\n').slice(0, 12).join('\n'),
          '',
          'Applying the action saves it as a real document linked to the current stage.',
        ),
        actions,
        suggestedPrompts,
      };
    }

    case 'create_risk': {
      const title = subject || `Delivery risk in ${stage?.name ?? p.project.name}`;
      actions.push({
        actionType: 'create_risk',
        summary: `Log risk "${title}"`,
        payload: {
          title,
          description: `Raised from the AI Assistant. ${p.blockers.length ? `Related to: ${p.blockers[0].reason}` : 'No blocker currently linked.'}`,
          severity: p.blockers.length ? 'high' : 'medium',
          likelihood: 'medium',
          stageId: stage?.id ?? null,
        },
      });
      return {
        content: lines(
          header,
          '',
          `I can log **"${title}"** as a risk on this project${stage ? ` against ${stage.name}` : ''}.`,
          'Risks appear in the attention panel for this project and are visible to every member.',
          '',
          'Confirm below to log it.',
        ),
        actions,
        suggestedPrompts,
      };
    }

    case 'create_milestone': {
      const name = subject || `${stage?.name ?? 'Stage'} checkpoint`;
      actions.push({
        actionType: 'create_milestone',
        summary: `Create milestone "${name}"`,
        payload: { name, description: `Added from the AI Assistant for ${stage?.name ?? p.project.name}.`, stageId: stage?.id ?? null },
      });
      return {
        content: lines(header, '', `I can add a milestone **"${name}"** to ${stage?.name ?? 'this Journey'}.`, '', 'Confirm to create it.'),
        actions,
        suggestedPrompts,
      };
    }

    case 'assign': {
      const person = p.members.find((m) => message.toLowerCase().includes(m.name.toLowerCase().split(' ')[0]));
      const target = p.nextActions.find((a) => a.kind === 'activity');
      if (person && target) {
        actions.push({
          actionType: 'assign_activity',
          summary: `Assign "${target.title}" to ${person.name}`,
          payload: { activityId: target.id, assigneeId: person.userId },
        });
        return {
          content: lines(header, '', `I can assign **"${target.title}"** to **${person.name}**.`, 'Confirm below to change the assignee.'),
          actions,
          suggestedPrompts,
        };
      }
      return {
        content: lines(
          header,
          '',
          'Tell me who and what — for example: _"Assign preliminary analysis to ' + (p.members[0]?.name ?? 'Alex') + '"_ .',
          '',
          `Project members: ${p.members.map((m) => m.name).join(', ')}`,
          `Open activities: ${p.nextActions.filter((a) => a.kind === 'activity').map((a) => a.title).join(', ') || 'none'}`,
        ),
        actions,
        suggestedPrompts,
      };
    }

    case 'dependency': {
      const unmet = p.blockers.length;
      const content = lines(
        header,
        '',
        unmet
          ? `**${unmet} dependency or blocker issue(s) could delay the next milestone:**`
          : 'No unmet dependencies were found in this Journey.',
        p.blockers.map((b) => `- ${b.title}: ${b.reason}`).join('\n'),
        '',
        p.stages
          .filter((s) => s.status === 'upcoming')
          .slice(0, 3)
          .map((s) => `- ${s.name} is ${s.hint.toLowerCase()}`)
          .join('\n'),
      );
      return { content, actions, suggestedPrompts };
    }

    case 'help':
    default: {
      const content = lines(
        header,
        '',
        'I work from this project\'s Journey — its stages, activities, requirements, documents, designs and approvals. I can:',
        '- Summarise progress and outstanding work',
        '- Identify blockers, dependencies and upcoming milestones',
        '- Read the project\'s requirements and documents',
        '- Propose new requirements, activities, documents, risks and milestones for you to confirm',
        '- Assign activities and flag dependencies',
        '',
        `Right now **${p.project.name}** is ${pct(p.project.progress)} complete${
          stage ? `, in ${stage.name}` : ''
        }${p.project.pendingApprovals ? `, with ${p.project.pendingApprovals} approval(s) pending` : ''}.`,
        '',
        intent === 'unknown' && message.length > 3
          ? `I did not find anything specific for "${message.slice(0, 80)}". Try naming a stage, an artifact, or asking for a summary.`
          : '',
      );
      return { content, actions, suggestedPrompts };
    }
  }
}

/**
 * Turns a short subject into a first-draft requirement statement. Deliberately
 * conservative: it never claims a specific value the user has not given.
 */
function requirementStatement(projectName: string, subject: string): string {
  const verbs = /^(provide|support|operate|maintain|achieve|withstand|limit|ensure|allow|prevent|record|report|expose|deliver|integrate|measure|contain|survive|tolerate|display|notify|authenticate|authorise|authorize)\b/i;
  const cleaned = subject.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (verbs.test(cleaned)) {
    return `The ${projectName} shall ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}.`;
  }
  return `The ${projectName} shall satisfy the following need, to be refined into a verifiable statement: ${cleaned}.`;
}

function buildReportBody(context: ProjectContext, title: string) {
  const p = context.journey;
  const active = p.stages.filter((s) => s.status !== 'upcoming');
  const lines_: string[] = [
    `# ${title}`,
    '',
    `**Project:** ${p.project.name} (${p.project.code}) · **Journey:** ${p.journey.name}`,
    `**Progress:** ${pct(p.project.progress)} · **Generated:** ${new Date().toLocaleDateString()}`,
    '',
    '## Current position',
  ];
  for (const s of active) {
    lines_.push(`### ${s.name} — ${s.status} (${s.completedCount}/${s.activityCount})`);
    lines_.push(`Objective: ${s.objective}`);
    const acts = context.requirements.filter((r) => r.stageId === s.id);
    if (acts.length) lines_.push(`Requirements in this stage: ${acts.map((r) => r.ref).join(', ')}`);
    lines_.push('');
  }
  lines_.push('## Outstanding');
  for (const a of p.nextActions) lines_.push(`- ${a.title} — ${a.detail}`);
  lines_.push('', '## Blockers and risks');
  if (p.blockers.length === 0) lines_.push('- None recorded');
  for (const b of p.blockers) lines_.push(`- ${b.title}: ${b.reason}`);
  lines_.push('', '## Milestones');
  for (const m of p.milestones) lines_.push(`- ${m.name} — ${m.status}, target ${dateLabel(m.dueDate)}`);
  return lines_.join('\n');
}

/* ------------------------------------------------------------------ */
/* Optional model provider                                             */
/* ------------------------------------------------------------------ */

/**
 * If SV_ASSISTANT_ENDPOINT is configured we forward the assembled context to an
 * OpenAI-compatible chat endpoint and parse a JSON envelope of {content, actions}.
 * Any provider failure falls back to the grounded engine, so the assistant is never
 * unavailable and never answers without project context.
 */
export const runAssistant: AssistantEngine = async (input) => {
  const endpoint = process.env.SV_ASSISTANT_ENDPOINT;
  const apiKey = process.env.SV_ASSISTANT_API_KEY;
  const grounded = groundedAssistant(input);
  if (!endpoint) return grounded;

  const { context } = input;
  const p = context.journey;
  const system = [
    'You are the Solution Velocity AI Assistant. You only answer about the project supplied.',
    'Be concise, technical and specific. Use the project data; never invent records.',
    "When the user asks for a change, emit proposed actions in the actions array. Allowed actionType values:",
    'create_activity, create_requirement, create_document, create_milestone, create_deliverable, create_risk,',
    'assign_activity, add_dependency, request_approval, link_document_to_stage, complete_activity.',
    'Reply with JSON only: {"content": string, "actions": [{"actionType": string, "summary": string, "payload": object}]}',
    '',
    `PROJECT CONTEXT:\n${JSON.stringify({
      project: p.project,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name, status: s.status, progress: s.progress, objective: s.objective })),
      nextActions: p.nextActions,
      blockers: p.blockers,
      pendingApprovals: p.pendingApprovals,
      milestones: p.milestones,
      members: p.members,
      requirements: context.requirements,
      documents: context.documents,
      artifacts: context.artifacts,
      risks: context.risks,
    }).slice(0, 24000)}`,
  ].join('\n');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: process.env.SV_ASSISTANT_MODEL ?? 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          ...input.history.slice(-8).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
          { role: 'user', content: input.message },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return grounded;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) return grounded;
    const parsed = JSON.parse(raw) as { content?: string; actions?: ProposedAction[] };
    if (!parsed.content) return grounded;
    const allowed = new Set([
      'create_activity',
      'create_requirement',
      'create_document',
      'create_milestone',
      'create_deliverable',
      'create_risk',
      'assign_activity',
      'add_dependency',
      'request_approval',
      'link_document_to_stage',
      'complete_activity',
    ]);
    return {
      content: parsed.content,
      actions: (parsed.actions ?? []).filter((a) => allowed.has(a.actionType)),
      suggestedPrompts: grounded.suggestedPrompts,
    };
  } catch {
    return grounded;
  }
};

export { groundedAssistant };
