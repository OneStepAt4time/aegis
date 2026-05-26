/**
 * session-detail/useAuditData.ts — Hook for audit trail data.
 */

import { useState, useEffect } from 'react';
import type { AuditRecord, ParsedEntry } from '../../types';
import { fetchAuditLogs, getSessionMessages } from '../../api/client';
import { sanitizeErrorMessage } from '../../utils/sanitizeErrorMessage';

interface UseAuditDataReturn {
  auditRecords: AuditRecord[];
  auditLoading: boolean;
  auditError: string | null;
  prEntries: ParsedEntry[];
  prLoading: boolean;
}

export function useAuditData(activeTab: string, sessionId: string | undefined): UseAuditDataReturn {
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [prEntries, setPrEntries] = useState<ParsedEntry[]>([]);
  const [prLoading, setPrLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'audit' || !sessionId) return;

    let cancelled = false;
    setAuditLoading(true);
    setAuditError(null);

    fetchAuditLogs({ sessionId, limit: 100, reverse: true })
      .then((data) => {
        if (cancelled) return;
        setAuditRecords(data.records);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setAuditError(sanitizeErrorMessage(err, 'Failed to load audit trail'));
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab, sessionId]);

  useEffect(() => {
    if (activeTab !== 'pr' || !sessionId) return;

    let cancelled = false;
    setPrLoading(true);

    getSessionMessages(sessionId)
      .then((data) => {
        if (cancelled) return;
        setPrEntries(data.messages);
      })
      .catch(() => {
        if (!cancelled) setPrEntries([]);
      })
      .finally(() => {
        if (!cancelled) setPrLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeTab, sessionId]);

  return { auditRecords, auditLoading, auditError, prEntries, prLoading };
}
