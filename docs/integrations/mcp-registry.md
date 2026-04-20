# MCP Registry Preparation

This document tracks the metadata needed to publish Aegis to an MCP registry.

## Package Identity

- Name: `Aegis Bridge`
- Slug: `aegis`
- Summary: `HTTP + MCP orchestration for Claude Code sessions`
- Homepage: `https://github.com/OneStepAt4time/aegis`
- License: `MIT`

## Suggested Metadata

- Tags: `mcp`, `claude-code`, `orchestration`, `automation`, `sessions`
- Transport: `stdio`
- Launch command: `ag mcp`
- Health endpoint: `GET /v1/health`

## Registry Checklist

- Confirm npm package is public
- Confirm README contains MCP install instructions
- Confirm example config for at least 2 MCP hosts
- Confirm versioned release pipeline is active
- Add registry badge/link to README after listing is live
