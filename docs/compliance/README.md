# Aegis Compliance Documentation

> **Status:** Pre-compliance (Phase 4 — Enterprise GA, not yet active)
>
> **Last reviewed:** 2026-05-11 | **Aegis version:** 0.6.7

This directory contains Aegis's compliance documentation, organized for SOC 2 Type II audit preparation, GDPR adherence, and enterprise security reviews.

## Documents

| Document | Description |
|----------|-------------|
| [SOC 2 CC Mapping](./soc2-cc-mapping.md) | Trust Services Criteria (CC6–CC9) mapped to Aegis features, with evidence references and gap analysis |
| [SOC 2 Evidence Checklist](./soc2-evidence-checklist.md) | Audit evidence collection checklist — what to gather, where to find it, and how to store it |
| [Data Retention Policy](./data-retention-policy.md) | Data retention schedules, deletion mechanisms, and DSAR handling |
| [DPA Template](./dpa-template.md) | Data Processing Agreement template for enterprise customers |
| [Incident Response](./incident-response.md) | Incident response runbook template — triage, containment, communication, postmortem |

## Related Documents

These documents live outside `docs/compliance/` but are part of the compliance posture:

| Document | Location |
|----------|----------|
| Compliance overview (SOC 2 + GDPR + HIPAA) | [`docs/COMPLIANCE.md`](../COMPLIANCE.md) |
| Vendor security questionnaire | [`docs/SECURITY_QUESTIONNAIRE.md`](../SECURITY_QUESTIONNAIRE.md) |
| Security policy | [`SECURITY.md`](../../SECURITY.md) |

## How to Use This Directory

### For Auditors

1. Start with **SOC 2 CC Mapping** — it links every Trust Services Criterion to the Aegis feature that satisfies it, with evidence pointers.
2. Use the **Evidence Checklist** to verify that audit artifacts exist and are current.
3. Review **Data Retention Policy** for data lifecycle controls.

### For Aegis Maintainers

1. When adding a security-relevant feature, update **SOC 2 CC Mapping** to link the new feature to the relevant criterion.
2. When closing a gap, update the status in both the CC mapping and the main [`COMPLIANCE.md`](../COMPLIANCE.md).
3. Before a release, run through the **Evidence Checklist** to ensure completeness.

## Phase 4 Activation

These documents are **preparation artifacts**. They describe the compliance posture Aegis aims to achieve when Phase 4 (Enterprise GA) activates. Until then:

- Status fields reflect **current implementation**, not audit-readiness.
- Gap items are tracked in the GitHub issue backlog with `phase-4` and `compliance` labels.
- No formal audit engagement should be initiated based on these documents alone.
