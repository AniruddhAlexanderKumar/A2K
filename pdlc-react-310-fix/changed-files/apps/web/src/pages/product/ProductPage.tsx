import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Box, ClipboardList, Edit3, Lightbulb, Map as MapIcon, MessageCircleQuestion, Package, Receipt, Trash2, Wrench } from 'lucide-react';
import { buildJourney, STAGE_IDS, type Product, type StageId } from '@sv/shared';
import { JourneyTab } from '../../components/journey/JourneyTab';
import { StageComplete } from '../../components/journey/StageComplete';
import { useCollaboration } from '../../api/collaboration';
import { useDeleteProduct, useUpdateProduct, useWorkspaceData } from '../../api/hooks';
import { productMetrics, ProductThumb, useMaterialsMap } from '../../components/ProductBits';
import { Button, cx, EmptyState, GradeBadge, IconButton, Spinner, useConfirm } from '../../components/ui';
import { useMoney } from '../../lib/money';
import { CostsTab } from './CostsTab';
import { DiscoverTab } from './DiscoverTab';
import { EditProductModal } from './EditProductModal';
import { ImproveTab } from './ImproveTab';
import { MaterialsTab } from './MaterialsTab';
import { OverviewTab } from './OverviewTab';
import { TasksTab } from './TasksTab';
import { CadTab } from './CadTab';

export const TABS = [
  { id: 'journey', label: 'Journey', icon: MapIcon },
  { id: 'overview', label: 'Overview', icon: Package },
  { id: 'discover', label: 'Tell us', icon: MessageCircleQuestion },
  { id: 'materials', label: 'Materials', icon: Wrench },
  { id: 'costs', label: 'Track it', icon: Receipt },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'improve', label: 'Improve it', icon: Lightbulb },
  { id: 'cad', label: '3D CAD', icon: Box }
] as const;
export type TabId = (typeof TABS)[number]['id'];

/**
 * Route shell for a single product. It owns the loading and not-found states so
 * that `ProductContent` can call its hooks unconditionally: rendering the guards
 * inside the same component that runs the hooks means the first paint (loading)
 * and the next paint (product found) execute a different number of hooks, which
 * React reports as error #310, "Rendered more hooks than during the previous
 * render". Never move a hook below an early return here.
 */
export function ProductPage() {
  const { id = '' } = useParams();
  const { data, isLoading } = useWorkspaceData();
  const product = data?.products.find((p) => p.id === id);

  if (isLoading || !data) return <Spinner />;
  if (!product) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title="Product not found"
          body="It may have been deleted by someone on your team."
          action={
            <Link to="/products" className="text-sm font-medium text-blue-600">
              Back to products
            </Link>
          }
        />
      </div>
    );
  }

  // `key` resets per-product state (open modals, celebration) when the user
  // navigates from one product straight to another.
  return <ProductContent key={product.id} product={product} />;
}

