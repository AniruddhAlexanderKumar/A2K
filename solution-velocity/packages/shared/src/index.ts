/**
 * Shared domain model for Solution Velocity.
 *
 * The platform is organised around three primary destinations:
 *   Journey  — where all project work lives (stages → activities → deliverables)
 *   AI Assistant — project-scoped reasoning and confirmed actions
 *   Design Studio — the creation workspace for project design artifacts
 *
 * Everything is owned by a project. A project has exactly one journey.
 */

export const APP_NAME = 'Solution Velocity';
export const APP_TAGLINE = 'One connected product development environment';

export type PrimaryDestination = 'journey' | 'assistant' | 'studio';

export const PRIMARY_NAV: { key: PrimaryDestination; label: string; path: string }[] = [
  { key: 'journey', label: 'Journey', path: '/journey' },
  { key: 'assistant', label: 'AI Assistant', path: '/assistant' },
  { key: 'studio', label: 'Design Studio', path: '/studio' },
];

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PROJECT_ROLES = ['lead', 'contributor', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const STAGE_STATUSES = ['upcoming', 'active', 'completed', 'blocked'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const ACTIVITY_STATUSES = ['not_started', 'in_progress', 'blocked', 'in_review', 'completed'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DELIVERABLE_KINDS = ['specification', 'design', 'document', 'report', 'test_plan', 'prototype'] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const DELIVERABLE_STATUSES = ['draft', 'in_review', 'approved', 'superseded'] as const;

export const REQUIREMENT_TYPES = ['functional', 'non_functional', 'constraint', 'interface', 'safety'] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_STATUSES = ['draft', 'proposed', 'approved', 'rejected', 'implemented', 'verified'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const REVIEW_KINDS = ['review', 'approval'] as const;
export const REVIEW_STATUSES = ['pending', 'approved', 'changes_requested', 'cancelled'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const RISK_STATUSES = ['open', 'mitigating', 'accepted', 'closed'] as const;

export const DESIGN_ARTIFACT_TYPES = ['wireframe', 'diagram', 'specification_board', 'system_sketch'] as const;
export type DesignArtifactType = (typeof DESIGN_ARTIFACT_TYPES)[number];

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;

/* ------------------------------------------------------------------ */
/* Lifecycle templates                                                 */
/* ------------------------------------------------------------------ */

export type TemplateActivitySeed = {
  title: string;
  description: string;
  priority: Priority;
  /** Kind of evidence normally produced for this activity. */
  deliverable?: { title: string; kind: DeliverableKind };
};

export type TemplateStageSeed = {
  key: string;
  name: string;
  description: string;
  objective: string;
  milestone: string;
  activities: TemplateActivitySeed[];
};

export type JourneyTemplate = {
  key: string;
  name: string;
  summary: string;
  bestFor: string;
  stages: TemplateStageSeed[];
};

export const JOURNEY_TEMPLATES: JourneyTemplate[] = [
  {
    key: 'hardware_product',
    name: 'Physical Product Development',
    summary: 'Stage-gated hardware development with design reviews and verification.',
    bestFor: 'Hardware, robotics, aerospace, mechanical and electromechanical products.',
    stages: [
      {
        key: 'discovery',
        name: 'Discovery & Feasibility',
        description: 'Establish the problem, constraints and whether the concept is worth building.',
        objective: 'A validated problem statement and feasibility position.',
        milestone: 'Feasibility review passed',
        activities: [
          {
            title: 'Capture customer and mission requirements',
            description: 'Interview stakeholders and translate needs into candidate requirements.',
            priority: 'high',
            deliverable: { title: 'Voice of customer summary', kind: 'document' },
          },
          {
            title: 'Assess technical feasibility',
            description: 'Identify the critical unknowns and prove or disprove them with analysis.',
            priority: 'high',
            deliverable: { title: 'Feasibility assessment', kind: 'report' },
          },
          {
            title: 'Draft system-level concept',
            description: 'Sketch two or three viable architectures with trade-offs.',
            priority: 'medium',
            deliverable: { title: 'Concept trade study', kind: 'design' },
          },
        ],
      },
      {
        key: 'concept',
        name: 'Concept Design',
        description: 'Down-select an architecture and set the system baseline.',
        objective: 'A selected concept with allocated requirements.',
        milestone: 'Concept baseline locked',
        activities: [
          {
            title: 'Run architecture trade study',
            description: 'Score options against weighted criteria and record the decision.',
            priority: 'high',
            deliverable: { title: 'Architecture decision record', kind: 'document' },
          },
          {
            title: 'Allocate requirements to subsystems',
            description: 'Break the system requirement down into subsystem budgets.',
            priority: 'high',
            deliverable: { title: 'Requirement allocation matrix', kind: 'specification' },
          },
          {
            title: 'Define preliminary interfaces',
            description: 'Document mechanical, electrical and data interfaces between subsystems.',
            priority: 'medium',
            deliverable: { title: 'Interface control document (draft)', kind: 'specification' },
          },
        ],
      },
      {
        key: 'preliminary_design',
        name: 'Preliminary Design',
        description: 'Prove the design closes at the system level before detailed release.',
        objective: 'A design that passes Preliminary Design Review.',
        milestone: 'PDR complete',
        activities: [
          {
            title: 'Produce preliminary layouts and models',
            description: 'Create the geometry and assemblies needed to demonstrate closure.',
            priority: 'high',
            deliverable: { title: 'Preliminary design package', kind: 'design' },
          },
          {
            title: 'Preliminary analysis (structural, thermal, power)',
            description: 'Show margins against the allocated budgets.',
            priority: 'high',
            deliverable: { title: 'Preliminary analysis report', kind: 'report' },
          },
          {
            title: 'Prepare and run PDR',
            description: 'Assemble the review package, run the review and record actions.',
            priority: 'high',
            deliverable: { title: 'PDR action register', kind: 'document' },
          },
        ],
      },
      {
        key: 'detailed_design',
        name: 'Detailed Design',
        description: 'Release manufacturing-ready definition and close verification planning.',
        objective: 'Released design definition with a verification plan.',
        milestone: 'CDR complete',
        activities: [
          {
            title: 'Release detailed drawings and CAD',
            description: 'Finalise tolerances, materials and manufacturing notes.',
            priority: 'high',
            deliverable: { title: 'Released drawing set', kind: 'design' },
          },
          {
            title: 'Complete detailed analysis and FMEA',
            description: 'Close failure modes and confirm margins at the detailed level.',
            priority: 'high',
            deliverable: { title: 'FMEA and detailed analysis', kind: 'report' },
          },
          {
            title: 'Write verification and test plan',
            description: 'Map every requirement to a verification method.',
            priority: 'high',
            deliverable: { title: 'Verification matrix', kind: 'test_plan' },
          },
        ],
      },
      {
        key: 'build_verify',
        name: 'Build & Verification',
        description: 'Build the unit, run the test campaign and resolve non-conformances.',
        objective: 'Evidence that the product meets its requirements.',
        milestone: 'Verification campaign complete',
        activities: [
          {
            title: 'Build prototype or first article',
            description: 'Fabricate and assemble, recording deviations from the definition.',
            priority: 'high',
            deliverable: { title: 'Build log and as-built record', kind: 'document' },
          },
          {
            title: 'Execute verification tests',
            description: 'Run the test plan and capture results against requirements.',
            priority: 'high',
            deliverable: { title: 'Test results report', kind: 'report' },
          },
          {
            title: 'Close non-conformances',
            description: 'Disposition failures and update the design where required.',
            priority: 'high',
          },
        ],
      },
      {
        key: 'production_readiness',
        name: 'Production Readiness',
        description: 'Prepare manufacturing, supply and support for release.',
        objective: 'A production-ready product with a support plan.',
        milestone: 'Production readiness review passed',
        activities: [
          {
            title: 'Qualify suppliers and processes',
            description: 'Confirm capability, lead times and quality controls.',
            priority: 'medium',
            deliverable: { title: 'Supplier qualification record', kind: 'document' },
          },
          {
            title: 'Publish manufacturing and quality plan',
            description: 'Define the process flow, inspection points and acceptance criteria.',
            priority: 'high',
            deliverable: { title: 'Manufacturing plan', kind: 'document' },
          },
        ],
      },
      {
        key: 'launch',
        name: 'Launch & Learn',
        description: 'Release, measure real-world performance and feed learning back in.',
        objective: 'A launched product with tracked performance.',
        milestone: 'Launch retrospective complete',
        activities: [
          {
            title: 'Run launch readiness check',
            description: 'Confirm documentation, support and logistics are in place.',
            priority: 'high',
            deliverable: { title: 'Launch checklist', kind: 'document' },
          },
          {
            title: 'Capture post-launch learnings',
            description: 'Review field data and record improvement candidates.',
            priority: 'medium',
            deliverable: { title: 'Launch retrospective', kind: 'report' },
          },
        ],
      },
    ],
  },
  {
    key: 'software_product',
    name: 'Software Product Development',
    summary: 'Discovery to launch with an explicit architecture checkpoint.',
    bestFor: 'SaaS, web and mobile products, internal platforms and developer tools.',
    stages: [
      {
        key: 'discovery',
        name: 'Discovery',
        description: 'Understand the users, the problem and the constraints.',
        objective: 'A validated problem and a first requirement set.',
        milestone: 'Problem framed',
        activities: [
          {
            title: 'Map users and core jobs',
            description: 'Identify who the product serves and the work they need to finish.',
            priority: 'high',
            deliverable: { title: 'User and jobs map', kind: 'document' },
          },
          {
            title: 'Draft the first requirements',
            description: 'Capture the must-have behaviour as testable requirements.',
            priority: 'high',
            deliverable: { title: 'Initial requirement set', kind: 'specification' },
          },
        ],
      },
      {
        key: 'architecture',
        name: 'Planning & Architecture',
        description: 'Set the technical shape and the delivery plan.',
        objective: 'An agreed architecture and plan.',
        milestone: 'Architecture agreed',
        activities: [
          {
            title: 'Define system architecture',
            description: 'Choose the major components, data stores and boundaries.',
            priority: 'high',
            deliverable: { title: 'Architecture overview', kind: 'design' },
          },
          {
            title: 'Plan the first release',
            description: 'Scope the smallest release that delivers real value.',
            priority: 'high',
            deliverable: { title: 'Release scope', kind: 'document' },
          },
        ],
      },
      {
        key: 'build',
        name: 'Build',
        description: 'Implement, integrate and keep the requirement set current.',
        objective: 'A working product increment.',
        milestone: 'MVP feature complete',
        activities: [
          {
            title: 'Implement core flows',
            description: 'Build the primary user journeys end to end.',
            priority: 'high',
            deliverable: { title: 'Working increment', kind: 'prototype' },
          },
          {
            title: 'Set up automated tests and CI',
            description: 'Protect the increment with repeatable checks.',
            priority: 'medium',
            deliverable: { title: 'Test and CI setup', kind: 'document' },
          },
        ],
      },
      {
        key: 'validation',
        name: 'Validation & QA',
        description: 'Prove quality and that the requirements are met.',
        objective: 'Verified behaviour against the requirement set.',
        milestone: 'Release candidate verified',
        activities: [
          {
            title: 'Run acceptance testing',
            description: 'Verify each in-scope requirement against real behaviour.',
            priority: 'high',
            deliverable: { title: 'Acceptance test results', kind: 'report' },
          },
          {
            title: 'Security and performance pass',
            description: 'Check the release against the non-functional requirements.',
            priority: 'high',
            deliverable: { title: 'Security and performance review', kind: 'report' },
          },
        ],
      },
      {
        key: 'launch',
        name: 'Launch',
        description: 'Ship it, observe it and support it.',
        objective: 'A live product with telemetry and support.',
        milestone: 'Release live',
        activities: [
          {
            title: 'Prepare rollout plan',
            description: 'Define the release, rollback and communication plan.',
            priority: 'high',
            deliverable: { title: 'Rollout plan', kind: 'document' },
          },
          {
            title: 'Instrument and monitor',
            description: 'Add the telemetry needed to see real behaviour after launch.',
            priority: 'medium',
            deliverable: { title: 'Monitoring coverage', kind: 'document' },
          },
        ],
      },
      {
        key: 'iterate',
        name: 'Iterate',
        description: 'Turn usage evidence into the next round of work.',
        objective: 'A prioritised backlog grounded in evidence.',
        milestone: 'First iteration planned',
        activities: [
          {
            title: 'Review usage evidence',
            description: 'Analyse telemetry and feedback against the original intent.',
            priority: 'medium',
            deliverable: { title: 'Usage review', kind: 'report' },
          },
        ],
      },
    ],
  },
  {
    key: 'research_program',
    name: 'Research Programme',
    summary: 'A rigorous path from question to reviewed publication.',
    bestFor: 'Research, advanced development, simulations and experimental programmes.',
    stages: [
      {
        key: 'scope',
        name: 'Question & Scope',
        description: 'Define the question, the contribution and the boundaries.',
        objective: 'A sharply defined research question.',
        milestone: 'Scope agreed',
        activities: [
          {
            title: 'Formulate the research question',
            description: 'State what will be learned, and what would count as an answer.',
            priority: 'high',
            deliverable: { title: 'Research question brief', kind: 'document' },
          },
          {
            title: 'Define success criteria and method constraints',
            description: 'Set what evidence is required for a credible result.',
            priority: 'high',
          },
        ],
      },
      {
        key: 'prior_art',
        name: 'Literature & Prior Art',
        description: 'Establish what is already known and where the gap sits.',
        objective: 'A defensible account of the state of the art.',
        milestone: 'Prior art reviewed',
        activities: [
          {
            title: 'Review literature and prior art',
            description: 'Structure the existing work and identify the gap.',
            priority: 'high',
            deliverable: { title: 'Literature review', kind: 'report' },
          },
        ],
      },
      {
        key: 'method',
        name: 'Method Design',
        description: 'Design a method that can actually answer the question.',
        objective: 'An agreed experimental method.',
        milestone: 'Method approved',
        activities: [
          {
            title: 'Design the experimental or analytical method',
            description: 'Specify apparatus, models, controls and error budget.',
            priority: 'high',
            deliverable: { title: 'Method specification', kind: 'specification' },
          },
          {
            title: 'Review safety and ethics',
            description: 'Clear the method before any work begins.',
            priority: 'high',
            deliverable: { title: 'Safety and ethics review', kind: 'document' },
          },
        ],
      },
      {
        key: 'execution',
        name: 'Experimentation',
        description: 'Run the campaign and record evidence as it is produced.',
        objective: 'A complete and traceable dataset.',
        milestone: 'Campaign complete',
        activities: [
          {
            title: 'Run the experimental campaign',
            description: 'Execute the method and capture raw results.',
            priority: 'high',
            deliverable: { title: 'Raw dataset', kind: 'report' },
          },
          {
            title: 'Document deviations and anomalies',
            description: 'Record everything that did not follow the plan.',
            priority: 'medium',
          },
        ],
      },
      {
        key: 'analysis',
        name: 'Analysis',
        description: 'Turn evidence into claims and test their strength.',
        objective: 'Defensible findings with uncertainty stated.',
        milestone: 'Findings validated',
        activities: [
          {
            title: 'Analyse results',
            description: 'Apply the analysis plan and quantify uncertainty.',
            priority: 'high',
            deliverable: { title: 'Analysis report', kind: 'report' },
          },
          {
            title: 'Internal review of findings',
            description: 'Have a second reader test the claims.',
            priority: 'high',
          },
        ],
      },
      {
        key: 'publication',
        name: 'Publication & Review',
        description: 'Package and submit the work for external scrutiny.',
        objective: 'A submitted, reviewed output.',
        milestone: 'Submitted for review',
        activities: [
          {
            title: 'Write and submit the paper',
            description: 'Produce the manuscript and submission package.',
            priority: 'high',
            deliverable: { title: 'Manuscript', kind: 'document' },
          },
          {
            title: 'Respond to reviewer comments',
            description: 'Address or rebut each point with evidence.',
            priority: 'high',
          },
        ],
      },
      {
        key: 'dissemination',
        name: 'Dissemination',
        description: 'Put the result where it can be used.',
        objective: 'Findings shared and artefacts archived.',
        milestone: 'Findings released',
        activities: [
          {
            title: 'Archive data and artefacts',
            description: 'Make the underlying evidence reproducible.',
            priority: 'medium',
          },
        ],
      },
    ],
  },
  {
    key: 'generic',
    name: 'Flexible Product Journey',
    summary: 'A light, adaptable lifecycle you can reshape as the work becomes clear.',
    bestFor: 'Anything that does not fit a hardware, software or research path.',
    stages: [
      {
        key: 'discover',
        name: 'Discover',
        description: 'Understand the problem and the constraints.',
        objective: 'A clear problem statement.',
        milestone: 'Problem understood',
        activities: [
          {
            title: 'Define the problem and success criteria',
            description: 'Write down what success looks like before building.',
            priority: 'high',
            deliverable: { title: 'Problem brief', kind: 'document' },
          },
        ],
      },
      {
        key: 'plan',
        name: 'Plan',
        description: 'Shape the approach, scope and requirements.',
        objective: 'An agreed scope and requirement set.',
        milestone: 'Plan agreed',
        activities: [
          {
            title: 'Agree scope and requirements',
            description: 'Decide what is in, what is out, and why.',
            priority: 'high',
            deliverable: { title: 'Scope and requirements', kind: 'specification' },
          },
        ],
      },
      {
        key: 'design',
        name: 'Design',
        description: 'Create and review the product definition.',
        objective: 'A reviewed design.',
        milestone: 'Design reviewed',
        activities: [
          {
            title: 'Produce the design',
            description: 'Create the artefacts needed to build the product.',
            priority: 'high',
            deliverable: { title: 'Design package', kind: 'design' },
          },
        ],
      },
      {
        key: 'build',
        name: 'Build',
        description: 'Do the work and manage the deliverables.',
        objective: 'A built product.',
        milestone: 'Build complete',
        activities: [
          {
            title: 'Execute the build',
            description: 'Carry out the plan, tracking progress and blockers.',
            priority: 'high',
          },
        ],
      },
      {
        key: 'validate',
        name: 'Validate',
        description: 'Check the result against the requirements.',
        objective: 'Verified result.',
        milestone: 'Validation complete',
        activities: [
          {
            title: 'Validate against requirements',
            description: 'Test and record the outcome for each requirement.',
            priority: 'high',
            deliverable: { title: 'Validation report', kind: 'report' },
          },
        ],
      },
      {
        key: 'launch',
        name: 'Launch',
        description: 'Release and capture learning.',
        objective: 'A released product with learning captured.',
        milestone: 'Launched',
        activities: [
          {
            title: 'Release and review',
            description: 'Ship the product and hold a short retrospective.',
            priority: 'medium',
          },
        ],
      },
    ],
  },
];

export function getTemplate(key: string): JourneyTemplate {
  return JOURNEY_TEMPLATES.find((t) => t.key === key) ?? JOURNEY_TEMPLATES[JOURNEY_TEMPLATES.length - 1];
}

export const PROJECT_TYPES: { key: string; label: string; template: string }[] = [
  { key: 'hardware', label: 'Physical product / hardware', template: 'hardware_product' },
  { key: 'software', label: 'Software product', template: 'software_product' },
  { key: 'research', label: 'Research programme', template: 'research_program' },
  { key: 'other', label: 'Something else', template: 'generic' },
];

/* ------------------------------------------------------------------ */
/* Labels + presentation helpers                                       */
/* ------------------------------------------------------------------ */

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  completed: 'Completed',
};

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
  blocked: 'Blocked',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  proposed: 'Proposed',
  approved: 'Approved',
  rejected: 'Rejected',
  implemented: 'Implemented',
  verified: 'Verified',
  in_review: 'In review',
  pending: 'Pending',
  changes_requested: 'Changes requested',
  cancelled: 'Cancelled',
  open: 'Open',
  mitigating: 'Mitigating',
  accepted: 'Accepted',
  closed: 'Closed',
  superseded: 'Superseded',
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
  in_progress: 'In progress',
  not_started: 'Not started',
  blocked: 'Blocked',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
  lead: 'Lead',
  contributor: 'Contributor',
  viewer: 'Viewer',
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  return STATUS_LABEL[value] ?? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Progress model                                                      */
/* ------------------------------------------------------------------ */

export type ActivityWeightInput = {
  status: ActivityStatus;
  priority: Priority;
  hasDeliverable: boolean;
  hasApproval: boolean;
};

const PRIORITY_WEIGHT: Record<Priority, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Weight of a single activity: importance scaled by the evidence it must produce,
 * plus the extra ceremony of an approval gate.
 */
export function activityWeight(a: ActivityWeightInput): number {
  return PRIORITY_WEIGHT[a.priority] * (a.hasDeliverable ? 1.5 : 1) + (a.hasApproval ? 1 : 0);
}

export function activityCompletion(a: { status: ActivityStatus }): number {
  switch (a.status) {
    case 'completed':
      return 1;
    case 'in_review':
      return 0.75;
    case 'in_progress':
      return 0.45;
    case 'blocked':
      return 0.2;
    default:
      return 0;
  }
}

export type ProgressActivity = { status: ActivityStatus; priority: Priority; weight?: number };

/** Weighted completion of a set of activities, 0..1. */
export function progressFromActivities(activities: ProgressActivity[]): number {
  if (activities.length === 0) return 0;
  let total = 0;
  let done = 0;
  for (const a of activities) {
    const w = a.weight ?? PRIORITY_WEIGHT[a.priority];
    total += w;
    done += w * activityCompletion(a);
  }
  return total === 0 ? 0 : done / total;
}

/** Derived stage state used for the visual path. */
export function deriveStageStatus(input: {
  activities: ProgressActivity[];
  blocked: boolean;
  approvalPending: boolean;
  isFirstIncomplete: boolean;
  /** A gate (unmet milestone dependency) is holding this stage back. */
  gated?: boolean;
}): StageStatus {
  if (input.activities.length > 0 && input.activities.every((a) => a.status === 'completed')) {
    return input.approvalPending ? 'active' : 'completed';
  }
  if (input.blocked) return 'blocked';
  if (input.isFirstIncomplete) return 'active';
  if (input.gated) return 'upcoming';
  if (input.activities.some((a) => a.status !== 'not_started')) return 'active';
  return 'upcoming';
}

/* ------------------------------------------------------------------ */
/* API contract types (mirrored by the API)                            */
/* ------------------------------------------------------------------ */

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: OrgRole;
  organizationId: number;
  organizationName: string;
  avatarColor: string;
};

export type ProjectSummary = {
  id: number;
  name: string;
  code: string;
  description: string;
  projectType: string;
  status: string;
  templateKey: string;
  templateName: string;
  ownerId: number;
  ownerName: string;
  memberCount: number;
  myRole: ProjectRole;
  progress: number;
  currentStageName: string | null;
  currentStageId: number | null;
  openBlockers: number;
  pendingApprovals: number;
  updatedAt: string;
  createdAt: string;
};

export type StageView = {
  id: number;
  key: string;
  name: string;
  description: string;
  objective: string;
  position: number;
  status: StageStatus;
  progress: number;
  activityCount: number;
  completedCount: number;
  blockedCount: number;
  pendingApprovals: number;
  milestone: JourneyMilestone | null;
  /** Compact path explanation shown on the journey path. */
  hint: string;
};

export type JourneyMilestone = {
  id: number;
  name: string;
  description: string;
  dueDate: string | null;
  status: string;
  stageId: number | null;
  completedAt: string | null;
};

export type JourneyActivity = {
  id: number;
  projectId: number;
  stageId: number;
  milestoneId: number | null;
  title: string;
  description: string;
  status: ActivityStatus;
  priority: Priority;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  deliverableCount: number;
  openDeliverableCount: number;
  requirementCount: number;
  documentCount: number;
  designArtifactCount: number;
  reviewCount: number;
  pendingReviewCount: number;
  blockedReason: string | null;
  dependencyCount: number;
  unmetDependencyCount: number;
  createdAt: string;
};

export type JourneyPayload = {
  project: ProjectSummary;
  journey: { id: number; name: string; templateKey: string; createdAt: string };
  stages: StageView[];
  milestones: JourneyMilestone[];
  members: ProjectMember[];
  nextActions: NextAction[];
  blockers: Blocker[];
  pendingApprovals: PendingApproval[];
  stats: {
    activities: number;
    completed: number;
    inProgress: number;
    blocked: number;
    overdue: number;
    requirements: number;
    documents: number;
    artifacts: number;
    deliverables: number;
    openRisks: number;
    decisions: number;
  };
};

export type NextAction = {
  kind: 'activity' | 'approval' | 'deliverable' | 'blocked' | 'milestone';
  id: number;
  title: string;
  detail: string;
  stageId: number | null;
  stageName: string | null;
  href: string;
};

export type Blocker = {
  id: number;
  title: string;
  reason: string;
  stageName: string;
  owner: string | null;
  entity: 'activity' | 'risk';
};

export type PendingApproval = {
  id: number;
  title: string;
  kind: string;
  stageName: string;
  requestedBy: string;
  reviewer: string | null;
  createdAt: string;
};

export type ProjectMember = {
  userId: number;
  name: string;
  email: string;
  role: ProjectRole;
  avatarColor: string;
};

export type ActivityDetail = {
  activity: JourneyActivity;
  stage: { id: number; name: string };
  deliverables: Deliverable[];
  requirements: Requirement[];
  documents: DocumentRecord[];
  artifacts: DesignArtifactSummary[];
  reviews: Review[];
  decisions: Decision[];
  dependencies: DependencyEdge[];
  dependents: DependencyEdge[];
  history: HistoryEntry[];
};

export type Deliverable = {
  id: number;
  projectId: number;
  stageId: number;
  activityId: number | null;
  title: string;
  kind: string;
  status: string;
  ownerId: number | null;
  ownerName: string | null;
  dueDate: string | null;
  documentId: number | null;
  artifactId: number | null;
  createdAt: string;
};

export type Requirement = {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  ref: string;
  title: string;
  statement: string;
  type: string;
  priority: Priority;
  status: string;
  ownerId: number | null;
  ownerName: string | null;
  verificationMethod: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentRecord = {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  title: string;
  kind: string;
  content: string;
  version: number;
  ownerId: number | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DesignArtifactSummary = {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  name: string;
  type: string;
  description: string;
  version: number;
  ownerId: number | null;
  ownerName: string | null;
  scene: DesignScene;
  stageName: string | null;
  activityTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DesignShape = {
  id: string;
  kind: 'rect' | 'ellipse' | 'note' | 'arrow';
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
};

export type DesignScene = {
  width: number;
  height: number;
  shapes: DesignShape[];
};

export type Review = {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  deliverableId: number | null;
  title: string;
  kind: string;
  status: ReviewStatus;
  requestedById: number | null;
  requestedByName: string | null;
  reviewerId: number | null;
  reviewerName: string | null;
  note: string;
  decisionNote: string;
  createdAt: string;
  decidedAt: string | null;
};

export type Decision = {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  title: string;
  rationale: string;
  status: string;
  decidedById: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type DependencyEdge = {
  id: number;
  projectId: number;
  fromType: string;
  fromId: number;
  fromTitle: string;
  fromStatus: string;
  toType: string;
  toId: number;
  toTitle: string;
  toStatus: string;
  note: string;
  satisfied: boolean;
};

export type HistoryEntry = {
  id: number;
  actorName: string;
  verb: string;
  summary: string;
  entityType: string;
  entityId: number | null;
  createdAt: string;
};

export type Risk = {
  id: number;
  projectId: number;
  stageId: number | null;
  activityId: number | null;
  title: string;
  description: string;
  severity: Priority;
  likelihood: string;
  status: string;
  mitigation: string;
  ownerId: number | null;
  ownerName: string | null;
  createdAt: string;
};

export type AssistantMessage = {
  id: number;
  threadId: number;
  role: 'user' | 'assistant';
  content: string;
  actions: AssistantAction[];
  createdAt: string;
};

export type AssistantAction = {
  id: number;
  threadId: number;
  messageId?: number | null;
  projectId: number;
  actionType: AssistantActionType;
  payload: Record<string, unknown>;
  status: 'proposed' | 'applied' | 'dismissed' | 'failed';
  summary: string;
  result: Record<string, unknown> | null;
  createdAt: string;
};

export const ASSISTANT_ACTION_TYPES = [
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
] as const;

export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number];

export type AssistantThread = {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantReply = {
  threadId: number;
  message: AssistantMessage;
  suggestedPrompts: string[];
};

/** Where a piece of work sits in the three-destination model. */
export const WORK_LOCATIONS = {
  journey: 'Journey',
  assistant: 'AI Assistant',
  studio: 'Design Studio',
} as const;
