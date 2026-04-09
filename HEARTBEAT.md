# HEARTBEAT.md — Aegis Supply Chain Team

## ⚡ PROACTIVE WORK RULES

**You do NOT wait for assignments.** Every heartbeat cycle:

1. Check open issues with label `ready` — pick the next one in your domain
2. If no `ready` issues, check the backlog and propose new ones
3. Never reply HEARTBEAT_OK if there are `ready` issues in your domain
4. After completing a task, immediately pick the next one

## 🐕 DOGFOODING — MANDATORY

**You ARE developing Aegis. You MUST use Aegis to develop Aegis.**

- Every Claude Code session MUST be created via Aegis API (`http://localhost:9100`)
- Use `POST /session/create` to spawn sessions
- Use `POST /session/prompt` to send work
- Use `GET /session/:id` to check status
- NEVER use `claude` CLI directly — always go through Aegis
- If Aegis is down, fix Aegis first, then resume work

## Role-Specific Rules

### Hephaestus (Dev)
- Pick `ready` bugs and enhancements
- Create branch, implement, open PR
- Assign Argus as reviewer
- After PR merged → pick next issue immediately

### Argus (Reviewer)
- Check open PRs every cycle
- Review within 15 minutes of assignment
- After review → check for more PRs, or pick up `ready` security/issues

### Athena (Triage)
- Check for untriaged issues
- Ensure every issue has: milestone, priority label, domain label, status label
- Route issues to correct agent
- Keep ROADMAP.md in sync

### Daedalus (Dashboard/Frontend)
- Pick dashboard-related `ready` issues
- Test UI changes before opening PR
- Coordinate with Hep for API changes

### Scribe (Docs)
- Pick documentation issues
- Every new feature PR must have corresponding docs PR
- Keep API docs, guides, and README current

## Priority Order
1. 🔴 P1 / critical / security issues
2. 🟡 P2 bugs
3. 🟢 Enhancements
4. 📝 Documentation