function ProductContent({ product }: { product: Product }) {
  const { id = '', tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const { data } = useWorkspaceData();
  const materials = useMaterialsMap(data?.materials);
  const update = useUpdateProduct(id);
  const remove = useDeleteProduct();
  const confirm = useConfirm();
  const { fmt } = useMoney();
  const [editing, setEditing] = useState(false);
  // Collaboration is fetched separately from the product so the journey still
  // renders (from stageQuest()) if this request is slow or fails.
  const collabQuery = useCollaboration(id);
  const collab = collabQuery.data;

  const activeTab = (TABS.some((t) => t.id === tab) ? tab : 'journey') as TabId;
  const goTab = (t: TabId) => navigate(`/products/${product.id}/${t}`);
  const { summary, health, quest } = productMetrics(product, materials);

  // One journey model drives every surface: the map, the stage overview, the
  // locks and the "continue" action. It reads completion from stageQuest(), the
  // same rule the server enforces, so the UI cannot overstate progress.
  // Prefer the server's journey: it carries ownership, blockers and the
  // approval gate. The locally built one is the fallback while it loads.
  const localJourney = buildJourney(product, {
    materials,
    visitedStages: product.legacyStage ? STAGE_IDS.slice(0, STAGE_IDS.indexOf(product.legacyStage) + 1) : []
  });
  const journey = collab?.journey ?? localJourney;

  // Completion celebration: fire once when the current stage flips to complete.
  const [celebrated, setCelebrated] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState<StageId | null>(null);
  useEffect(() => {
    if (journey.current.complete && celebrated !== journey.current.id) {
      setCelebrated(journey.current.id);
      setCelebrating(journey.current.id);
    }
  }, [journey.current.complete, journey.current.id, celebrated]);

  const advance = (to: StageId) => update.mutate({ stage: to });
  const openHref = (href: string) => navigate(href);
  // The label names the actual next lesson, not a generic "next step".
  const continueLabel = journey.nextActivity?.activity.label ?? 'next step';
  // The world the product currently sits in; the flat stage index is not the journey.
  const worldIndex = STAGE_IDS.indexOf(product.stage) + 1;
  const continueHref = journey.nextActivity
    ? journey.nextActivity.activity.kind === 'question'
      ? `/products/${product.id}/discover?stage=${journey.nextActivity.stage}&q=${encodeURIComponent(journey.nextActivity.activity.id)}`
      : `/products/${product.id}/${journey.nextActivity.activity.tab}`
    : `/products/${product.id}/journey`;

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete “${product.name}”?`,
      body: 'This permanently removes the product, its answers, tasks and bill of materials. Library materials and suppliers are kept.',
      confirmLabel: 'Delete product',
      danger: true
    });
    if (ok) remove.mutate(product.id, { onSuccess: () => navigate('/products') });
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-zinc-200 bg-white px-4 pt-4 md:px-6 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <IconButton label="Back" onClick={() => navigate(-1)} className="mt-2.5">
              <ArrowLeft className="h-4 w-4" />
            </IconButton>
            <ProductThumb name={product.name} imageUrl={product.imageUrl} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight">{product.name}</h1>
                <GradeBadge grade={health.grade} score={health.score} />
              </div>
              <p className="mt-0.5 text-sm text-zinc-500">{product.category}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#16598d]/10 px-2.5 py-1 text-xs font-semibold text-[#16598d] dark:text-blue-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#16598d] dark:bg-blue-400" aria-hidden="true" />
                  World {worldIndex} of 8 · {product.stage}
                </span>
                <span className="text-xs tabular-nums text-zinc-500">
                  {journey.overallPercent}% of the journey · {quest.done}/{quest.total} this stage
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="grid grid-cols-3 gap-4 text-right">
              <div>
                <p className="text-[11px] text-zinc-500">Unit cost</p>
                <p className="font-semibold tabular-nums">{fmt(summary.totalUnitCost)}</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-500">Price</p>
                <p className="font-semibold tabular-nums">{fmt(summary.targetPrice)}</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-500">Margin</p>
                <p
                  className={cx(
                    'font-semibold tabular-nums',
                    summary.grossMargin === null ? '' : summary.grossMargin >= 30 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                  )}
                >
                  {summary.grossMargin === null ? '—' : `${summary.grossMargin}%`}
                </p>
              </div>
            </div>
            <div className="flex gap-1">
              <IconButton label="Edit product" onClick={() => setEditing(true)}>
                <Edit3 className="h-4 w-4" />
              </IconButton>
              <IconButton label="Delete product" onClick={onDelete} className="hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => navigate(continueHref)}
            icon={<MapIcon className="h-3.5 w-3.5" />}
          >
            {journey.isComplete ? 'Review your journey' : `Continue journey · ${continueLabel}`}
          </Button>
          {journey.nextActivity && (
            <span className="text-xs text-zinc-500">Next: {journey.nextActivity.stage}</span>
          )}
        </div>
        <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto" aria-label="Product sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => goTab(t.id)}
              aria-current={activeTab === t.id ? 'page' : undefined}
              className={cx(
                'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                activeTab === t.id
                  ? 'border-blue-600 text-zinc-900 dark:border-blue-400 dark:text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 px-4 py-5 md:px-6">
        {activeTab === 'journey' && <JourneyTab product={product} />}
        {activeTab === 'overview' && <OverviewTab product={product} materials={materials} goTab={goTab} openHref={openHref} />}
        {activeTab === 'discover' && <DiscoverTab product={product} />}
        {activeTab === 'materials' && <MaterialsTab product={product} materials={materials} />}
        {activeTab === 'costs' && <CostsTab product={product} materials={materials} />}
        {activeTab === 'tasks' && <TasksTab product={product} />}
        {activeTab === 'improve' && <ImproveTab product={product} goTab={goTab} />}
        {activeTab === 'cad' && <CadTab product={product} />}
      </div>

      {editing && <EditProductModal product={product} onClose={() => setEditing(false)} />}
      {celebrating && (
        <StageComplete
          stage={celebrating}
          nextStageId={celebrating === product.stage ? journey.nextStageId : null}
          onContinue={() => {
            const target = journey.nextStageId;
            setCelebrating(null);
            if (target) advance(target);
          }}
          onDismiss={() => setCelebrating(null)}
        />
      )}
    </div>
  );
}
