"use client";

/**
 * Admin tab: Database maintenance — backup + cleanup.
 *
 * Shows:
 *   - DB statistics (record counts per table)
 *   - Backup history (list of MaintenanceLog entries with type=BACKUP_*)
 *   - Cleanup history (list of MaintenanceLog entries with type=CLEANUP_*)
 *   - Existing backup files (filename, size, date)
 *   - Manual "Run backup now" and "Run cleanup now" buttons
 *   - Cron schedule info
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Database,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  Table,
  AlertTriangle,
  Zap,
  Calendar,
} from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils";

interface MaintenanceLog {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsAffected: number | null;
  backupPath: string | null;
  backupSizeBytes: number | null;
  tablesCount: number | null;
  errorMessage: string | null;
  triggeredBy: string | null;
}

interface DbStats {
  tables: Array<{ name: string; count: number }>;
  totalRecords: number;
}

interface BackupFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  BACKUP_FULL: "Полный backup",
  BACKUP_INCREMENTAL: "Инкрементальный backup",
  CLEANUP_LOGS: "Очистка логов",
  CLEANUP_SESSIONS: "Очистка сессий",
  CLEANUP_NOTIFICATIONS: "Очистка уведомлений",
  CLEANUP_CARTS: "Очистка корзин",
  CLEANUP_ORPHANS: "Удаление мусора",
  VACUUM: "VACUUM ANALYZE",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  success: { label: "Успешно", color: "text-emerald-700 bg-emerald-100 border-emerald-200", icon: CheckCircle2 },
  failed: { label: "Ошибка", color: "text-red-700 bg-red-100 border-red-200", icon: XCircle },
  running: { label: "Выполняется", color: "text-blue-700 bg-blue-100 border-blue-200", icon: RefreshCw },
  queued: { label: "В очереди", color: "text-amber-700 bg-amber-100 border-amber-200", icon: Clock },
  partial: { label: "Частично", color: "text-amber-700 bg-amber-100 border-amber-200", icon: AlertTriangle },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function AdminMaintenanceTab() {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<"backup" | "cleanup" | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await fetch("/api/maintenance/history?limit=50");
      if (!resp.ok) throw new Error("Failed to load");
      const data = await resp.json();
      setLogs(data.logs || []);
      setDbStats(data.dbStats || null);
      setBackups(data.backups || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBackup = async () => {
    setRunning("backup");
    try {
      const resp = await fetch("/api/maintenance/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup" }),
      });
      if (resp.ok) {
        await loadData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(null);
    }
  };

  const handleCleanup = async () => {
    setRunning("cleanup");
    try {
      const resp = await fetch("/api/maintenance/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup" }),
      });
      if (resp.ok) {
        await loadData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(null);
    }
  };

  const backupLogs = logs.filter((l) => l.type.startsWith("BACKUP"));
  const cleanupLogs = logs.filter((l) => l.type.startsWith("CLEANUP") || l.type === "VACUUM");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold mb-1 flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          Обслуживание БД
        </h1>
        <p className="text-sm text-muted-foreground">
          Резервное копирование и очистка старых данных. Автоматически: backup
          ежедневно в 03:00, cleanup в 04:00.
        </p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                Резервное копирование
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Создаёт gzipped backup всех таблиц БД
              </div>
            </div>
          </div>
          <Button
            onClick={handleBackup}
            disabled={running !== null}
            className="w-full"
          >
            {running === "backup" ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Создание backup...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Создать backup сейчас
              </>
            )}
          </Button>
          <div className="mt-2 text-xs text-muted-foreground">
            Cron: ежедневно 03:00 · хранение 30 дней
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-error" />
                Очистка старых данных
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Удаляет старые логи, уведомления, брошенные корзины
              </div>
            </div>
          </div>
          <Button
            onClick={handleCleanup}
            disabled={running !== null}
            variant="destructive"
            className="w-full"
          >
            {running === "cleanup" ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Очистка...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Запустить очистку
              </>
            )}
          </Button>
          <div className="mt-2 text-xs text-muted-foreground">
            Cron: ежедневно 04:00 · после backup
          </div>
        </Card>
      </div>

      {/* DB Stats */}
      {dbStats && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Table className="h-5 w-5 text-primary" />
            Статистика БД
            <Badge variant="outline" className="ml-auto">
              {dbStats.totalRecords} записей
            </Badge>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {dbStats.tables
              .filter((t) => t.count > 0)
              .sort((a, b) => b.count - a.count)
              .map((t) => (
                <div
                  key={t.name}
                  className="p-2 rounded-lg border bg-muted/30 text-center"
                >
                  <div className="text-lg font-bold">{t.count}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {t.name}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Backup files */}
      {backups && backups.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            Файлы backup ({backups.length})
          </h3>
          <div className="space-y-1">
            {backups.map((b) => (
              <div
                key={b.filename}
                className="flex items-center justify-between p-2 rounded hover:bg-muted/30 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Download className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono text-xs truncate">{b.filename}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatBytes(b.sizeBytes)}</span>
                  <span>{formatDistanceToNow(new Date(b.createdAt))}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Backup history */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          История backup
        </h3>
        {backupLogs.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Пока нет backup-записей
          </div>
        ) : (
          <div className="space-y-2">
            {backupLogs.slice(0, 10).map((log) => {
              const config = STATUS_CONFIG[log.status] || STATUS_CONFIG.queued;
              const Icon = config.icon;
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-3 p-2 rounded border hover:bg-muted/30"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {TYPE_LABELS[log.type] || log.type}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.startedAt))}
                      {log.durationMs && ` · ${formatDuration(log.durationMs)}`}
                      {log.backupSizeBytes && ` · ${formatBytes(log.backupSizeBytes)}`}
                      {log.tablesCount && ` · ${log.tablesCount} таблиц`}
                      {log.recordsAffected !== null && log.recordsAffected > 0 && ` · ${log.recordsAffected} записей`}
                    </div>
                    {log.errorMessage && (
                      <div className="text-xs text-red-600 mt-0.5">
                        {log.errorMessage}
                      </div>
                    )}
                  </div>
                  <Badge className={`text-[10px] ${config.color} border`}>
                    {config.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Cleanup history */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-error" />
          История очистки
        </h3>
        {cleanupLogs.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Пока нет cleanup-записей
          </div>
        ) : (
          <div className="space-y-2">
            {cleanupLogs.slice(0, 10).map((log) => {
              const config = STATUS_CONFIG[log.status] || STATUS_CONFIG.queued;
              const Icon = config.icon;
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-3 p-2 rounded border hover:bg-muted/30"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {TYPE_LABELS[log.type] || log.type}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.startedAt))}
                      {log.durationMs && ` · ${formatDuration(log.durationMs)}`}
                      {log.recordsAffected !== null && log.recordsAffected > 0 && ` · удалено ${log.recordsAffected} записей`}
                    </div>
                    {log.errorMessage && (
                      <div className="text-xs text-red-600 mt-0.5">
                        {log.errorMessage}
                      </div>
                    )}
                  </div>
                  <Badge className={`text-[10px] ${config.color} border`}>
                    {config.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Cleanup rules info */}
      <Card className="p-4 bg-amber-50 dark:bg-amber-950/30">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Правила очистки
        </h3>
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">90д</span>
            <span>Удаление старых maintenance-логов</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">90д</span>
            <span>Удаление прочитанных уведомлений (непрочитанные остаются)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">30д</span>
            <span>Удаление брошенных корзин (без заказов за 30 дней)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">7д</span>
            <span>Удаление неверифицированных семафоров (email/телефон)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">180д</span>
            <span>Удаление старых записей складских движений</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-mono text-xs bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">365д</span>
            <span>Удаление старых проверок организаций (оставляем последнюю по ИНН)</span>
          </div>
        </div>
        <Separator className="my-3" />
        <div className="text-xs text-muted-foreground">
          <Calendar className="h-3 w-3 inline mr-1" />
          Backup: ежедневно 03:00 · Cleanup: ежедневно 04:00 (после backup)
        </div>
        <div className="mt-2 text-xs font-mono text-muted-foreground">
          curl -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/backup
          <br />
          curl -H "X-Cron-Secret: $CRON_SECRET" http://localhost:3000/api/cron/cleanup
        </div>
      </Card>
    </div>
  );
}
