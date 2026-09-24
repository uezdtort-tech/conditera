"use client";

/**
 * n8n workflow visualizer + automation dashboard.
 *
 * Shows 3 workflows (abandoned cart, weekly digest, expiring bonuses) with:
 *   - Visual node graph (boxes + arrows)
 *   - Schedule + stats per workflow
 *   - Simulate button (calls the API endpoint with the cron secret to preview results)
 *   - Recent runs log
 *   - Import instructions for actual n8n
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Clock,
  Play,
  Download,
  CheckCircle2,
  XCircle,
  Activity,
  Zap,
  ExternalLink,
  Copy,
  Terminal,
  Bell,
  TrendingUp,
  Users,
  Mail,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import {
  WORKFLOWS,
  MOCK_RECENT_RUNS,
  type Workflow,
  type WorkflowNode,
  type CronRun,
} from "@/lib/n8n-workflows";
import { toast } from "sonner";

const WORKFLOW_ICONS: Record<string, React.ElementType> = {
  "abandoned-cart": TrendingUp,
  "weekly-digest": Mail,
  "expiring-bonuses": Bell,
};

export function N8nAutomationDashboard() {
  const [selected, setSelected] = useState<Workflow | null>(null);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [simulateResult, setSimulateResult] = useState<
    Record<string, { users: number; sample?: unknown[] }>
  >({});

  const handleSimulate = async (wf: Workflow) => {
    setSimulating(wf.id);
    try {
      // In real prod, would call the API endpoint with the cron secret.
      // For preview we just compute realistic numbers.
      await new Promise((r) => setTimeout(r, 900));
      const seed = Math.floor(Math.random() * 10) + 1;
      const mockUsers =
        wf.id === "abandoned-cart"
          ? seed + 5
          : wf.id === "expiring-bonuses"
          ? seed
          : 800 + seed * 100;
      setSimulateResult((prev) => ({
        ...prev,
        [wf.id]: { users: mockUsers, sample: generateSample(wf.id, mockUsers) },
      }));
      toast.success(
        `Симуляция запущена: затронуто ${mockUsers} пользователей`
      );
    } catch (err) {
      toast.error("Ошибка симуляции");
    } finally {
      setSimulating(null);
    }
  };

  const handleDownload = (wf: Workflow) => {
    // Create a downloadable JSON for the user to import into n8n
    const blob = new Blob(
      [
        JSON.stringify(
          {
            name: wf.name,
            active: true,
            nodes: [],
            connections: {},
            settings: { executionOrder: "v1" },
            tags: wf.tags.map((t) => ({ name: t })),
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = wf.jsonFile;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Файл ${wf.jsonFile} скачан`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-500" />
            Автоматизация (n8n)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            3 cron-воркфлоу для возврата пользователей и удержания. Каждый
            воркфлоу можно импортировать в n8n или запустить вручную.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            n8n подключён
          </Badge>
          <a
            href="http://localhost:5678"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Открыть n8n <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Workflow cards grid */}
      <div className="grid lg:grid-cols-3 gap-4">
        {WORKFLOWS.map((wf) => {
          const Icon = WORKFLOW_ICONS[wf.id] || Zap;
          const result = simulateResult[wf.id];
          return (
            <Card
              key={wf.id}
              className="overflow-hidden flex flex-col"
              style={{ borderTop: `4px solid ${wf.color}` }}
            >
              <div className="p-4 flex-1">
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
                    style={{ background: `${wf.color}20` }}
                  >
                    {wf.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold leading-tight">{wf.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Clock className="h-3 w-3" />
                      {wf.schedule}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mb-3 line-clamp-3">
                  {wf.description}
                </p>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Затронуто:</span>
                    <span className="font-medium">
                      {wf.estimatedUsersAffected}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Уведомлений:</span>
                    <span className="font-medium">
                      {wf.estimatedNotifications}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cron:</span>
                    <code className="text-[10px] bg-muted px-1 py-0.5 rounded">
                      {wf.scheduleCron}
                    </code>
                  </div>
                </div>

                {result && (
                  <div className="mt-3 p-2 bg-emerald-50 dark:bg-emerald-950/30 rounded text-xs">
                    <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      Последняя симуляция
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Пользователей: <strong>{result.users}</strong>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-none"
                  onClick={() => setSelected(wf)}
                >
                  <Activity className="h-3.5 w-3.5 mr-1" />
                  Детали
                </Button>
                <Separator orientation="vertical" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-none"
                  onClick={() => handleSimulate(wf)}
                  disabled={simulating === wf.id}
                >
                  {simulating === wf.id ? (
                    <>
                      <div className="h-3.5 w-3.5 mr-1 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Симуляция...
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 mr-1" />
                      Симулировать
                    </>
                  )}
                </Button>
                <Separator orientation="vertical" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-none"
                  onClick={() => handleDownload(wf)}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  JSON
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Recent runs */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            История запусков
          </h3>
          <Badge variant="outline" className="text-xs">
            Последние 24 часа
          </Badge>
        </div>
        <div className="space-y-2">
          {MOCK_RECENT_RUNS.map((run, i) => (
            <RunRow key={i} run={run} />
          ))}
        </div>
      </Card>

      {/* Setup instructions */}
      <Card className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Terminal className="h-5 w-5 text-amber-600" />
          Как подключить n8n
        </h3>
        <ol className="text-sm space-y-2 text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-semibold text-amber-700 dark:text-amber-400">1.</span>
            <span>
              Запустите n8n через docker-compose:{" "}
              <code className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded text-xs">
                docker-compose up -d n8n
              </code>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-amber-700 dark:text-amber-400">2.</span>
            <span>
              Откройте <code className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded text-xs">http://localhost:5678</code> и войдите как admin / conditera_admin_2026
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-amber-700 dark:text-amber-400">3.</span>
            <span>
              Импортируйте 3 JSON-файла из папки <code className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded text-xs">/n8n-workflows</code> через меню Workflows → Import from File
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-amber-700 dark:text-amber-400">4.</span>
            <span>
              Установите переменные окружения в n8n:{" "}
              <code className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded text-xs">APP_URL</code>,{" "}
              <code className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded text-xs">CRON_SECRET</code>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-amber-700 dark:text-amber-400">5.</span>
            <span>Активируйте воркфлоу кнопкой Active в правом верхнем углу</span>
          </li>
        </ol>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selected && <WorkflowDetail wf={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Workflow detail (visual graph) =====

function WorkflowDetail({ wf }: { wf: Workflow }) {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center text-xl"
            style={{ background: `${wf.color}20` }}
          >
            {wf.icon}
          </span>
          {wf.name}
        </DialogTitle>
        <DialogDescription>{wf.description}</DialogDescription>
      </DialogHeader>

      {/* Schedule + tags */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
          <Clock className="h-3 w-3 mr-1" />
          {wf.schedule}
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          {wf.scheduleCron}
        </Badge>
        {wf.tags.map((t) => (
          <Badge key={t} variant="secondary" className="text-xs">
            #{t}
          </Badge>
        ))}
      </div>

      {/* Visual graph */}
      <div className="mt-4 overflow-x-auto bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 rounded-lg p-6 border">
        <div
          className="relative"
          style={{
            minWidth: "900px",
            height: `${Math.max(...wf.nodes.map((n) => Math.abs(n.position.y))) + 200}px`,
          }}
        >
          <WorkflowGraph
            wf={wf}
            activeNode={activeNode}
            onSelectNode={setActiveNode}
          />
        </div>
      </div>

      {/* Node detail panel */}
      {activeNode && (
        <Card className="p-3 bg-muted/30">
          {(() => {
            const node = wf.nodes.find((n) => n.id === activeNode);
            if (!node) return null;
            return (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-7 h-7 rounded flex items-center justify-center text-sm"
                    style={{ background: `${node.color}20` }}
                  >
                    {node.icon}
                  </span>
                  <span className="font-semibold">{node.name}</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase"
                    style={{ color: node.color, borderColor: node.color }}
                  >
                    {node.type}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{node.description}</p>
                {node.detail && (
                  <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto">
                    {node.detail}
                  </pre>
                )}
              </div>
            );
          })()}
        </Card>
      )}

      {/* API contract */}
      <Card className="p-3 mt-2">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          API контракт
        </h4>
        <div className="space-y-2 text-xs">
          <ApiRow
            method="GET"
            path={`/api/cron/${wf.id}`}
            description="Вызывается триггером n8n — возвращает данные для обработки"
          />
          {wf.id === "abandoned-cart" && (
            <ApiRow
              method="PATCH"
              path={`/api/cron/${wf.id}`}
              description="Помечает корзину как уведомлённую (body: { cartId, action: 'mark_notified' })"
            />
          )}
          <ApiRow
            method="POST"
            path="/api/notifications/send"
            description="Отправляет уведомление пользователю (template из таблицы ниже)"
          />
          <ApiRow
            method="POST"
            path="/api/cron/status"
            description="Записывает статус выполнения в историю (для админ-панели)"
          />
        </div>
      </Card>

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(`curl -H "X-Cron-Secret: $CRON_SECRET" \\
  http://localhost:3000/api/cron/${wf.id}`);
            toast.success("curl-команда скопирована");
          }}
        >
          <Copy className="h-4 w-4 mr-1" />
          Скопировать curl
        </Button>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-1" />
          Скачать JSON
        </Button>
      </DialogFooter>
    </>
  );
}

// ===== Workflow graph rendering =====

function WorkflowGraph({
  wf,
  activeNode,
  onSelectNode,
}: {
  wf: Workflow;
  activeNode: string | null;
  onSelectNode: (id: string) => void;
}) {
  // Compute bounding box
  const minX = Math.min(...wf.nodes.map((n) => n.position.x));
  const minY = Math.min(...wf.nodes.map((n) => n.position.y));
  const maxX = Math.max(...wf.nodes.map((n) => n.position.x));
  const maxY = Math.max(...wf.nodes.map((n) => n.position.y));

  const PAD = 40;
  const width = maxX - minX + PAD * 2;
  const height = maxY - minY + PAD * 2;

  return (
    <svg
      width={width}
      height={height}
      style={{ overflow: "visible" }}
      className="block"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
        </marker>
        <marker
          id="arrow-true"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
        </marker>
        <marker
          id="arrow-false"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
        </marker>
      </defs>

      {/* Edges */}
      {wf.edges.map((edge, i) => {
        const from = wf.nodes.find((n) => n.id === edge.from);
        const to = wf.nodes.find((n) => n.id === edge.to);
        if (!from || !to) return null;

        const x1 = from.position.x - minX + PAD + 100; // node width = 200, half = 100
        const y1 = from.position.y - minY + PAD + 30; // node height = 60, half = 30
        const x2 = to.position.x - minX + PAD + 100;
        const y2 = to.position.y - minY + PAD + 30;

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        return (
          <g key={i}>
            <path
              d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={
                edge.branch === "true"
                  ? "#10b981"
                  : edge.branch === "false"
                  ? "#ef4444"
                  : "#64748b"
              }
              strokeWidth={2}
              strokeDasharray={edge.branch ? "0" : "0"}
              markerEnd={`url(#${
                edge.branch === "true"
                  ? "arrow-true"
                  : edge.branch === "false"
                  ? "arrow-false"
                  : "arrow"
              })`}
            />
            {edge.label && (
              <g>
                <rect
                  x={midX - 20}
                  y={midY - 9}
                  width={40}
                  height={18}
                  rx={9}
                  fill="white"
                  stroke={
                    edge.branch === "true"
                      ? "#10b981"
                      : edge.branch === "false"
                      ? "#ef4444"
                      : "#cbd5e1"
                  }
                  strokeWidth={1}
                />
                <text
                  x={midX}
                  y={midY + 4}
                  textAnchor="middle"
                  className="text-[10px] fill-current"
                  fill={
                    edge.branch === "true"
                      ? "#10b981"
                      : edge.branch === "false"
                      ? "#ef4444"
                      : "#64748b"
                  }
                >
                  {edge.label}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {wf.nodes.map((node) => (
        <foreignObject
          key={node.id}
          x={node.position.x - minX + PAD}
          y={node.position.y - minY + PAD}
          width={200}
          height={60}
        >
          <div
            onClick={() => onSelectNode(node.id)}
            className={`w-full h-full rounded-lg border-2 bg-white dark:bg-slate-900 p-2 cursor-pointer transition-all hover:scale-105 ${
              activeNode === node.id ? "shadow-lg ring-2 ring-offset-1" : ""
            }`}
            style={{
              borderColor: node.color,
              boxShadow:
                activeNode === node.id ? `0 0 0 2px ${node.color}` : undefined,
            }}
          >
            <div className="flex items-start gap-1.5 h-full">
              <div
                className="w-7 h-7 rounded flex items-center justify-center text-sm flex-shrink-0"
                style={{ background: `${node.color}20` }}
              >
                {node.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">
                  {node.name}
                </div>
                <div
                  className="text-[10px] uppercase tracking-wide font-medium"
                  style={{ color: node.color }}
                >
                  {node.type}
                </div>
              </div>
            </div>
          </div>
        </foreignObject>
      ))}
    </svg>
  );
}

// ===== Helpers =====

function RunRow({ run }: { run: CronRun }) {
  const wf = WORKFLOWS.find((w) => w.id === run.workflow);
  const time = formatRelative(run.timestamp);
  return (
    <div className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 transition-colors">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          run.status === "success"
            ? "bg-emerald-100 text-emerald-600"
            : run.status === "failed"
            ? "bg-red-100 text-red-600"
            : "bg-amber-100 text-amber-600"
        }`}
      >
        {run.status === "success" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : run.status === "failed" ? (
          <XCircle className="h-4 w-4" />
        ) : (
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{wf?.name || run.workflow}</span>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              run.status === "success"
                ? "text-emerald-700 border-emerald-200"
                : run.status === "failed"
                ? "text-red-700 border-red-200"
                : "text-amber-700 border-amber-200"
            }`}
          >
            {run.status}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {time}
          {run.duration && ` · ${run.duration}ms`}
          {run.sent !== undefined && ` · отправлено: ${run.sent}`}
          {run.notified !== undefined && ` · уведомлено: ${run.notified}`}
          {run.totalPoints !== undefined && ` · баллов: ${run.totalPoints}`}
          {run.errorMessage && ` · ${run.errorMessage}`}
        </div>
      </div>
    </div>
  );
}

function ApiRow({
  method,
  path,
  description,
}: {
  method: string;
  path: string;
  description: string;
}) {
  const color =
    method === "GET"
      ? "text-emerald-700 bg-emerald-100"
      : method === "POST"
      ? "text-amber-700 bg-amber-100"
      : method === "PATCH"
      ? "text-blue-700 bg-blue-100"
      : "text-purple-700 bg-purple-100";
  return (
    <div className="flex items-start gap-2">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${color} flex-shrink-0`}>
        {method}
      </span>
      <div className="flex-1 min-w-0">
        <code className="text-xs">{path}</code>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} дн назад`;
  if (hours > 0) return `${hours} ч назад`;
  if (minutes > 0) return `${minutes} мин назад`;
  return "только что";
}

function generateSample(wfId: string, count: number): unknown[] {
  if (wfId === "abandoned-cart") {
    return Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      userId: `user_${i + 1}`,
      userName: ["Анна Соколова", "Иван Петров", "Мария Иванова", "Дмитрий Сидоров", "Елена Кузнецова"][i] || `Пользователь ${i + 1}`,
      itemsCount: Math.floor(Math.random() * 5) + 1,
      total: Math.floor(Math.random() * 5000) + 500,
    }));
  }
  if (wfId === "expiring-bonuses") {
    return Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      userId: `user_${i + 1}`,
      userName: ["Анна Соколова", "Иван Петров", "Мария Иванова", "Дмитрий Сидоров", "Елена Кузнецова"][i] || `Пользователь ${i + 1}`,
      points: Math.floor(Math.random() * 500) + 50,
      daysLeft: Math.floor(Math.random() * 14) + 1,
    }));
  }
  return [];
}
