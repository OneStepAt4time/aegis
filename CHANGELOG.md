# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.10.2](https://github.com/OneStepAt4time/aegis/compare/v2.10.1...v2.10.2) (2026-04-03)


### Bug Fixes

* add latency metrics visualization to dashboard ([#990](https://github.com/OneStepAt4time/aegis/issues/990)) ([aaac8a0](https://github.com/OneStepAt4time/aegis/commit/aaac8a0c88df3742ddeadd2edec670114a7aadf2))
* add session summary card to dashboard ([#989](https://github.com/OneStepAt4time/aegis/issues/989)) ([5ce41d4](https://github.com/OneStepAt4time/aegis/commit/5ce41d4ebae43f9fe301e03337399607861a864e))

## [2.10.1](https://github.com/OneStepAt4time/aegis/compare/v2.10.0...v2.10.1) (2026-04-03)


### Bug Fixes

* preserve hook env vars for BOM settings files ([#986](https://github.com/OneStepAt4time/aegis/issues/986)) ([a3915e8](https://github.com/OneStepAt4time/aegis/commit/a3915e82d4c425ca39ccf36de080877f7377d70d))

## [2.10.0](https://github.com/OneStepAt4time/aegis/compare/v2.9.3...v2.10.0) (2026-04-03)


### Features

* Verification Protocol — POST /v1/sessions/:id/verify ([#740](https://github.com/OneStepAt4time/aegis/issues/740)) ([#982](https://github.com/OneStepAt4time/aegis/issues/982)) ([fb2d340](https://github.com/OneStepAt4time/aegis/commit/fb2d3407be99a10a6a103953e5444f164016605c))

## [2.9.3](https://github.com/OneStepAt4time/aegis/compare/v2.9.2...v2.9.3) (2026-04-03)


### Bug Fixes

* add session filtering and bulk actions to dashboard ([#968](https://github.com/OneStepAt4time/aegis/issues/968)) ([08997b6](https://github.com/OneStepAt4time/aegis/commit/08997b6a961e9163f136f3900a6f0a4b8b3734fc))
* add session screenshot capture preview ([#970](https://github.com/OneStepAt4time/aegis/issues/970)) ([b8336f5](https://github.com/OneStepAt4time/aegis/commit/b8336f5234ca386c67af9b081b1fcefd3a594db5))
* preserve hook env vars and normalize callback host ([#981](https://github.com/OneStepAt4time/aegis/issues/981)) ([319e478](https://github.com/OneStepAt4time/aegis/commit/319e478aac7cd64581c34e26fd962f02ca6b13b8))

## [2.9.2](https://github.com/OneStepAt4time/aegis/compare/v2.9.1...v2.9.2) (2026-04-03)


### Bug Fixes

* add auth key management page ([#966](https://github.com/OneStepAt4time/aegis/issues/966)) ([4f989a4](https://github.com/OneStepAt4time/aegis/commit/4f989a4d18e183ba4b87f66c9fa2ebcf88176b9a))
* add session slash and bash quick actions ([#967](https://github.com/OneStepAt4time/aegis/issues/967)) ([8404887](https://github.com/OneStepAt4time/aegis/commit/8404887158eea32aeaad1b0ed2ce712eb94d8874))
* address dashboard accessibility defects ([#965](https://github.com/OneStepAt4time/aegis/issues/965)) ([5d53e35](https://github.com/OneStepAt4time/aegis/commit/5d53e35f8e3971de4f5aa51adbe399aa0faa0146))

## [2.9.1](https://github.com/OneStepAt4time/aegis/compare/v2.9.0...v2.9.1) (2026-04-03)


### Bug Fixes

* **dashboard:** add adaptive polling backoff for pipeline pages ([#956](https://github.com/OneStepAt4time/aegis/issues/956)) ([5cb484c](https://github.com/OneStepAt4time/aegis/commit/5cb484ccf1bedd3a2b7c8518bbc33cbe3ec489a2))

## [2.9.0](https://github.com/OneStepAt4time/aegis/compare/v2.8.1...v2.9.0) (2026-04-03)


### Features

* register 6 additional CC hook event types ([#753](https://github.com/OneStepAt4time/aegis/issues/753)) ([#964](https://github.com/OneStepAt4time/aegis/issues/964)) ([903ea9d](https://github.com/OneStepAt4time/aegis/commit/903ea9db9d7752988fc02425c542f103b8104b88))
* REST API routes for memory bridge + session injection ([#783](https://github.com/OneStepAt4time/aegis/issues/783)) ([#957](https://github.com/OneStepAt4time/aegis/issues/957)) ([0506fd9](https://github.com/OneStepAt4time/aegis/commit/0506fd9e4664f8001bc17a077e5624f14728baed))


### Bug Fixes

* reduce dashboard polling and memoize session rows ([#955](https://github.com/OneStepAt4time/aegis/issues/955)) ([570581d](https://github.com/OneStepAt4time/aegis/commit/570581d2a9b76bdf65e93bc18dae88f5c67132fa))

## [2.8.1](https://github.com/OneStepAt4time/aegis/compare/v2.8.0...v2.8.1) (2026-04-03)


### Bug Fixes

* standardize API error response envelope ([#399](https://github.com/OneStepAt4time/aegis/issues/399)) ([#953](https://github.com/OneStepAt4time/aegis/issues/953)) ([d8beb53](https://github.com/OneStepAt4time/aegis/commit/d8beb53f8eed3ca0f5e2e6b218c10580dbb90e7b))

## [2.8.0](https://github.com/OneStepAt4time/aegis/compare/v2.7.0...v2.8.0) (2026-04-03)


### Features

* session memory bridge core module ([#783](https://github.com/OneStepAt4time/aegis/issues/783)) ([#951](https://github.com/OneStepAt4time/aegis/issues/951)) ([cfac2a0](https://github.com/OneStepAt4time/aegis/commit/cfac2a0416e60db109e5b9decd4dc54ca853431f))

## [2.7.0](https://github.com/OneStepAt4time/aegis/compare/v2.6.4...v2.7.0) (2026-04-03)


### Features

* add tool registry for CC tool introspection ([#704](https://github.com/OneStepAt4time/aegis/issues/704)) ([#940](https://github.com/OneStepAt4time/aegis/issues/940)) ([a038ad8](https://github.com/OneStepAt4time/aegis/commit/a038ad896cb2912cf820b5bded056b13b8e0888d))
* dynamic permission policy API ([#700](https://github.com/OneStepAt4time/aegis/issues/700)) ([f3d4a90](https://github.com/OneStepAt4time/aegis/commit/f3d4a905dee8b164aabc42da62bf797b4678e23b))
* dynamic permission policy API and sub-agent spawning API ([#700](https://github.com/OneStepAt4time/aegis/issues/700) [#702](https://github.com/OneStepAt4time/aegis/issues/702)) ([#943](https://github.com/OneStepAt4time/aegis/issues/943)) ([f3d4a90](https://github.com/OneStepAt4time/aegis/commit/f3d4a905dee8b164aabc42da62bf797b4678e23b))
* register additional CC hook types ([#571](https://github.com/OneStepAt4time/aegis/issues/571)) ([#945](https://github.com/OneStepAt4time/aegis/issues/945)) ([8cd5ab8](https://github.com/OneStepAt4time/aegis/commit/8cd5ab8026acae74d8daebd33b14e082d252fd3a))


### Bug Fixes

* remove unused sessionId prop from PanePreview and ApprovalBanner ([#647](https://github.com/OneStepAt4time/aegis/issues/647)) ([#937](https://github.com/OneStepAt4time/aegis/issues/937)) ([3ab8e90](https://github.com/OneStepAt4time/aegis/commit/3ab8e9072eeaf91108c6de1301db21ec408e0b52))
* use npm pack to eliminate TOCTOU race in release workflow ([#649](https://github.com/OneStepAt4time/aegis/issues/649)) ([#944](https://github.com/OneStepAt4time/aegis/issues/944)) ([831fa01](https://github.com/OneStepAt4time/aegis/commit/831fa01e2f396a8730a9c38c52f2a9271fd8bbe7))

## [2.6.4](https://github.com/OneStepAt4time/aegis/compare/v2.6.3...v2.6.4) (2026-04-03)


### Bug Fixes

* inject MCP_CONNECTION_NONBLOCKING in hook settings ([#931](https://github.com/OneStepAt4time/aegis/issues/931)) ([#935](https://github.com/OneStepAt4time/aegis/issues/935)) ([a4fc9ee](https://github.com/OneStepAt4time/aegis/commit/a4fc9ee6166e307a1a38b705b15d7000452ef862))


### Performance Improvements

* optimize LiveTerminal pane rendering and TranscriptViewer key tracking ([#933](https://github.com/OneStepAt4time/aegis/issues/933)) ([4d95e32](https://github.com/OneStepAt4time/aegis/commit/4d95e3242886b1e42577171450e8c75ab8447aa1))
* optimize stall detection, session listing, and transcript discovery ([#932](https://github.com/OneStepAt4time/aegis/issues/932)) ([2330a71](https://github.com/OneStepAt4time/aegis/commit/2330a7149d3ed4f462c3e5da78a7cd0f75ec1842))

## [2.6.3](https://github.com/OneStepAt4time/aegis/compare/v2.6.2...v2.6.3) (2026-04-02)


### Bug Fixes

* replace any return types with proper types in MCP server ([#577](https://github.com/OneStepAt4time/aegis/issues/577)) ([#929](https://github.com/OneStepAt4time/aegis/issues/929)) ([fc78e6a](https://github.com/OneStepAt4time/aegis/commit/fc78e6a98cb27f6617ab2d5dd4bd4b5665855de2))

## [2.6.2](https://github.com/OneStepAt4time/aegis/compare/v2.6.1...v2.6.2) (2026-04-02)


### Bug Fixes

* add CC version validation on session creation ([#564](https://github.com/OneStepAt4time/aegis/issues/564)) ([#927](https://github.com/OneStepAt4time/aegis/issues/927)) ([89a5ba5](https://github.com/OneStepAt4time/aegis/commit/89a5ba5bacfc715b13430f3c6a26bbe51d0495d6))
* add rate limiting to master token auth endpoint ([#924](https://github.com/OneStepAt4time/aegis/issues/924)) ([716f36a](https://github.com/OneStepAt4time/aegis/commit/716f36aeee810a68352d405adf5e9058edeeebaf))
* sessionCreated metric, xterm null guard, SSE reconnect onClose fix ([#925](https://github.com/OneStepAt4time/aegis/issues/925)) ([ecd737c](https://github.com/OneStepAt4time/aegis/commit/ecd737c399a978e384455564a110e10e4a4b21d7))
* use module-scoped nextKey counter in CreateSessionModal ([#639](https://github.com/OneStepAt4time/aegis/issues/639)) ([#928](https://github.com/OneStepAt4time/aegis/issues/928)) ([838cd03](https://github.com/OneStepAt4time/aegis/commit/838cd035972262b703b1cfea2745173b571ca3ba))

## [2.6.1](https://github.com/OneStepAt4time/aegis/compare/v2.6.0...v2.6.1) (2026-04-02)


### Bug Fixes

* add 404 catch-all route, validate trustProxy for rate limiting ([#892](https://github.com/OneStepAt4time/aegis/issues/892)) ([1d0766a](https://github.com/OneStepAt4time/aegis/commit/1d0766ab88505d5e32d1f66632e50db7c0b679da))
* complete cursor replay contract for events and metadata ([#922](https://github.com/OneStepAt4time/aegis/issues/922)) ([1931ab0](https://github.com/OneStepAt4time/aegis/commit/1931ab0ade6feb282423e779379424c324e8958c))
* dashboard type safety — PipelineInfo, BatchResult, PipelineRequest ([#669](https://github.com/OneStepAt4time/aegis/issues/669), [#670](https://github.com/OneStepAt4time/aegis/issues/670), [#671](https://github.com/OneStepAt4time/aegis/issues/671)) ([#888](https://github.com/OneStepAt4time/aegis/issues/888)) ([7cfc59c](https://github.com/OneStepAt4time/aegis/commit/7cfc59cee63a88d26a2a6a5b3dd0330ba1d0547c))
* harden structured diagnostics channel and redaction ([#923](https://github.com/OneStepAt4time/aegis/issues/923)) ([bcbdf06](https://github.com/OneStepAt4time/aegis/commit/bcbdf067b14d068781a2b0180591ec800c24a933))
* hook auth HMAC, env blocklist expansion, SSE rate limit dedup ([#629](https://github.com/OneStepAt4time/aegis/issues/629), [#630](https://github.com/OneStepAt4time/aegis/issues/630), [#634](https://github.com/OneStepAt4time/aegis/issues/634)) ([#914](https://github.com/OneStepAt4time/aegis/issues/914)) ([b3a2fd5](https://github.com/OneStepAt4time/aegis/commit/b3a2fd51a25549b18f0447a357d5008302269fe4))
* **session:** add resilient continuation pointer schema and TTL lifecycle ([#900](https://github.com/OneStepAt4time/aegis/issues/900)) ([#915](https://github.com/OneStepAt4time/aegis/issues/915)) ([02bb6d3](https://github.com/OneStepAt4time/aegis/commit/02bb6d3d3394a095fe724d13f4c6de59d50f6a84))
* strengthen capability handshake negotiation and feature gates ([#919](https://github.com/OneStepAt4time/aegis/issues/919)) ([151cf98](https://github.com/OneStepAt4time/aegis/commit/151cf9822957632625c537d56812e7ff7adfa598))
* validate pipeline stage workDir for path traversal ([#631](https://github.com/OneStepAt4time/aegis/issues/631)) ([#906](https://github.com/OneStepAt4time/aegis/issues/906)) ([d715d80](https://github.com/OneStepAt4time/aegis/commit/d715d8060dc5b61994b34ee421bf129fc831d094))


### Performance Improvements

* replace event buffer splice with circular queue ([#904](https://github.com/OneStepAt4time/aegis/issues/904)) ([548ec59](https://github.com/OneStepAt4time/aegis/commit/548ec59beb407afd30f3ee63ffa542c1cfd26515))

## [2.6.0](https://github.com/OneStepAt4time/aegis/compare/v2.5.5...v2.6.0) (2026-04-02)


### Features

* add cursor-based replay contract for transcript endpoint ([#897](https://github.com/OneStepAt4time/aegis/issues/897)) ([d43bf23](https://github.com/OneStepAt4time/aegis/commit/d43bf23b3b282d70fca83276c588155bc5dfc0fb))
* add worktree-aware continuation metadata lookup ([#898](https://github.com/OneStepAt4time/aegis/issues/898)) ([215cc8c](https://github.com/OneStepAt4time/aegis/commit/215cc8c2e4dc2bfec14cebe50c7d0f129955862f))
* capability handshake contract for Aegis and Claude Code ([#885](https://github.com/OneStepAt4time/aegis/issues/885)) ([e46d0eb](https://github.com/OneStepAt4time/aegis/commit/e46d0eb71510a02731b68058167ba3a923c31b61))


### Bug Fixes

* replace silent catches with explicit suppressible-error policy ([#896](https://github.com/OneStepAt4time/aegis/issues/896)) ([e47c859](https://github.com/OneStepAt4time/aegis/commit/e47c859671c4ddc39f8e06c667da02384becff82))

## [2.5.5](https://github.com/OneStepAt4time/aegis/compare/v2.5.4...v2.5.5) (2026-04-02)


### Bug Fixes

* harden idle session acquisition mutex ([#890](https://github.com/OneStepAt4time/aegis/issues/890)) ([8979ef0](https://github.com/OneStepAt4time/aegis/commit/8979ef0b9ed75005caf065a30aab1b7d3dc544c3))
* move reaper notify after killSession cleanup ([#842](https://github.com/OneStepAt4time/aegis/issues/842)) ([#889](https://github.com/OneStepAt4time/aegis/issues/889)) ([c8262f3](https://github.com/OneStepAt4time/aegis/commit/c8262f3a972b1e26265eb4cd70d6e95ec199f8f2))

## [2.5.4](https://github.com/OneStepAt4time/aegis/compare/v2.5.3...v2.5.4) (2026-04-02)


### Bug Fixes

* add missing UIStateEnum states, apply DOMPurify to all entry types ([#871](https://github.com/OneStepAt4time/aegis/issues/871)) ([9deee1b](https://github.com/OneStepAt4time/aegis/commit/9deee1bdcf306fec9bca168445147ea0b80cd160))
* cache eviction, pipeline timer race, capturePane serialize ([#832](https://github.com/OneStepAt4time/aegis/issues/832), [#830](https://github.com/OneStepAt4time/aegis/issues/830), [#824](https://github.com/OneStepAt4time/aegis/issues/824)) ([#868](https://github.com/OneStepAt4time/aegis/issues/868)) ([1f458f3](https://github.com/OneStepAt4time/aegis/commit/1f458f36027950f1e931d6912832ce25a140cbd9))
* clean up requestKeyMap entries after response to prevent memory leak ([#839](https://github.com/OneStepAt4time/aegis/issues/839)) ([#850](https://github.com/OneStepAt4time/aegis/issues/850)) ([30fe7b6](https://github.com/OneStepAt4time/aegis/commit/30fe7b69fc876afc49128ba5b0c7f4185338a45b))
* correctly report sendMessage delivery failures without masking ([#855](https://github.com/OneStepAt4time/aegis/issues/855)) ([42e1fb4](https://github.com/OneStepAt4time/aegis/commit/42e1fb4e0de6a8b50f9f491fb16c78e10e6fa8fc))
* hook path validation, tmux crash handling, approval regex, jsonl watcher timer ([#847](https://github.com/OneStepAt4time/aegis/issues/847), [#845](https://github.com/OneStepAt4time/aegis/issues/845), [#843](https://github.com/OneStepAt4time/aegis/issues/843), [#846](https://github.com/OneStepAt4time/aegis/issues/846)) ([#869](https://github.com/OneStepAt4time/aegis/issues/869)) ([7055b80](https://github.com/OneStepAt4time/aegis/commit/7055b80d8527853dba8bc7f34a7ff53791536a02))
* move lastUsedAt after rate-limit check, add session mutex, remove transcript offset fallback ([#854](https://github.com/OneStepAt4time/aegis/issues/854)) ([2618e0c](https://github.com/OneStepAt4time/aegis/commit/2618e0c3d534db4136698654f776371d82acaecf))
* move setEnvSecure inside serialize block to prevent env var race ([#837](https://github.com/OneStepAt4time/aegis/issues/837)) ([#860](https://github.com/OneStepAt4time/aegis/issues/860)) ([a9b5089](https://github.com/OneStepAt4time/aegis/commit/a9b5089fd6bd487822de78a57ddb7749387d5af4))
* prevent TOCTOU race in idle session reuse ([#857](https://github.com/OneStepAt4time/aegis/issues/857)) ([e5d2baf](https://github.com/OneStepAt4time/aegis/commit/e5d2baf52a1531e13429400264fc8689c1a87188))
* **security:** add mutex to validateSSEToken to prevent double-decrement race ([#826](https://github.com/OneStepAt4time/aegis/issues/826)) ([#861](https://github.com/OneStepAt4time/aegis/issues/861)) ([6b05a4b](https://github.com/OneStepAt4time/aegis/commit/6b05a4b7cca88fadb86c85fde677295101ab5ee1))
* **security:** cap per-IP rate-limit map at 10k entries to prevent memory exhaustion ([#844](https://github.com/OneStepAt4time/aegis/issues/844)) ([#858](https://github.com/OneStepAt4time/aegis/issues/858)) ([1927c15](https://github.com/OneStepAt4time/aegis/commit/1927c15d9eb3d24176885f66847419826e39e22a))
* **security:** check all DNS answers and verify TOCTOU-safe IP pinning ([#829](https://github.com/OneStepAt4time/aegis/issues/829), [#831](https://github.com/OneStepAt4time/aegis/issues/831)) ([#853](https://github.com/OneStepAt4time/aegis/issues/853)) ([f0ef9e6](https://github.com/OneStepAt4time/aegis/commit/f0ef9e651353d6404c75a117b4be9d0f3f0e0b48))
* **security:** prevent DNS rebinding SSRF in webhook delivery ([#822](https://github.com/OneStepAt4time/aegis/issues/822)) ([#852](https://github.com/OneStepAt4time/aegis/issues/852)) ([3a0d54d](https://github.com/OneStepAt4time/aegis/commit/3a0d54dcb45e6cf9fdc7d72f06262f608f000cdc))
* **security:** redact session metadata from webhook payloads ([#827](https://github.com/OneStepAt4time/aegis/issues/827)) ([#859](https://github.com/OneStepAt4time/aegis/issues/859)) ([423d8fa](https://github.com/OneStepAt4time/aegis/commit/423d8fab65eaacfbc2c2b03d927cdec5571b6031))
* SSEWriter res.end, JSONL drop logging, clock skew validation ([#825](https://github.com/OneStepAt4time/aegis/issues/825), [#823](https://github.com/OneStepAt4time/aegis/issues/823), [#828](https://github.com/OneStepAt4time/aegis/issues/828)) ([#867](https://github.com/OneStepAt4time/aegis/issues/867)) ([81816f9](https://github.com/OneStepAt4time/aegis/commit/81816f999358a7d69a91357a26fc4bb62c2a4801))

## [2.5.3](https://github.com/OneStepAt4time/aegis/compare/v2.5.2...v2.5.3) (2026-04-01)


### Bug Fixes

* add NaN guard for ANSWER_TIMEOUT_MS parsing ([#637](https://github.com/OneStepAt4time/aegis/issues/637)) ([#833](https://github.com/OneStepAt4time/aegis/issues/833)) ([22f4656](https://github.com/OneStepAt4time/aegis/commit/22f465625b53b16130be3d1417e8c310a8ddc6c8))
* deep-merge hook settings by event instead of shallow spread ([#635](https://github.com/OneStepAt4time/aegis/issues/635)) ([#819](https://github.com/OneStepAt4time/aegis/issues/819)) ([7dcb498](https://github.com/OneStepAt4time/aegis/commit/7dcb498b1adfa189d7ea9b9d88b004a6d90e81a6))
* only count 5xx and network errors as circuit breaker failures ([#638](https://github.com/OneStepAt4time/aegis/issues/638)) ([#821](https://github.com/OneStepAt4time/aegis/issues/821)) ([1c70a38](https://github.com/OneStepAt4time/aegis/commit/1c70a386d13a896f10f6b33ed5896198270b99de))
* track untracked setTimeout timers in event bus and session discovery ([#834](https://github.com/OneStepAt4time/aegis/issues/834), [#835](https://github.com/OneStepAt4time/aegis/issues/835)) ([#848](https://github.com/OneStepAt4time/aegis/issues/848)) ([8ce0b9b](https://github.com/OneStepAt4time/aegis/commit/8ce0b9b57199dcb10402988d6d45fc9322f38c3f))

## [2.5.2](https://github.com/OneStepAt4time/aegis/compare/v2.5.1...v2.5.2) (2026-04-01)


### Bug Fixes

* detect waiting_for_input session status from CC transcript on Stop hook ([#812](https://github.com/OneStepAt4time/aegis/issues/812)) ([#816](https://github.com/OneStepAt4time/aegis/issues/816)) ([af5794a](https://github.com/OneStepAt4time/aegis/commit/af5794abf31d56315766ec1ba9e10b7db8998fd1))
* **security:** detect IPv4-mapped IPv6 addresses in SSRF protection ([#621](https://github.com/OneStepAt4time/aegis/issues/621)) ([#815](https://github.com/OneStepAt4time/aegis/issues/815)) ([2ffe1ed](https://github.com/OneStepAt4time/aegis/commit/2ffe1ed1fa6a0a2fc109795b86fab66ec7384686))
* **security:** prevent DNS rebinding in screenshot endpoint via host-resolver-rules ([#817](https://github.com/OneStepAt4time/aegis/issues/817)) ([43998d5](https://github.com/OneStepAt4time/aegis/commit/43998d5bd042710f4554bf13baf02ccbfe0d638f))
* **security:** read PPid from /proc/&lt;pid&gt;/status instead of stat in isAncestorPid ([#813](https://github.com/OneStepAt4time/aegis/issues/813)) ([7b49fed](https://github.com/OneStepAt4time/aegis/commit/7b49fed69ea3fd8b065ed5482e42a7b714ac0ff7))
* verify tmux window exists before returning idle session ([#636](https://github.com/OneStepAt4time/aegis/issues/636)) ([#818](https://github.com/OneStepAt4time/aegis/issues/818)) ([5a43fa1](https://github.com/OneStepAt4time/aegis/commit/5a43fa124905ba54843ea676f600b20f26fc9541))

## [2.5.1](https://github.com/OneStepAt4time/aegis/compare/v2.5.0...v2.5.1) (2026-04-01)


### Bug Fixes

* **ci:** add lockfile-lint as devDependency ([#650](https://github.com/OneStepAt4time/aegis/issues/650)) ([e7cf146](https://github.com/OneStepAt4time/aegis/commit/e7cf146e7b14805b8197ef7d56b0f22771058fd3))
* **ci:** pin clawhub to 0.9.0 in release workflow ([#651](https://github.com/OneStepAt4time/aegis/issues/651)) ([815af02](https://github.com/OneStepAt4time/aegis/commit/815af02fd94d98b9244144918148282978c39eea))
* use correct aegis-bridge slug in release and skill metadata ([#806](https://github.com/OneStepAt4time/aegis/issues/806)) ([12d6640](https://github.com/OneStepAt4time/aegis/commit/12d6640f3bc1d8b2092ee98f468ac2996288f709))

## [2.5.0](https://github.com/OneStepAt4time/aegis/compare/v2.4.1...v2.5.0) (2026-04-01)


### Features

* commits no longer auto-bump minor. Minor/major bumps ([eaf38ed](https://github.com/OneStepAt4time/aegis/commit/eaf38ed57ec4e65fdaed06db50a3c91f8d310717))
* commits no longer auto-bump minor. Minor/major bumps ([e66f477](https://github.com/OneStepAt4time/aegis/commit/e66f4772c6a935ec61a0a5ecb5fd51f0808b3079))


### Bug Fixes

* add forceConsistentCasingInFileNames and noFallthroughCasesInSwitch to root tsconfig ([#800](https://github.com/OneStepAt4time/aegis/issues/800)) ([9a3eff2](https://github.com/OneStepAt4time/aegis/commit/9a3eff2f2bbafa82ad8e425a2956b1a683deb8ba))
* align @types/node with minimum CI Node version (20) ([#793](https://github.com/OneStepAt4time/aegis/issues/793)) ([21d9e06](https://github.com/OneStepAt4time/aegis/commit/21d9e063e5803882b37a9513c112eb8f96fdd961))
* **ci:** add typecheck step to publish-npm job in release workflow ([#791](https://github.com/OneStepAt4time/aegis/issues/791)) ([9569ffa](https://github.com/OneStepAt4time/aegis/commit/9569ffa6eba20aebba349b9e31a750c1c3853771))
* **ci:** remove master branch from CodeQL trigger ([#771](https://github.com/OneStepAt4time/aegis/issues/771)) ([a82109e](https://github.com/OneStepAt4time/aegis/commit/a82109e31b481de3947afd8ec06a0edd1c353b87))
* correct clawhub publish command in release.yml ([#802](https://github.com/OneStepAt4time/aegis/issues/802)) ([5ebfbc2](https://github.com/OneStepAt4time/aegis/commit/5ebfbc21b427e9fa2b07525bc0c2d48aa9618a96))
* **dashboard:** add loading/disabled state to SessionTable action buttons ([#798](https://github.com/OneStepAt4time/aegis/issues/798)) ([914d0b7](https://github.com/OneStepAt4time/aegis/commit/914d0b7f955684ac6ccfa861f50405df26f6d7b2)), closes [#645](https://github.com/OneStepAt4time/aegis/issues/645)
* **dashboard:** add token to LiveTerminal WebSocket effect dependencies ([#796](https://github.com/OneStepAt4time/aegis/issues/796)) ([125954e](https://github.com/OneStepAt4time/aegis/commit/125954ec9fd0770258f628c9842f7c13269d8169)), closes [#642](https://github.com/OneStepAt4time/aegis/issues/642)
* **dashboard:** exclude AbortSignal from batchCreateSessions JSON body ([#784](https://github.com/OneStepAt4time/aegis/issues/784)) ([14661e2](https://github.com/OneStepAt4time/aegis/commit/14661e286beaa873e8a321c5d548b71bfa9a83a0))
* **dashboard:** remove addToast from MetricCards fetchData dependencies ([#797](https://github.com/OneStepAt4time/aegis/issues/797)) ([4d12e98](https://github.com/OneStepAt4time/aegis/commit/4d12e9871310abd894175f45b067be3432e6e286)), closes [#644](https://github.com/OneStepAt4time/aegis/issues/644)
* **dashboard:** ToolResultCard no longer classifies empty results as errors ([#795](https://github.com/OneStepAt4time/aegis/issues/795)) ([d7ed35c](https://github.com/OneStepAt4time/aegis/commit/d7ed35c242414e6bbf6026d962dae20c44567eba)), closes [#643](https://github.com/OneStepAt4time/aegis/issues/643)
* **dashboard:** validate createSession response against Zod schema ([#786](https://github.com/OneStepAt4time/aegis/issues/786)) ([aa60e92](https://github.com/OneStepAt4time/aegis/commit/aa60e9214afce14ea2f2eea65db5370ff86fed92))
* disable source maps in tsconfig to match published files ([#772](https://github.com/OneStepAt4time/aegis/issues/772)) ([ae68a9f](https://github.com/OneStepAt4time/aegis/commit/ae68a9f6f97ea44262b1f06322de89a337f785d5))
* fail copy-dashboard in CI when dashboard/dist is missing ([#770](https://github.com/OneStepAt4time/aegis/issues/770)) ([d33896b](https://github.com/OneStepAt4time/aegis/commit/d33896ba3b6366ff8ef272f4c55ad11772e3ec38))
* remove redundant includes check in swarm socket discovery ([#789](https://github.com/OneStepAt4time/aegis/issues/789)) ([307b9ae](https://github.com/OneStepAt4time/aegis/commit/307b9aef4b7e71ce6d5ad89cc71cfd37d97b7b00))
* **security:** set key store file permissions to 0o600 ([#773](https://github.com/OneStepAt4time/aegis/issues/773)) ([9353244](https://github.com/OneStepAt4time/aegis/commit/9353244eb91ea8e6fd37d481a753c9b571eef89c))
* **security:** use unpredictable tmp dir and restrictive permissions for hook settings ([#799](https://github.com/OneStepAt4time/aegis/issues/799)) ([147ccd6](https://github.com/OneStepAt4time/aegis/commit/147ccd67355b2004d90a9353c3fda15f9ed7cf2c))
* **ssrf:** block broadcast, multicast, documentation, and benchmarking IP ranges ([#775](https://github.com/OneStepAt4time/aegis/issues/775)) ([c2fcbc7](https://github.com/OneStepAt4time/aegis/commit/c2fcbc7a01826164dd4e6de96a17e8c826510707))
* use single-fd pattern in transcript reader to eliminate TOCTOU race ([#623](https://github.com/OneStepAt4time/aegis/issues/623)) ([895d248](https://github.com/OneStepAt4time/aegis/commit/895d248515e9cdba58f6c8df8667ce6736324625))
* validate role query param in transcript endpoint ([#782](https://github.com/OneStepAt4time/aegis/issues/782)) ([eaf38ed](https://github.com/OneStepAt4time/aegis/commit/eaf38ed57ec4e65fdaed06db50a3c91f8d310717))


### Performance Improvements

* replace O(n) shift() with O(1) index-based pruning in IP rate limiter ([#787](https://github.com/OneStepAt4time/aegis/issues/787)) ([58a8ced](https://github.com/OneStepAt4time/aegis/commit/58a8ced1700f4b7ba29689ce0eceff4cb816111f))
* stream-aggregate latency in getGlobalMetrics instead of copying all samples ([#785](https://github.com/OneStepAt4time/aegis/issues/785)) ([4773b49](https://github.com/OneStepAt4time/aegis/commit/4773b492dad067beb044ff3bb62cdcdf70ff3504))

## [2.4.1](https://github.com/OneStepAt4time/aegis/compare/v2.4.0...v2.4.1) (2026-04-01)


### Bug Fixes

* correct SubagentStart agent name extraction in hook Zod validation ([#768](https://github.com/OneStepAt4time/aegis/issues/768)) ([095dba1](https://github.com/OneStepAt4time/aegis/commit/095dba1e76965eafffdc2b7307a7005e5ded0297))
* hydrate activeSubagents arrays to Sets at load time ([#668](https://github.com/OneStepAt4time/aegis/issues/668)) ([#765](https://github.com/OneStepAt4time/aegis/issues/765)) ([b6447a6](https://github.com/OneStepAt4time/aegis/commit/b6447a625e6aa34418260e29df13c1b47a6e12ce))
* replace `as any` cast in applyEnvOverrides with explicit string-key cases ([#762](https://github.com/OneStepAt4time/aegis/issues/762)) ([e1d5a5c](https://github.com/OneStepAt4time/aegis/commit/e1d5a5ca81194a14a272d4c3c60466721da9e3a4))
* replace unsafe `(e as Error).message` with instanceof guard ([#763](https://github.com/OneStepAt4time/aegis/issues/763)) ([7963763](https://github.com/OneStepAt4time/aegis/commit/7963763ff3aa17f2d2e56e561d7c79cd2f7a1d02))
* restrict permissionMode to known enum values in validation schemas ([#756](https://github.com/OneStepAt4time/aegis/issues/756)) ([39c2521](https://github.com/OneStepAt4time/aegis/commit/39c25217d753183a330af9dc8d5f159d5c2e1616))
* **terminal-parser:** make spinner search window configurable via named constant ([#758](https://github.com/OneStepAt4time/aegis/issues/758)) ([be7ecac](https://github.com/OneStepAt4time/aegis/commit/be7ecac8c6efd44621783da8b8f8ef0141e47632))
* **type-safety:** clean up globalEmitter and pending setImmediate timers on unsubscribe ([#769](https://github.com/OneStepAt4time/aegis/issues/769)) ([f2cd7e7](https://github.com/OneStepAt4time/aegis/commit/f2cd7e7b873523617f34b5890230ac1bc2c1281f))
* **type-safety:** replace non-null assertion on getDeadLetterQueue with typeof guard ([#757](https://github.com/OneStepAt4time/aegis/issues/757)) ([57d7383](https://github.com/OneStepAt4time/aegis/commit/57d7383ad45af2d6c268b4894f377763a3cd7453))
* **types:** remove double-cast escape hatches in production code ([#755](https://github.com/OneStepAt4time/aegis/issues/755)) ([d6f86ed](https://github.com/OneStepAt4time/aegis/commit/d6f86edfd4a65be605bbab6cc382668571d4c830))

## [2.4.0](https://github.com/OneStepAt4time/aegis/compare/v2.3.11...v2.4.0) (2026-03-31)


### Features

* **resilience:** add structured error categorization and retry logic ([#701](https://github.com/OneStepAt4time/aegis/issues/701)) ([#729](https://github.com/OneStepAt4time/aegis/issues/729)) ([4b56b29](https://github.com/OneStepAt4time/aegis/commit/4b56b29ea4ecb67c8156c646bd9663cc35ca92bb))


### Bug Fixes

* **perf:** add shared tmux capture-pane cache to deduplicate reads ([#395](https://github.com/OneStepAt4time/aegis/issues/395)) ([#731](https://github.com/OneStepAt4time/aegis/issues/731)) ([3aa6111](https://github.com/OneStepAt4time/aegis/commit/3aa6111a52a3f8a675ec613b34cf3c4bded48368))

## [2.3.11](https://github.com/OneStepAt4time/aegis/compare/v2.3.10...v2.3.11) (2026-03-31)


### Bug Fixes

* **ci:** add explicit ClawHub login before skill publish ([#724](https://github.com/OneStepAt4time/aegis/issues/724)) ([#728](https://github.com/OneStepAt4time/aegis/issues/728)) ([bf9c714](https://github.com/OneStepAt4time/aegis/commit/bf9c714fb34cddcb50b070b6b4f1bb5db9f5460e))
* **correctness:** add event ID overflow guard ([#589](https://github.com/OneStepAt4time/aegis/issues/589)) ([0abeb7a](https://github.com/OneStepAt4time/aegis/commit/0abeb7a3792b1958e73e32b7fc78fb251e348412))
* **perf:** align stall detection with CLAUDE_STREAM_IDLE_TIMEOUT_MS ([#392](https://github.com/OneStepAt4time/aegis/issues/392)) ([0624b65](https://github.com/OneStepAt4time/aegis/commit/0624b6529142e144299e62afbb24354772fd80b5))
* **security:** add rate limiting for batch session creation ([#583](https://github.com/OneStepAt4time/aegis/issues/583)) ([d8f66c8](https://github.com/OneStepAt4time/aegis/commit/d8f66c81bc5f90e80ae6597de441fb1b0f5daf1a))
* **security:** differentiate webhook retry log levels ([#588](https://github.com/OneStepAt4time/aegis/issues/588)) ([725bb21](https://github.com/OneStepAt4time/aegis/commit/725bb2115fa4b4cbc60daba581488625405267c0))
* **security:** remove dead BatchRateLimiter, fix requestKeyMap leak ([#583](https://github.com/OneStepAt4time/aegis/issues/583) follow-up) ([307ede5](https://github.com/OneStepAt4time/aegis/commit/307ede5602fb6b4b741e40f758e8b031409fd859))
* wrap SSE subscription in try-catch with auto-reconnect ([#721](https://github.com/OneStepAt4time/aegis/issues/721)) ([da80375](https://github.com/OneStepAt4time/aegis/commit/da80375fd8aeece353171d71dcb92494085fb1e1))

## [2.3.10](https://github.com/OneStepAt4time/aegis/compare/v2.3.9...v2.3.10) (2026-03-31)


### Bug Fixes

* **correctness:** fix backward newline scan offset in transcript reader ([#579](https://github.com/OneStepAt4time/aegis/issues/579)) ([77b474f](https://github.com/OneStepAt4time/aegis/commit/77b474f3eee3bcb607da86b565a1cc1ba7f8f7e0))

## [2.3.9](https://github.com/OneStepAt4time/aegis/compare/v2.3.8...v2.3.9) (2026-03-31)


### Bug Fixes

* **perf:** clear pipeline poll interval when no pipelines remain ([#578](https://github.com/OneStepAt4time/aegis/issues/578)) ([efa7269](https://github.com/OneStepAt4time/aegis/commit/efa726935cfd7838f24d80dd80099cab9fe183d1))
* **stability:** add graceful session cleanup on SIGTERM/SIGINT ([#569](https://github.com/OneStepAt4time/aegis/issues/569)) ([c06cef6](https://github.com/OneStepAt4time/aegis/commit/c06cef67bf33d90f7cda1d5bd27b37fc9c8cb23e))

## [2.3.8](https://github.com/OneStepAt4time/aegis/compare/v2.3.7...v2.3.8) (2026-03-31)


### Bug Fixes

* **api:** align pagination response shape with frontend expectations ([#576](https://github.com/OneStepAt4time/aegis/issues/576)) ([b05654a](https://github.com/OneStepAt4time/aegis/commit/b05654a8974d39f6b7c4e61be0f84733bdc68532))

## [2.3.7](https://github.com/OneStepAt4time/aegis/compare/v2.3.6...v2.3.7) (2026-03-31)


### Bug Fixes

* **security:** add bounds validation on WebSocket resize messages ([#581](https://github.com/OneStepAt4time/aegis/issues/581)) ([8df77c8](https://github.com/OneStepAt4time/aegis/commit/8df77c85fcdfdbddbe7a078117bbbf278eb54d14))
* **security:** validate UUID format on hookSessionId header ([#580](https://github.com/OneStepAt4time/aegis/issues/580)) ([55a8c27](https://github.com/OneStepAt4time/aegis/commit/55a8c27227bfa41cae737d402096c7582805e346))

## [2.3.6](https://github.com/OneStepAt4time/aegis/compare/v2.3.5...v2.3.6) (2026-03-31)


### Bug Fixes

* **security:** catch prior mutex rejection in generateSSEToken ([#573](https://github.com/OneStepAt4time/aegis/issues/573)) ([1ddd8f4](https://github.com/OneStepAt4time/aegis/commit/1ddd8f42ca4a2a5a266a3f6279fcd3482884e16d))
* **security:** replace execSync with execFileSync in killStalePortHolder ([#575](https://github.com/OneStepAt4time/aegis/issues/575)) ([5664e55](https://github.com/OneStepAt4time/aegis/commit/5664e553f81b4db3c0a946e16735ababbfb0e08c))
* **stability:** add catch handlers for fire-and-forget PID lookup ([#574](https://github.com/OneStepAt4time/aegis/issues/574)) ([b3fd7fe](https://github.com/OneStepAt4time/aegis/commit/b3fd7feda1c50d14c5904cf4b822419fcabbe1e5))

## [2.3.5](https://github.com/OneStepAt4time/aegis/compare/v2.3.4...v2.3.5) (2026-03-31)


### Bug Fixes

* **#607:** reuse idle sessions for same workDir instead of creating duplicates ([dafa22c](https://github.com/OneStepAt4time/aegis/commit/dafa22c613f623b5a562244256829e1fa26c3826)), closes [#607](https://github.com/OneStepAt4time/aegis/issues/607)

## [2.3.4](https://github.com/OneStepAt4time/aegis/compare/v2.3.3...v2.3.4) (2026-03-31)


### Bug Fixes

* **#582:** redact sensitive webhook headers from error logs ([9f9f614](https://github.com/OneStepAt4time/aegis/commit/9f9f614cfff1366b328ce7a9e804b55df7683951)), closes [#582](https://github.com/OneStepAt4time/aegis/issues/582)

## [2.3.3](https://github.com/OneStepAt4time/aegis/compare/v2.3.2...v2.3.3) (2026-03-31)


### Bug Fixes

* **#586:** clean up old EventSource on reconnect to prevent listener leak ([#609](https://github.com/OneStepAt4time/aegis/issues/609)) ([5780e64](https://github.com/OneStepAt4time/aegis/commit/5780e64e1e1eaea61b3193f006deb87cfe4fdd43)), closes [#586](https://github.com/OneStepAt4time/aegis/issues/586)
* **#587:** add error handling to Layout SSE subscription ([#608](https://github.com/OneStepAt4time/aegis/issues/608)) ([00d4933](https://github.com/OneStepAt4time/aegis/commit/00d493378ebcec0c507092f445342f1855c006d2)), closes [#587](https://github.com/OneStepAt4time/aegis/issues/587)

## [2.3.2](https://github.com/OneStepAt4time/aegis/compare/v2.3.1...v2.3.2) (2026-03-31)


### Bug Fixes

* **#588:** aggregate Promise.allSettled errors in webhook fire() ([#610](https://github.com/OneStepAt4time/aegis/issues/610)) ([bfc80c0](https://github.com/OneStepAt4time/aegis/commit/bfc80c0604bfa7b942b5b7dbe5cd345806e69114)), closes [#588](https://github.com/OneStepAt4time/aegis/issues/588)

## [2.3.1](https://github.com/OneStepAt4time/aegis/compare/v2.3.0...v2.3.1) (2026-03-31)


### Bug Fixes

* tmux server crash recovery — health check, reconciliation, re-attach ([#602](https://github.com/OneStepAt4time/aegis/issues/602)) ([aeee38c](https://github.com/OneStepAt4time/aegis/commit/aeee38c04e0e2f1f1c36732d1a572e163550b467)), closes [#397](https://github.com/OneStepAt4time/aegis/issues/397)

## [2.3.0](https://github.com/OneStepAt4time/aegis/compare/v2.2.6...v2.3.0) (2026-03-31)


### Features

* **#599:** expose pendingQuestion in get_status and REST endpoint ([#600](https://github.com/OneStepAt4time/aegis/issues/600)) ([38fc42f](https://github.com/OneStepAt4time/aegis/commit/38fc42f7c99efc67a9b6d3636647682f9a593c39))


### Bug Fixes

* **ci:** use RELEASE_PAT for release-please to trigger CI on PRs ([#601](https://github.com/OneStepAt4time/aegis/issues/601)) ([a86aaf1](https://github.com/OneStepAt4time/aegis/commit/a86aaf18411352f58baf8993da1c181522075ecc))

## [2.2.6](https://github.com/OneStepAt4time/aegis/compare/v2.2.5...v2.2.6) (2026-03-30)


### Bug Fixes

* **ci:** use GITHUB_TOKEN for release-please instead of failing RELEASE_PAT ([91c3cb5](https://github.com/OneStepAt4time/aegis/commit/91c3cb56ed862c92d29a63d3c50fbc21e81e7e2c))
* MCP kill_session 400 + extended working stall detection ([#597](https://github.com/OneStepAt4time/aegis/issues/597)) ([0426613](https://github.com/OneStepAt4time/aegis/commit/042661369de062bba62a4e181bd345e9964b3b31))
* memory leak fixes — event buffer cleanup, cache eviction, debounce guard ([#572](https://github.com/OneStepAt4time/aegis/issues/572)) ([13ed2c8](https://github.com/OneStepAt4time/aegis/commit/13ed2c8fe8080d81a529fd9642f958eb9a003333))

## [2.2.5](https://github.com/OneStepAt4time/aegis/compare/v2.2.4...v2.2.5) (2026-03-30)


### Bug Fixes

* robust prompt delivery with post-send verification ([#567](https://github.com/OneStepAt4time/aegis/issues/567)) ([05478fe](https://github.com/OneStepAt4time/aegis/commit/05478fe649cd420fcd7c8533e75caed1bc752789)), closes [#561](https://github.com/OneStepAt4time/aegis/issues/561)

## [2.2.4](https://github.com/OneStepAt4time/aegis/compare/v2.2.3...v2.2.4) (2026-03-30)


### Bug Fixes

* security hardening — CORS wildcard rejection, UUID validation, input length limits ([#565](https://github.com/OneStepAt4time/aegis/issues/565)) ([db610ec](https://github.com/OneStepAt4time/aegis/commit/db610ecbda5834bb43bafee9965a61f7cd919b4a))

## [2.2.3](https://github.com/OneStepAt4time/aegis/compare/v2.2.2...v2.2.3) (2026-03-30)


### Bug Fixes

* validateResponse throws on schema failure instead of returning unvalidated data ([#517](https://github.com/OneStepAt4time/aegis/issues/517)) ([#557](https://github.com/OneStepAt4time/aegis/issues/557)) ([df5f1cc](https://github.com/OneStepAt4time/aegis/commit/df5f1ccdf4c3e4b1533778dbb70c19708c4ddeab))

## [2.2.2](https://github.com/OneStepAt4time/aegis/compare/v2.2.1...v2.2.2) (2026-03-29)


### Reverts

* undo version bump and watermark fix (npm token issue) ([4ee8f5f](https://github.com/OneStepAt4time/aegis/commit/4ee8f5f706960cce485546684b6909b3946a6b1f))

## [2.2.1](https://github.com/OneStepAt4time/aegis/compare/v2.2.0...v2.2.1) (2026-03-29)


### Bug Fixes

* add v2.x to SECURITY.md supported versions ([#548](https://github.com/OneStepAt4time/aegis/issues/548)) ([37d9fe2](https://github.com/OneStepAt4time/aegis/commit/37d9fe211ee267f920b231e209d98d1a468afc35))
* include dashboard in npm package + add types/exports/homepage/bugs fields ([#539](https://github.com/OneStepAt4time/aegis/issues/539)) ([#546](https://github.com/OneStepAt4time/aegis/issues/546)) ([6f799f1](https://github.com/OneStepAt4time/aegis/commit/6f799f1f78ed496b6f593a10bf5b2a5f9b8d83e9))

## [2.2.0](https://github.com/OneStepAt4time/aegis/compare/v2.1.4...v2.2.0) (2026-03-29)


### Features

* move OpenClaw skill into repository for tracked versioning ([#543](https://github.com/OneStepAt4time/aegis/issues/543)) ([df7bf7b](https://github.com/OneStepAt4time/aegis/commit/df7bf7be05c9bfbc204e195a31b9be03d46a88a5))

## [2.1.4](https://github.com/OneStepAt4time/aegis/compare/v2.1.3...v2.1.4) (2026-03-29)


### Bug Fixes

* tech debt sweep — type safety + build + empty catch blocks ([#515](https://github.com/OneStepAt4time/aegis/issues/515)-[#519](https://github.com/OneStepAt4time/aegis/issues/519), [#523](https://github.com/OneStepAt4time/aegis/issues/523), [#525](https://github.com/OneStepAt4time/aegis/issues/525)) ([#537](https://github.com/OneStepAt4time/aegis/issues/537)) ([c8c55f6](https://github.com/OneStepAt4time/aegis/commit/c8c55f60f77dd7d2e8fb8a23d8e1bd79fcb53f1e))

## [2.1.3](https://github.com/OneStepAt4time/aegis/compare/v2.1.2...v2.1.3) (2026-03-29)


### Bug Fixes

* dashboard dedup bounded set + stable debounce refs ([#504](https://github.com/OneStepAt4time/aegis/issues/504), [#512](https://github.com/OneStepAt4time/aegis/issues/512), [#514](https://github.com/OneStepAt4time/aegis/issues/514)) ([#535](https://github.com/OneStepAt4time/aegis/issues/535)) ([f035c50](https://github.com/OneStepAt4time/aegis/commit/f035c5040f624dd546e8fa13fd909052bad615c4))
* use plain v{version} tags instead of aegis-bridge-v{version} ([90a5e07](https://github.com/OneStepAt4time/aegis/commit/90a5e0722183af62981b8dc6bf5f97f35f4e6bce))

## [2.1.2](https://github.com/OneStepAt4time/aegis/compare/aegis-bridge-v2.1.1...aegis-bridge-v2.1.2) (2026-03-29)


### Bug Fixes

* avoid Set deletion during iteration in processedStopSignals ([#510](https://github.com/OneStepAt4time/aegis/issues/510)) ([#532](https://github.com/OneStepAt4time/aegis/issues/532)) ([de22f07](https://github.com/OneStepAt4time/aegis/commit/de22f0703db6fd0a54be28009a18ed20d448def3))
* read version dynamically from package.json in MCP server test ([#534](https://github.com/OneStepAt4time/aegis/issues/534)) ([c4b648c](https://github.com/OneStepAt4time/aegis/commit/c4b648c09ab18577dda1185b65d61b87cf61bdb7))
* wrap SSE mutex await in try/finally to prevent deadlock ([#509](https://github.com/OneStepAt4time/aegis/issues/509)) ([#531](https://github.com/OneStepAt4time/aegis/issues/531)) ([1d624a0](https://github.com/OneStepAt4time/aegis/commit/1d624a0a32b72a53e58ed8bcc0aef83e2e5d22d9))

## [2.1.1](https://github.com/OneStepAt4time/aegis/compare/aegis-bridge-v2.1.0...aegis-bridge-v2.1.1) (2026-03-29)


### Bug Fixes

* resolve merge conflict markers in ws-terminal.ts ([530e7ce](https://github.com/OneStepAt4time/aegis/commit/530e7ce0c68a5a3a98f9526899888b1014e85e80))
* systematic input validation at external boundaries (Cluster 2) ([#528](https://github.com/OneStepAt4time/aegis/issues/528)) ([d6192e7](https://github.com/OneStepAt4time/aegis/commit/d6192e781328a6819e3a17546f2939f5bf197fba))
* WebSocket handshake auth + SSE subscription error handling ([#529](https://github.com/OneStepAt4time/aegis/issues/529)) ([f7088d2](https://github.com/OneStepAt4time/aegis/commit/f7088d20a711c4b3e24eabb320eb3354aff367f3))

## [2.1.0](https://github.com/OneStepAt4time/aegis/compare/aegis-bridge-v2.0.0...aegis-bridge-v2.1.0) (2026-03-29)


### Features

* **#161:** add CC hook endpoints for PermissionRequest and Stop ([738b9c2](https://github.com/OneStepAt4time/aegis/commit/738b9c2f6ade8ae3451d6563e5317f7430946493))
* **#161:** Phase 1 — CC hook endpoints for zero-latency events ([d92ad3a](https://github.com/OneStepAt4time/aegis/commit/d92ad3a40c865bdd4aae1e0d4e4cab0edbcddbd2))
* add .claude/ config — hooks, skills, settings for CC integration ([b5384fb](https://github.com/OneStepAt4time/aegis/commit/b5384fb8be0618e787c67e81fc2b0358f81d97c9))
* add batch session creation to CreateSessionModal ([#312](https://github.com/OneStepAt4time/aegis/issues/312)) ([a40fe97](https://github.com/OneStepAt4time/aegis/commit/a40fe9789392aa55651d932cf08cf4f4ad8a989e))
* add batch session creation UI ([#312](https://github.com/OneStepAt4time/aegis/issues/312)) ([206db55](https://github.com/OneStepAt4time/aegis/commit/206db55bc1ef6d11fe146a3b992cd8af56ee189b))
* add event ring buffer for Last-Event-ID replay ([#308](https://github.com/OneStepAt4time/aegis/issues/308)) ([b2b3875](https://github.com/OneStepAt4time/aegis/commit/b2b3875cee9914515093b78e56a2e77867ac0710))
* add live terminal with xterm.js and WebSocket ([#310](https://github.com/OneStepAt4time/aegis/issues/310)) ([46625d5](https://github.com/OneStepAt4time/aegis/commit/46625d5df1252bfd7b1c210f2b985df2ea928710))
* add live terminal with xterm.js and WebSocket ([#310](https://github.com/OneStepAt4time/aegis/issues/310)) ([32c6921](https://github.com/OneStepAt4time/aegis/commit/32c692191a838bde26ab06ad52141cb37b1bd333))
* add MCP prompts — implement_issue, review_pr, debug_session — Issue [#443](https://github.com/OneStepAt4time/aegis/issues/443) ([b425f33](https://github.com/OneStepAt4time/aegis/commit/b425f33608578814058a4cae4b12fc30214e7afb))
* add P0+P1+P2 MCP tools — kill, approve, reject, health, escape, interrupt, pane, metrics, summary, bash, command, latency, batch, pipelines, swarm — Issue [#441](https://github.com/OneStepAt4time/aegis/issues/441) ([247d936](https://github.com/OneStepAt4time/aegis/commit/247d93634650635edb55cd0644fa87290933c57c))
* add pipeline management page ([1e905f9](https://github.com/OneStepAt4time/aegis/commit/1e905f9884394b415a5e4698a241a7d0d6648273))
* add ResilientEventSource with backoff and circuit breaker ([#308](https://github.com/OneStepAt4time/aegis/issues/308)) ([043ad05](https://github.com/OneStepAt4time/aegis/commit/043ad058e446a123c8e914ac75ef22a64b2fff53))
* add shared SSRF validation utility — Issue [#346](https://github.com/OneStepAt4time/aegis/issues/346) ([18b1dba](https://github.com/OneStepAt4time/aegis/commit/18b1dbaaa4b6ba0e87e4015422b9a604dece7665))
* add webhook endpoint Zod schema — Issue [#346](https://github.com/OneStepAt4time/aegis/issues/346) ([629fdc9](https://github.com/OneStepAt4time/aegis/commit/629fdc9802d0232f44ca0afb1eb92c005cb80c4c))
* add Zod validation schemas for API routes — Issue [#359](https://github.com/OneStepAt4time/aegis/issues/359) ([7a2ab85](https://github.com/OneStepAt4time/aegis/commit/7a2ab85fb64510fe675d67af60acad2d46b78391))
* Aegis Dashboard MVP — overview + session detail + dark theme ([#90](https://github.com/OneStepAt4time/aegis/issues/90)) ([c8e0868](https://github.com/OneStepAt4time/aegis/commit/c8e086887523878a81f38bb6dd44ed09def0720a))
* API key management + auth middleware + rate limiting ([#39](https://github.com/OneStepAt4time/aegis/issues/39)) ([#41](https://github.com/OneStepAt4time/aegis/issues/41)) ([3b92d6d](https://github.com/OneStepAt4time/aegis/commit/3b92d6d41d7f9d8c0ebb8e88e2023437259fb809))
* **api:** session list pagination + paginated transcript endpoint ([#109](https://github.com/OneStepAt4time/aegis/issues/109)) ([eaea09b](https://github.com/OneStepAt4time/aegis/commit/eaea09bcfaee99d35a41f7689e954d68f4363639))
* **api:** session pagination + paginated transcript ([#109](https://github.com/OneStepAt4time/aegis/issues/109) Sprint 1) ([8813a5e](https://github.com/OneStepAt4time/aegis/commit/8813a5ec076ab4c77639c6e1f1ee582bb5a024ad))
* auto-approve mode for CI/batch workflows ([#26](https://github.com/OneStepAt4time/aegis/issues/26)) ([#30](https://github.com/OneStepAt4time/aegis/issues/30)) ([83f6273](https://github.com/OneStepAt4time/aegis/commit/83f62735d9def702b06a2942333235bf752e519a))
* automated release pipeline (npm publish + GitHub Releases) ([047c6af](https://github.com/OneStepAt4time/aegis/commit/047c6afe55a409c55c39dead5906519f472f7c74))
* automated release pipeline (npm publish + GitHub Releases) — Issue [#365](https://github.com/OneStepAt4time/aegis/issues/365) ([7fd11fe](https://github.com/OneStepAt4time/aegis/commit/7fd11fe6352253e6349b6acbdf810cbf506122f9))
* batch create + pipeline orchestration ([#36](https://github.com/OneStepAt4time/aegis/issues/36)) ([#38](https://github.com/OneStepAt4time/aegis/issues/38)) ([c1f702d](https://github.com/OneStepAt4time/aegis/commit/c1f702dc6c7b5366e7a0c234a5339305ecf73306))
* capture all CC SessionStart fields in hook + use transcript_path ([#77](https://github.com/OneStepAt4time/aegis/issues/77)) ([#97](https://github.com/OneStepAt4time/aegis/issues/97)) ([b38abef](https://github.com/OneStepAt4time/aegis/commit/b38abefe4cc1483f14535afcfcbd0ce33f922638))
* CLI entry point for npx aegis-bridge (issue [#5](https://github.com/OneStepAt4time/aegis/issues/5)) ([#14](https://github.com/OneStepAt4time/aegis/issues/14)) ([26efc49](https://github.com/OneStepAt4time/aegis/commit/26efc49d02b96cfb6e11d85d6705aa7b78f5ef8c))
* configurable per-session stall detection (issue [#4](https://github.com/OneStepAt4time/aegis/issues/4)) ([#13](https://github.com/OneStepAt4time/aegis/issues/13)) ([a38630d](https://github.com/OneStepAt4time/aegis/commit/a38630dac35bcf02b4d81d99e249808baf6fc897))
* Dashboard v2 Sprint 1 — Activity Stream, Create Session, Interact, Responsive ([#107](https://github.com/OneStepAt4time/aegis/issues/107)) ([a870adb](https://github.com/OneStepAt4time/aegis/commit/a870adb0a83a9fe6e68de52eb106e85799619d77))
* **dashboard:** Activity Stream, Create Session Modal, Message Input ([#107](https://github.com/OneStepAt4time/aegis/issues/107)) ([04dfd0f](https://github.com/OneStepAt4time/aegis/commit/04dfd0f2d708cb3538cc0800073f83b899f2cc3b))
* **dashboard:** add missing API client wrappers ([#149](https://github.com/OneStepAt4time/aegis/issues/149)) ([efd7c30](https://github.com/OneStepAt4time/aegis/commit/efd7c3089b35550c36ab72310bc750a877218608))
* **dashboard:** add missing API client wrappers ([#149](https://github.com/OneStepAt4time/aegis/issues/149)) ([9b13cd9](https://github.com/OneStepAt4time/aegis/commit/9b13cd9f3d5c10b521854f5ffabe4d1bfb607bfa))
* **dashboard:** add RowHealth type and atomic setSessionsAndHealth to store ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([646b61b](https://github.com/OneStepAt4time/aegis/commit/646b61b7fc4649f22b99d109685d3057bfc5f8a2))
* **dashboard:** add toast notifications for error handling ([#139](https://github.com/OneStepAt4time/aegis/issues/139)) ([70e6e54](https://github.com/OneStepAt4time/aegis/commit/70e6e544f01bde82428833a7ccc47d32f099c058))
* **dashboard:** add Zod runtime validation for API responses ([#129](https://github.com/OneStepAt4time/aegis/issues/129)) ([6dc6b72](https://github.com/OneStepAt4time/aegis/commit/6dc6b7269bbd555668f12dced1af6f9c51a06f0a))
* **dashboard:** ARIA accessibility + keyboard support ([#156](https://github.com/OneStepAt4time/aegis/issues/156)) ([79dade6](https://github.com/OneStepAt4time/aegis/commit/79dade6c93bc69178e56efc773dacafdf5ab7b3f))
* **dashboard:** ARIA accessibility + keyboard support ([#156](https://github.com/OneStepAt4time/aegis/issues/156)) ([544df88](https://github.com/OneStepAt4time/aegis/commit/544df88fc996b7f1d28766a04dca38ee71037bce))
* **dashboard:** consolidate polling loops via SSE ([#154](https://github.com/OneStepAt4time/aegis/issues/154)) ([9ab0463](https://github.com/OneStepAt4time/aegis/commit/9ab0463925e1a01b89ce255220552c81a9d91554))
* **dashboard:** consolidate polling via SSE ([#154](https://github.com/OneStepAt4time/aegis/issues/154)) ([3d9964b](https://github.com/OneStepAt4time/aegis/commit/3d9964b3d75219bb3bee69c6dad43785573c6a39))
* **dashboard:** responsive + mobile-friendly design ([#107](https://github.com/OneStepAt4time/aegis/issues/107)) ([b421d61](https://github.com/OneStepAt4time/aegis/commit/b421d6179ae934ab6d785ee4b29370a64c3bac69))
* **dashboard:** toast notifications for error handling ([#139](https://github.com/OneStepAt4time/aegis/issues/139)) ([3033718](https://github.com/OneStepAt4time/aegis/commit/3033718f96c6407d6f993446793aa8d82844368e))
* **dashboard:** Zod runtime validation for API responses ([#129](https://github.com/OneStepAt4time/aegis/issues/129)) ([ffcf400](https://github.com/OneStepAt4time/aegis/commit/ffcf400c51ba5875b85170b6336e201a08f909e0))
* defaultSessionEnv config + prompt on-create ([bc85a9e](https://github.com/OneStepAt4time/aegis/commit/bc85a9e1d1e81ea0880f8ccdf1687d0a27cb06ed))
* global SSE endpoint, paginated sessions, paginated transcript ([#107](https://github.com/OneStepAt4time/aegis/issues/107)) ([1d9a4b4](https://github.com/OneStepAt4time/aegis/commit/1d9a4b44d257777bbc5ea4c51cafa5b50a2ff570))
* headless question answering via PreToolUse hook ([54cf4b0](https://github.com/OneStepAt4time/aegis/commit/54cf4b01fcaec9df0753da491252aa6f01f0a263))
* **hooks:** add HTTP hook endpoint infrastructure ([#169](https://github.com/OneStepAt4time/aegis/issues/169) Phase 1) ([8cf9d24](https://github.com/OneStepAt4time/aegis/commit/8cf9d24fdcaf7a1fdf2b4a7c5301088b5227d3c9))
* **hooks:** expand to 14 CC hook events + full status mapping ([#85](https://github.com/OneStepAt4time/aegis/issues/85)) ([aad0a09](https://github.com/OneStepAt4time/aegis/commit/aad0a09c12f67a32d19489856c9b7e99b6e67c32))
* **hooks:** expand to 14 CC hook events + full status mapping ([#85](https://github.com/OneStepAt4time/aegis/issues/85)) ([a01bfec](https://github.com/OneStepAt4time/aegis/commit/a01bfecc271dd24f92ff51a635678c7107cbd473))
* **hooks:** hook-driven status detection + adaptive polling ([#169](https://github.com/OneStepAt4time/aegis/issues/169) Phase 3) ([6bc799c](https://github.com/OneStepAt4time/aegis/commit/6bc799cad5306f29f6ed326f8d159b3a86d3a43c))
* **hooks:** hook-driven status detection + adaptive polling ([#169](https://github.com/OneStepAt4time/aegis/issues/169) Phase 3) ([4a714ab](https://github.com/OneStepAt4time/aegis/commit/4a714abc0b207944a35a41e316d8eac4fb64f9f3))
* **hooks:** HTTP hook endpoint infrastructure ([#169](https://github.com/OneStepAt4time/aegis/issues/169) Phase 1) ([2111a4b](https://github.com/OneStepAt4time/aegis/commit/2111a4bb26aebc59e7c68f5c9936457d74935c72))
* **hooks:** inject CC settings.json with HTTP hooks ([#169](https://github.com/OneStepAt4time/aegis/issues/169) Phase 2) ([53ab344](https://github.com/OneStepAt4time/aegis/commit/53ab3445dd56be26a8b7614961d2be08d5d6dd44))
* **hooks:** inject CC settings.json with HTTP hooks on session create ([#169](https://github.com/OneStepAt4time/aegis/issues/169) Phase 2) ([9706b77](https://github.com/OneStepAt4time/aegis/commit/9706b771bd949dac8f8ac296a740a98091ffc313))
* **hooks:** PreCompact/PostCompact/Notification/Elicitation support ([5ac740d](https://github.com/OneStepAt4time/aegis/commit/5ac740dcf79b37530a14054e90ebdd4270f9d089))
* **hooks:** PreCompact/PostCompact/Notification/FileChanged/CwdChanged/Elicitation support ([0dcb03b](https://github.com/OneStepAt4time/aegis/commit/0dcb03bb824d6f16a5bdaed4883eddfe0188736d))
* **hooks:** subagent lifecycle tracking ([#88](https://github.com/OneStepAt4time/aegis/issues/88)) ([66eacda](https://github.com/OneStepAt4time/aegis/commit/66eacdac83669a094a9002a86c084587b2ea58fc))
* **hooks:** subagent lifecycle tracking ([#88](https://github.com/OneStepAt4time/aegis/issues/88)) ([c29e355](https://github.com/OneStepAt4time/aegis/commit/c29e355df88dc3c3ddf6d9ff85d800fb6ff37f59))
* initial release — migrate from cc-bridge (manus) ([50b9d1c](https://github.com/OneStepAt4time/aegis/commit/50b9d1cdc6babe8141d4e1e77cef030dd1a2d8f0))
* inline keyboard buttons for Telegram ([#57](https://github.com/OneStepAt4time/aegis/issues/57)) ([c385888](https://github.com/OneStepAt4time/aegis/commit/c3858888012aa99d536080637fde0787df0af9f6))
* MCP Prompts — workflow templates for common tasks — Issue [#443](https://github.com/OneStepAt4time/aegis/issues/443) ([46f1c67](https://github.com/OneStepAt4time/aegis/commit/46f1c678a0fefde22a590ead195712b158423082))
* MCP Resources — 4 resources for session data — Issue [#442](https://github.com/OneStepAt4time/aegis/issues/442) ([217f67f](https://github.com/OneStepAt4time/aegis/commit/217f67f95842f55b6f6f05c6adb3cf7b904302c0))
* MCP Resources — expose session data as readable resources — Issue [#442](https://github.com/OneStepAt4time/aegis/issues/442) ([3d42e35](https://github.com/OneStepAt4time/aegis/commit/3d42e354dcac9cc8cf44db86cdcc4f124eb2bf92))
* MCP server mode — expose Aegis as CC tools ([#48](https://github.com/OneStepAt4time/aegis/issues/48)) ([#49](https://github.com/OneStepAt4time/aegis/issues/49)) ([15cb368](https://github.com/OneStepAt4time/aegis/commit/15cb3687abbd87892c5a5624b889d2f83ba919a6))
* MCP tool completeness — expose all REST endpoints as MCP tools — Issue [#441](https://github.com/OneStepAt4time/aegis/issues/441) ([c3ab0a7](https://github.com/OneStepAt4time/aegis/commit/c3ab0a77f867ed2b5ad984b99902a0df485726bb))
* metrics + usage data endpoints ([#40](https://github.com/OneStepAt4time/aegis/issues/40)) ([#42](https://github.com/OneStepAt4time/aegis/issues/42)) ([47c33ca](https://github.com/OneStepAt4time/aegis/commit/47c33ca0816720bde57e961010711a3f65c3098f))
* **metrics:** latency tracking + per-session latency endpoint ([#87](https://github.com/OneStepAt4time/aegis/issues/87)) ([b1e2619](https://github.com/OneStepAt4time/aegis/commit/b1e2619a91b118e9ed4ac56ad487b5e16ee9efa6))
* **metrics:** latency tracking + per-session latency endpoint ([#87](https://github.com/OneStepAt4time/aegis/issues/87)) ([3d0ea4a](https://github.com/OneStepAt4time/aegis/commit/3d0ea4a9ebb0b47e76beed2ab0d167130b78a36e))
* **monitor:** fs.watch-based JSONL monitoring ([#84](https://github.com/OneStepAt4time/aegis/issues/84)) ([2b74555](https://github.com/OneStepAt4time/aegis/commit/2b74555aa9b4dcd808b2709c2e4813965c21bd82))
* **monitor:** fs.watch-based JSONL monitoring ([#84](https://github.com/OneStepAt4time/aegis/issues/84)) ([4fca461](https://github.com/OneStepAt4time/aegis/commit/4fca461a1da1c76bf34e9909de15a82ab44d0ef8))
* permission_prompt action hints + CLI create subcommand ([#21](https://github.com/OneStepAt4time/aegis/issues/21)) ([ab27bb4](https://github.com/OneStepAt4time/aegis/commit/ab27bb4edb3a1231e42362cfd61ea70ff2638de0))
* prompt delivery verification via capture-pane (issue [#1](https://github.com/OneStepAt4time/aegis/issues/1)) ([#10](https://github.com/OneStepAt4time/aegis/issues/10)) ([75564a1](https://github.com/OneStepAt4time/aegis/commit/75564a158b1e9d6022abe0e7ecd541e2e32d75ba))
* screenshot capture endpoint via Playwright (Issue [#22](https://github.com/OneStepAt4time/aegis/issues/22)) ([ede886a](https://github.com/OneStepAt4time/aegis/commit/ede886a733847f8ba8db05067f520f9d437ca7d7))
* session health check endpoint (issue [#2](https://github.com/OneStepAt4time/aegis/issues/2)) ([#12](https://github.com/OneStepAt4time/aegis/issues/12)) ([cfdb22b](https://github.com/OneStepAt4time/aegis/commit/cfdb22b2f9aa86e56665254112e1b3efe1dfa8d4))
* session persistence, orphan adoption, summary endpoint ([#35](https://github.com/OneStepAt4time/aegis/issues/35)) ([#37](https://github.com/OneStepAt4time/aegis/issues/37)) ([d01fec8](https://github.com/OneStepAt4time/aegis/commit/d01fec824bad7f9179e2de4041612ece6373d70c))
* smart stall detection — 4 stall types with graduated thresholds ([#55](https://github.com/OneStepAt4time/aegis/issues/55)) ([dd2c733](https://github.com/OneStepAt4time/aegis/commit/dd2c733260f1e0d665e7b694446a01a00e6bf475))
* SSE event stream for real-time session monitoring ([#32](https://github.com/OneStepAt4time/aegis/issues/32)) ([#34](https://github.com/OneStepAt4time/aegis/issues/34)) ([4cf07c2](https://github.com/OneStepAt4time/aegis/commit/4cf07c2315d1fb492f54848f898f079dc0a54ef5))
* StopFailure hook support for CC error detection (issue [#15](https://github.com/OneStepAt4time/aegis/issues/15)) ([#17](https://github.com/OneStepAt4time/aegis/issues/17)) ([b7196c0](https://github.com/OneStepAt4time/aegis/commit/b7196c08f968e47f9567b1b88ddf49c070f66ae1))
* **swarm:** agent swarm awareness — detect CC teammate sessions ([#81](https://github.com/OneStepAt4time/aegis/issues/81)) ([1aa7591](https://github.com/OneStepAt4time/aegis/commit/1aa7591922607c866dc83445322e0732762af189))
* **swarm:** agent swarm awareness ([#81](https://github.com/OneStepAt4time/aegis/issues/81)) ([3acb890](https://github.com/OneStepAt4time/aegis/commit/3acb890b259c13b25b4d1b3888e5a74e698b53df))
* Telegram Style Guide — 6 standard message types with inline keyboards ([#51](https://github.com/OneStepAt4time/aegis/issues/51)) ([f9c6f02](https://github.com/OneStepAt4time/aegis/commit/f9c6f0243398fbde2563912886b7a561e71e10e1))
* Telegram style guide + formatting rework ([#50](https://github.com/OneStepAt4time/aegis/issues/50)) ([4b70b60](https://github.com/OneStepAt4time/aegis/commit/4b70b60c10d4a25a721d73d0fff800aadceac476))
* **telegram:** teammate/subagent awareness + /swarm command ([#71](https://github.com/OneStepAt4time/aegis/issues/71)) ([b5b1344](https://github.com/OneStepAt4time/aegis/commit/b5b134424fede64e06c68524aedc27c6ac1380e4))
* **telegram:** teammate/subagent awareness + /swarm command ([#71](https://github.com/OneStepAt4time/aegis/issues/71)) ([c7a3cb4](https://github.com/OneStepAt4time/aegis/commit/c7a3cb497d44b26aecd51a40e54969a424e892e1))
* **tmux:** set pane title to session name ([#82](https://github.com/OneStepAt4time/aegis/issues/82)) ([7cdaece](https://github.com/OneStepAt4time/aegis/commit/7cdaece0bc8a3b5bd7f4749b5fe81ef8f72959c7))
* **tmux:** set pane title to session name for debugging ([#82](https://github.com/OneStepAt4time/aegis/issues/82)) ([7e58314](https://github.com/OneStepAt4time/aegis/commit/7e583142062f52c3ba400f7c5395adf11b7b1d2d))
* **tmux:** socket isolation via -L aegis-{pid} ([#83](https://github.com/OneStepAt4time/aegis/issues/83)) ([d759d4d](https://github.com/OneStepAt4time/aegis/commit/d759d4debee4fe78c82129065f0903759bfe83f2))
* **tmux:** socket isolation via -L aegis-{pid} ([#83](https://github.com/OneStepAt4time/aegis/issues/83)) ([2bd6559](https://github.com/OneStepAt4time/aegis/commit/2bd65593366ff6ba791e1050ea71d7dc0bf09728))
* validate webhook URLs in fromEnv() with Zod + SSRF checks — Issue [#346](https://github.com/OneStepAt4time/aegis/issues/346) ([f5ad1dc](https://github.com/OneStepAt4time/aegis/commit/f5ad1dc88a49b3e1d61dd7f201ad2dc9814b388d))
* webhook delivery with retry + exponential backoff ([#25](https://github.com/OneStepAt4time/aegis/issues/25)) ([#29](https://github.com/OneStepAt4time/aegis/issues/29)) ([081d09c](https://github.com/OneStepAt4time/aegis/commit/081d09c65f64de96342d96871d21ea2d5c111ccc))
* workflow automation hooks + flaky test fix ([#321](https://github.com/OneStepAt4time/aegis/issues/321)) ([ef16f27](https://github.com/OneStepAt4time/aegis/commit/ef16f27b43f29e3d2f5beec3713d2d5c76eb01f4))
* **ws:** WebSocket terminal streaming endpoint ([#108](https://github.com/OneStepAt4time/aegis/issues/108) Sprint 3) ([213e6e0](https://github.com/OneStepAt4time/aegis/commit/213e6e078020b5320f72b6686d44f26c2d0715ae))
* **ws:** WebSocket terminal streaming endpoint ([#108](https://github.com/OneStepAt4time/aegis/issues/108) Sprint 3) ([46f7224](https://github.com/OneStepAt4time/aegis/commit/46f7224a12490f4247bff60967944558e227bb79))


### Bug Fixes

* **#120:** getSessions() return type now matches server pagination envelope ([165d3d1](https://github.com/OneStepAt4time/aegis/commit/165d3d1ef00cb0202cac8cbe4e9a2b2ef9377d2d)), closes [#120](https://github.com/OneStepAt4time/aegis/issues/120)
* **#121:** wire up global SSE in Layout.tsx ([114097e](https://github.com/OneStepAt4time/aegis/commit/114097e0d1f5328d447f77f703534dfaf834516f)), closes [#121](https://github.com/OneStepAt4time/aegis/issues/121)
* **#122:** SessionTable now uses Zustand store for sessions ([6afe925](https://github.com/OneStepAt4time/aegis/commit/6afe9250901b40ef8187e1bd2223971cec50cc17)), closes [#122](https://github.com/OneStepAt4time/aegis/issues/122)
* **#123:** MetricCards now uses Zustand store for metrics ([eb5e724](https://github.com/OneStepAt4time/aegis/commit/eb5e72459f9d8b1f1bc988ddbeb86f7d9334294c)), closes [#123](https://github.com/OneStepAt4time/aegis/issues/123)
* **#124,#125:** auth token support for SSE via query param fallback ([29337c2](https://github.com/OneStepAt4time/aegis/commit/29337c2153c1866e8d7ad312d336123a5046cc3d)), closes [#124](https://github.com/OneStepAt4time/aegis/issues/124) [#125](https://github.com/OneStepAt4time/aegis/issues/125)
* **#126:** exclude /dashboard from auth middleware ([89edcdf](https://github.com/OneStepAt4time/aegis/commit/89edcdf2fb3e5b315f9062ddda365611f49731f9)), closes [#126](https://github.com/OneStepAt4time/aegis/issues/126)
* **#127:** graceful handling when dashboard/dist is missing ([675c03c](https://github.com/OneStepAt4time/aegis/commit/675c03c07058ac715bceb50933e0d03eeee4cd39)), closes [#127](https://github.com/OneStepAt4time/aegis/issues/127)
* **#128:** add bulk /v1/sessions/health endpoint + use in SessionTable ([07d7ce7](https://github.com/OneStepAt4time/aegis/commit/07d7ce78fed7e1616baa0d9311d0aeb7ea6813bd)), closes [#128](https://github.com/OneStepAt4time/aegis/issues/128)
* **#128:** parallelize health checks with Promise.allSettled ([a7ed3aa](https://github.com/OneStepAt4time/aegis/commit/a7ed3aafd3778fae78b8aa4dd32e967e5ae5d98c)), closes [#128](https://github.com/OneStepAt4time/aegis/issues/128)
* **#162:** add PID file to prevent peer Aegis mutual kill ([93c42a7](https://github.com/OneStepAt4time/aegis/commit/93c42a7ab2ec6466e13c1b38e09fa67b56386304))
* **#162:** add PID file to prevent peer Aegis mutual kill ([25ac4e8](https://github.com/OneStepAt4time/aegis/commit/25ac4e85bfa0f175be9f95d8d67c2f824b65e42a))
* **#162:** fix PID file race — write after listen, not before ([5f7f322](https://github.com/OneStepAt4time/aegis/commit/5f7f322807b55ebc2b86d90b4885011e8548432a))
* **#162:** harden EADDRINUSE recovery against race condition ([735ea67](https://github.com/OneStepAt4time/aegis/commit/735ea67c3aa5804c4dd0786515ebe45bbee1d0d9))
* **#162:** harden EADDRINUSE recovery against race condition ([4af60a6](https://github.com/OneStepAt4time/aegis/commit/4af60a6fbb28b3c9962678e767a57480b31a0de7)), closes [#162](https://github.com/OneStepAt4time/aegis/issues/162)
* **#162:** move writePidFile after listenWithRetry to prevent race condition ([637e04c](https://github.com/OneStepAt4time/aegis/commit/637e04c026d69ae0825c0afb8520c39aa76b9a6c))
* 4 Telegram formatting bugs from live testing ([#52](https://github.com/OneStepAt4time/aegis/issues/52)) ([94b5c2e](https://github.com/OneStepAt4time/aegis/commit/94b5c2e7198de3df9bb85b44405fbc1da3577a39))
* 404 detection uses statusCode instead of string matching ([#143](https://github.com/OneStepAt4time/aegis/issues/143)) ([2b38e64](https://github.com/OneStepAt4time/aegis/commit/2b38e6435217d10dd5a660386b3f9849f09c2e16))
* 7 Telegram formatting bugs from Ema's live testing ([#56](https://github.com/OneStepAt4time/aegis/issues/56)) ([3893d34](https://github.com/OneStepAt4time/aegis/commit/3893d34b72e2b40b2e8b9a1598ab250230a928c7))
* accept targetMode in permission-guard for acceptEdits/plan/dontAsk/auto modes ([a8160a8](https://github.com/OneStepAt4time/aegis/commit/a8160a8bebe357e2ccc1820ec7d2adbf90698422))
* add asterisk and bullet to STATUS_SPINNERS — detect Perambulating state ([#102](https://github.com/OneStepAt4time/aegis/issues/102)) ([#103](https://github.com/OneStepAt4time/aegis/issues/103)) ([d74f40b](https://github.com/OneStepAt4time/aegis/commit/d74f40bd76bb51b8b92e56b38d790ab675ad95c7))
* add braille spinner chars to terminal parser ([#65](https://github.com/OneStepAt4time/aegis/issues/65)) ([#94](https://github.com/OneStepAt4time/aegis/issues/94)) ([30398a7](https://github.com/OneStepAt4time/aegis/commit/30398a70a24eeab5e7f4ba1cbe7c8595423612fe))
* add catch handlers to fire-and-forget monitor operations ([#404](https://github.com/OneStepAt4time/aegis/issues/404)) ([#497](https://github.com/OneStepAt4time/aegis/issues/497)) ([3b1c36e](https://github.com/OneStepAt4time/aegis/commit/3b1c36e23dc96b57f6a6916d93c1577de144df59))
* add error state to terminal parser for silent error detection ([3eec75d](https://github.com/OneStepAt4time/aegis/commit/3eec75dc3e37bc5df403a97924f63d015778c05e))
* add error state to terminal parser for silent error detection ([5ab0307](https://github.com/OneStepAt4time/aegis/commit/5ab03077c8f143678df772c16a3775cfcb884bc5))
* add global event ring buffer and Last-Event-ID replay ([3592e0d](https://github.com/OneStepAt4time/aegis/commit/3592e0d41cb85a63c4507817f3861371e53db4ae))
* add global event ring buffer and Last-Event-ID replay ([#301](https://github.com/OneStepAt4time/aegis/issues/301)) ([d77b77f](https://github.com/OneStepAt4time/aegis/commit/d77b77f0c5e4e5cddbedb2233631200ed8f8aec2))
* add Last-Event-ID replay, idle SSE timeout, remove duplicate route ([#308](https://github.com/OneStepAt4time/aegis/issues/308)) ([13c8538](https://github.com/OneStepAt4time/aegis/commit/13c8538c399d648878b0a1892d1ad4a68368d25b))
* add missing SSE event types to dashboard frontend ([d05db05](https://github.com/OneStepAt4time/aegis/commit/d05db057c74baffb86ebf1ecf5ba4081c7f21f36))
* add missing SSE event types to dashboard frontend ([#307](https://github.com/OneStepAt4time/aegis/issues/307)) ([603ba76](https://github.com/OneStepAt4time/aegis/commit/603ba76f7d1aec44e2d87cb8bcaf30777c5493bf))
* add mutex/serialization queue for tmux operations ([592bc58](https://github.com/OneStepAt4time/aegis/commit/592bc586078ed17cb88f6827a6f2062525a21324))
* add mutex/serialization queue for tmux operations ([812a46b](https://github.com/OneStepAt4time/aegis/commit/812a46b12ef7853ef73ed48bfe7743a2e7dfb506))
* add NaN/isFinite guards on config env var parsing — Issue [#359](https://github.com/OneStepAt4time/aegis/issues/359) ([9413006](https://github.com/OneStepAt4time/aegis/commit/94130069cd9813ffab9cadc841b0311c6079afcd))
* add permission_request contentType case to MessageBubble switch ([#155](https://github.com/OneStepAt4time/aegis/issues/155)) ([d6e1794](https://github.com/OneStepAt4time/aegis/commit/d6e179406dfde1ed111e35c03e97ee913561a445))
* add permission_request contentType case to MessageBubble switch ([#155](https://github.com/OneStepAt4time/aegis/issues/155)) ([196ed49](https://github.com/OneStepAt4time/aegis/commit/196ed49fb951ad7908fd3c3c88f569dc664ddd6c))
* add random suffix to auth test tmpFile to prevent parallel test collisions ([5fdf761](https://github.com/OneStepAt4time/aegis/commit/5fdf7616f5aa32427277a3a419b2c161f5319292))
* add runtime type guards to ActivityStream describeEvent ([#423](https://github.com/OneStepAt4time/aegis/issues/423)) ([#493](https://github.com/OneStepAt4time/aegis/issues/493)) ([87999d3](https://github.com/OneStepAt4time/aegis/commit/87999d3c66d3d89f832f15ef3e5077ecc40a54fd))
* add security headers ([#145](https://github.com/OneStepAt4time/aegis/issues/145)) and cache-control ([#146](https://github.com/OneStepAt4time/aegis/issues/146)) for dashboard ([9b97d1c](https://github.com/OneStepAt4time/aegis/commit/9b97d1cdcb4ddda7333f28c948e3ccd9a3c83426))
* add SSE connection limits ([ccd6b7c](https://github.com/OneStepAt4time/aegis/commit/ccd6b7cb6ec0c8e53fc0cc678a179b91be52b2b0)), closes [#300](https://github.com/OneStepAt4time/aegis/issues/300)
* add subagent event entries to EVENT_META in ActivityStream ([#307](https://github.com/OneStepAt4time/aegis/issues/307)) ([f2e680a](https://github.com/OneStepAt4time/aegis/commit/f2e680a1e08c08a2dd44d4f2dd740f9e49222fb8))
* add timeout to all tmux commands — hang prevention ([#66](https://github.com/OneStepAt4time/aegis/issues/66)) ([#91](https://github.com/OneStepAt4time/aegis/issues/91)) ([17972de](https://github.com/OneStepAt4time/aegis/commit/17972de476eb10937fe265020f0f7e3b870cab35))
* add Zod safeParse validation to all API routes — Issue [#359](https://github.com/OneStepAt4time/aegis/issues/359) ([004ebb5](https://github.com/OneStepAt4time/aegis/commit/004ebb5787c6e1f9bbff68cc95ffe30b76c42b5d))
* add Zod schemas for getSessionMessages and getMetrics ([#407](https://github.com/OneStepAt4time/aegis/issues/407)) ([#501](https://github.com/OneStepAt4time/aegis/issues/501)) ([5272cf5](https://github.com/OneStepAt4time/aegis/commit/5272cf5ce5572e8e40667103342c2055be36cb65))
* add Zod validation at all JSON.parse boundaries ([#410](https://github.com/OneStepAt4time/aegis/issues/410)) ([#492](https://github.com/OneStepAt4time/aegis/issues/492)) ([8197c57](https://github.com/OneStepAt4time/aegis/commit/8197c577e939fee8511dd4cd9a1b820462758ff5))
* address review issues in batch modal ([#312](https://github.com/OneStepAt4time/aegis/issues/312)) ([3f843ff](https://github.com/OneStepAt4time/aegis/commit/3f843ff161f1beb5d3d574aa3e98c4dad098c747))
* always run filesystem discovery as fallback (field bug) ([#19](https://github.com/OneStepAt4time/aegis/issues/19)) ([f1737e3](https://github.com/OneStepAt4time/aegis/commit/f1737e3c05f19e422fb08511160a1ff64cce5dba))
* atomically check+create tmux window name ([#403](https://github.com/OneStepAt4time/aegis/issues/403)) ([#499](https://github.com/OneStepAt4time/aegis/issues/499)) ([5606a9b](https://github.com/OneStepAt4time/aegis/commit/5606a9b19daa759eef6d5dba42626573e1b87428))
* auth bypass via broad path matching — Issue [#349](https://github.com/OneStepAt4time/aegis/issues/349) ([8bf8fde](https://github.com/OneStepAt4time/aegis/commit/8bf8fde4e07fd634c1ccdc2a141ef9b8531c07fc))
* auth bypass via broad path matching in middleware — Issue [#349](https://github.com/OneStepAt4time/aegis/issues/349) ([a7c6146](https://github.com/OneStepAt4time/aegis/commit/a7c6146dbc15e802ce4ce55ee59d04bc0af8f403))
* authentication on inbound Telegram messages — Issue [#348](https://github.com/OneStepAt4time/aegis/issues/348) ([8b2b41f](https://github.com/OneStepAt4time/aegis/commit/8b2b41f4bc6ad84278da6aed25547174b886aebc))
* authentication on inbound Telegram messages — Issue [#348](https://github.com/OneStepAt4time/aegis/issues/348) ([43d37ab](https://github.com/OneStepAt4time/aegis/commit/43d37ab7685abf39b597ee3821680e47c37b6687))
* auto-create workDir before tmux window creation ([#31](https://github.com/OneStepAt4time/aegis/issues/31)) ([#33](https://github.com/OneStepAt4time/aegis/issues/33)) ([54c5317](https://github.com/OneStepAt4time/aegis/commit/54c5317dd57484ac6708e81bc0ecd3114f96cac1))
* **backend:** pipeline cleanup, streaming JSONL, SSE cleanup, emitter flag, unhandledRejection ([#221](https://github.com/OneStepAt4time/aegis/issues/221) [#222](https://github.com/OneStepAt4time/aegis/issues/222) [#223](https://github.com/OneStepAt4time/aegis/issues/223) [#224](https://github.com/OneStepAt4time/aegis/issues/224) [#225](https://github.com/OneStepAt4time/aegis/issues/225)) ([e4cd4b9](https://github.com/OneStepAt4time/aegis/commit/e4cd4b93ce576ddc4099d773714e5b48e090da1c))
* **backend:** pipeline cleanup, streaming JSONL, SSE fixes, unhandledRejection ([#221](https://github.com/OneStepAt4time/aegis/issues/221)-[#225](https://github.com/OneStepAt4time/aegis/issues/225)) ([b39ed99](https://github.com/OneStepAt4time/aegis/commit/b39ed99b7c89c0dad70b7f127f931338cce0cf77))
* batch of 3 dashboard bugs ([#133](https://github.com/OneStepAt4time/aegis/issues/133), [#132](https://github.com/OneStepAt4time/aegis/issues/132), [#131](https://github.com/OneStepAt4time/aegis/issues/131)) ([813a5c0](https://github.com/OneStepAt4time/aegis/commit/813a5c04cf3778fb5d558c419709f260b70994cd))
* bypass tmux queue for sendInitialPrompt critical path ([92b821d](https://github.com/OneStepAt4time/aegis/commit/92b821d65b740ad8cea8935d1534cb5cef690965))
* cap TranscriptViewer messages to prevent unbounded growth ([#296](https://github.com/OneStepAt4time/aegis/issues/296)) ([b3a3c77](https://github.com/OneStepAt4time/aegis/commit/b3a3c7740c2121f3e1b0605861276d342dc75407))
* channel reliability — circuit breaker + jitter ([bfcb220](https://github.com/OneStepAt4time/aegis/commit/bfcb220593b2cefbf5ebd4907f4f096827bf7668))
* channel reliability — circuit breaker + jitter ([fdafa6d](https://github.com/OneStepAt4time/aegis/commit/fdafa6df17aae3fde5904e7da0a005cad9818639))
* **ci:** add root vitest config and dashboard test step to CI ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([f8f1ff5](https://github.com/OneStepAt4time/aegis/commit/f8f1ff5b8064b0d7246ff5bce96b826b9ec20b9b))
* **ci:** move audit step before build steps ([760dfbe](https://github.com/OneStepAt4time/aegis/commit/760dfbed2cc289d7eb33114426a33a9e671852da))
* **ci:** remove JSON comment from dashboard/package.json ([#245](https://github.com/OneStepAt4time/aegis/issues/245) followup) ([c96f63c](https://github.com/OneStepAt4time/aegis/commit/c96f63c21f9543d46ca547a2c2aef26fa3c407ec))
* clamp WebSocket viewport dimensions to 1-1000 — Issue [#359](https://github.com/OneStepAt4time/aegis/issues/359) ([ffd5fa8](https://github.com/OneStepAt4time/aegis/commit/ffd5fa852c219a61a28c5ba7ee86ad01442ada5a))
* clean stateSince entries on non-idle state transitions ([#258](https://github.com/OneStepAt4time/aegis/issues/258)) ([af205a9](https://github.com/OneStepAt4time/aegis/commit/af205a97fef3fe6031c1cd467b0213a499ace05e))
* clean stateSince entries on non-idle transitions ([#258](https://github.com/OneStepAt4time/aegis/issues/258)) ([124dd46](https://github.com/OneStepAt4time/aegis/commit/124dd46805be22a8ee3f42ede5f6f70376a47f1e))
* clear tracking maps on session kill to prevent memory leak ([#405](https://github.com/OneStepAt4time/aegis/issues/405)) ([#500](https://github.com/OneStepAt4time/aegis/issues/500)) ([15ec6c1](https://github.com/OneStepAt4time/aegis/commit/15ec6c1c4b0b476a8918ebe49b842256a9a46949))
* close SSE connection on async component unmount ([#416](https://github.com/OneStepAt4time/aegis/issues/416)) ([#495](https://github.com/OneStepAt4time/aegis/issues/495)) ([3ef0ffc](https://github.com/OneStepAt4time/aegis/commit/3ef0ffced63b496a1084dc7a2c8599400eaa81f4))
* close SSE connection on async component unmount ([#494](https://github.com/OneStepAt4time/aegis/issues/494)) ([cfdd783](https://github.com/OneStepAt4time/aegis/commit/cfdd783debc1222aed344586f50f7a03d358abce))
* **cluster1:** version alignment + Zod 4 migration + Vitest 4 test fixes ([#526](https://github.com/OneStepAt4time/aegis/issues/526)) ([3c12f05](https://github.com/OneStepAt4time/aegis/commit/3c12f05500daca25650ede7cd4cbd8e10e935ec7))
* command injection in hook.ts via TMUX_PANE — Issue [#347](https://github.com/OneStepAt4time/aegis/issues/347) ([2216973](https://github.com/OneStepAt4time/aegis/commit/22169736187ba181d13205186b2edd840032b121))
* command injection in hook.ts via TMUX_PANE env var — Issue [#347](https://github.com/OneStepAt4time/aegis/issues/347) ([6bce734](https://github.com/OneStepAt4time/aegis/commit/6bce7349a50f97cffb77f8e577669aeba0f9dcba))
* correct batchCreateSessions return type to match backend ([#312](https://github.com/OneStepAt4time/aegis/issues/312)) ([54e478a](https://github.com/OneStepAt4time/aegis/commit/54e478ad9c65005c985e6d15f2ea65a67b1b239d))
* correct README field name brief→prompt and update stale badges — Issue [#396](https://github.com/OneStepAt4time/aegis/issues/396) ([da18754](https://github.com/OneStepAt4time/aegis/commit/da18754452aa258664db793807fdf912f6da9c01))
* correct README field name brief→prompt and update stale badges — Issue [#396](https://github.com/OneStepAt4time/aegis/issues/396) ([18774d3](https://github.com/OneStepAt4time/aegis/commit/18774d3dd9ad40f8debc1b984ebdac3fee58457e))
* **critical:** MCP listSessions extracts .sessions from paginated response ([#254](https://github.com/OneStepAt4time/aegis/issues/254)) ([27bd8a2](https://github.com/OneStepAt4time/aegis/commit/27bd8a24f3b8283345deec077180ff35c51ee42d))
* **critical:** MCP listSessions extracts .sessions from paginated response ([#254](https://github.com/OneStepAt4time/aegis/issues/254)) ([d8d8e3a](https://github.com/OneStepAt4time/aegis/commit/d8d8e3a741937bc5d784b8c7d48778ff195673b5))
* **critical:** move useToastStore before conditional returns ([#231](https://github.com/OneStepAt4time/aegis/issues/231)) ([43ec3e8](https://github.com/OneStepAt4time/aegis/commit/43ec3e8a0d9a760f29ca3a09f6116bc442eb291c))
* **critical:** state persistence race, pipeline config, stopSignals leak ([#218](https://github.com/OneStepAt4time/aegis/issues/218) [#219](https://github.com/OneStepAt4time/aegis/issues/219) [#220](https://github.com/OneStepAt4time/aegis/issues/220)) ([366240d](https://github.com/OneStepAt4time/aegis/commit/366240dba9a643363c358507677a66612717991e))
* **critical:** state persistence race, pipeline stage config, stopSignals leak ([#218](https://github.com/OneStepAt4time/aegis/issues/218) [#219](https://github.com/OneStepAt4time/aegis/issues/219) [#220](https://github.com/OneStepAt4time/aegis/issues/220)) ([568540b](https://github.com/OneStepAt4time/aegis/commit/568540b2ec26d037e0a82886ad912ae33ba6ed51))
* dashboard 500 error — reply.sendFile not a function ([118d883](https://github.com/OneStepAt4time/aegis/commit/118d88339f3be5f361d1ad7e567a62f13da04b84))
* dashboard blank page — Vite base, Router basename, static middleware ([#105](https://github.com/OneStepAt4time/aegis/issues/105)) ([7e3f55a](https://github.com/OneStepAt4time/aegis/commit/7e3f55a1fca56a372bf80e1dc993cbe47e415d77))
* dashboard blank page — Vite base, Router basename, static middleware ([#105](https://github.com/OneStepAt4time/aegis/issues/105)) ([9868e10](https://github.com/OneStepAt4time/aegis/commit/9868e10f5954312a45260328486f262a22da30d8))
* dashboard crash on undefined sessionId ([#294](https://github.com/OneStepAt4time/aegis/issues/294)) ([db32456](https://github.com/OneStepAt4time/aegis/commit/db32456d21bff809eba6f059280db6df3771a101))
* **dashboard:** [#157](https://github.com/OneStepAt4time/aegis/issues/157) React key, [#160](https://github.com/OneStepAt4time/aegis/issues/160) Firefox scrollbar + test warn ([8a6b2a6](https://github.com/OneStepAt4time/aegis/commit/8a6b2a618db3bdc95bb0848671355ba01e20f2fb))
* **dashboard:** abort previous request on double-submit in CreateSessionModal ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([c532aa2](https://github.com/OneStepAt4time/aegis/commit/c532aa2ae51c242c54ed48d725cd2ddd38666041))
* **dashboard:** AbortSignal + retry logic ([#150](https://github.com/OneStepAt4time/aegis/issues/150), [#151](https://github.com/OneStepAt4time/aegis/issues/151)) ([e01b080](https://github.com/OneStepAt4time/aegis/commit/e01b080ae5ae792cb7517d1e7580ebe6a7321ec1))
* **dashboard:** add AbortSignal support ([#150](https://github.com/OneStepAt4time/aegis/issues/150)) + retry logic ([#151](https://github.com/OneStepAt4time/aegis/issues/151)) ([d0bd107](https://github.com/OneStepAt4time/aegis/commit/d0bd1073765d7a11145ccec59c466a11e0f94545))
* **dashboard:** add click-to-expand for ApprovalBanner prompt ([#142](https://github.com/OneStepAt4time/aegis/issues/142)) ([24d9480](https://github.com/OneStepAt4time/aegis/commit/24d9480bed6fdfeeea95306ece3cf250ddea745a))
* **dashboard:** add click-to-expand for ApprovalBanner prompt ([#142](https://github.com/OneStepAt4time/aegis/issues/142)) ([826b1d4](https://github.com/OneStepAt4time/aegis/commit/826b1d452e86bbbaf7a3968eabdee04d4bb0a9a4))
* **dashboard:** atomic sessions + healthMap update in SessionTable ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([e43737b](https://github.com/OneStepAt4time/aegis/commit/e43737be6f8eb25a6f564f191f1b87845a2c79f2))
* **dashboard:** batch fix [#130](https://github.com/OneStepAt4time/aegis/issues/130) [#148](https://github.com/OneStepAt4time/aegis/issues/148) [#131](https://github.com/OneStepAt4time/aegis/issues/131) [#132](https://github.com/OneStepAt4time/aegis/issues/132) ([af3eb38](https://github.com/OneStepAt4time/aegis/commit/af3eb386be4f54d247cc7ec314f38c5d621501f9))
* **dashboard:** batch fix [#138](https://github.com/OneStepAt4time/aegis/issues/138) [#137](https://github.com/OneStepAt4time/aegis/issues/137) [#153](https://github.com/OneStepAt4time/aegis/issues/153) ([a3b0ca6](https://github.com/OneStepAt4time/aegis/commit/a3b0ca66ddc487b8212bf7f7fc864c94b343837c))
* **dashboard:** dead code removal ([#152](https://github.com/OneStepAt4time/aegis/issues/152), [#158](https://github.com/OneStepAt4time/aegis/issues/158)) ([5a19453](https://github.com/OneStepAt4time/aegis/commit/5a19453564c1182a7f5a00f082107a8452584e11))
* **dashboard:** debounce SSE disconnect indicator to prevent flicker ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([24304f3](https://github.com/OneStepAt4time/aegis/commit/24304f30a647fda871bd4d62469f9d03f07ee22d))
* **dashboard:** info-level fixes ([#241](https://github.com/OneStepAt4time/aegis/issues/241) [#245](https://github.com/OneStepAt4time/aegis/issues/245) [#247](https://github.com/OneStepAt4time/aegis/issues/247) [#248](https://github.com/OneStepAt4time/aegis/issues/248) [#249](https://github.com/OneStepAt4time/aegis/issues/249)) ([c87ff9e](https://github.com/OneStepAt4time/aegis/commit/c87ff9eafa7eff4ceea377ef4c07243cdf3efbf4))
* **dashboard:** info-level fixes ([#241](https://github.com/OneStepAt4time/aegis/issues/241) [#245](https://github.com/OneStepAt4time/aegis/issues/245) [#247](https://github.com/OneStepAt4time/aegis/issues/247) [#248](https://github.com/OneStepAt4time/aegis/issues/248) [#249](https://github.com/OneStepAt4time/aegis/issues/249)) ([03e8e13](https://github.com/OneStepAt4time/aegis/commit/03e8e13d00775f48f62175fb4f7d92473acf5829))
* **dashboard:** memoize session lookup in ActivityStream ([#159](https://github.com/OneStepAt4time/aegis/issues/159)) ([39986bf](https://github.com/OneStepAt4time/aegis/commit/39986bf0c3227e5eee885bb76491bcf65494d171))
* **dashboard:** memoize session lookup in ActivityStream ([#159](https://github.com/OneStepAt4time/aegis/issues/159)) ([e7d845f](https://github.com/OneStepAt4time/aegis/commit/e7d845f2047c04f515bc2aa49fa8dbae3e040f35))
* **dashboard:** mock localStorage manually instead of requiring jsdom ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([80c43eb](https://github.com/OneStepAt4time/aegis/commit/80c43eb16e65daf59f6655e916b3da47bd3b31be))
* **dashboard:** preserve graceful degradation when health fetch fails ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([9bed8ca](https://github.com/OneStepAt4time/aegis/commit/9bed8ca4c9a0efa4a343d7054b437034f63b00e0))
* **dashboard:** race conditions and stale closures across components ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([f3c4991](https://github.com/OneStepAt4time/aegis/commit/f3c499141534a53a515c411d8d53ff7fb5162525))
* **dashboard:** React key + Firefox scrollbar + test warn ([#157](https://github.com/OneStepAt4time/aegis/issues/157), [#160](https://github.com/OneStepAt4time/aegis/issues/160)) ([0cf016a](https://github.com/OneStepAt4time/aegis/commit/0cf016a459d4b87741a3c5e806d58f8f8c6b3b32))
* **dashboard:** remove dead code ([#152](https://github.com/OneStepAt4time/aegis/issues/152)) and dedupe formatSeconds ([#158](https://github.com/OneStepAt4time/aegis/issues/158)) ([db928de](https://github.com/OneStepAt4time/aegis/commit/db928de926827a684564d9e5d3a3ed473ba27269))
* **dashboard:** remove unused prev parameter in setHealthMap ([#237](https://github.com/OneStepAt4time/aegis/issues/237) followup) ([90cb225](https://github.com/OneStepAt4time/aegis/commit/90cb225225e1e6cf39ecdec16588b02fd4125872))
* **dashboard:** remove unused useCallback import (CI fix) ([61c13b0](https://github.com/OneStepAt4time/aegis/commit/61c13b0e1e8b5d19643637d102aed8c914707cd9))
* **dashboard:** reset modal form on close ([#140](https://github.com/OneStepAt4time/aegis/issues/140)), show error state in metrics ([#141](https://github.com/OneStepAt4time/aegis/issues/141)) ([e6e1d06](https://github.com/OneStepAt4time/aegis/commit/e6e1d06b617de5846fe8b3de3a176112f3bf37eb))
* **dashboard:** SSE event types + header merge ([#130](https://github.com/OneStepAt4time/aegis/issues/130), [#148](https://github.com/OneStepAt4time/aegis/issues/148)) ([fbc9dbc](https://github.com/OneStepAt4time/aegis/commit/fbc9dbcc8d8da3df6b8d896fc2632cf8da908994))
* **dashboard:** stale closure, health map pruning, throttled refetch ([#238](https://github.com/OneStepAt4time/aegis/issues/238) [#237](https://github.com/OneStepAt4time/aegis/issues/237) [#239](https://github.com/OneStepAt4time/aegis/issues/239)) ([bbbdf4a](https://github.com/OneStepAt4time/aegis/commit/bbbdf4aa9f7c8b6dac22035a0e107f7fabf455c5))
* **dashboard:** stale closure, health pruning, throttled refetch ([#238](https://github.com/OneStepAt4time/aegis/issues/238) [#237](https://github.com/OneStepAt4time/aegis/issues/237) [#239](https://github.com/OneStepAt4time/aegis/issues/239)) ([2ea333e](https://github.com/OneStepAt4time/aegis/commit/2ea333eb6c6ab4d0a668eaac78a57b4a94f320d7))
* **dashboard:** use jsdom env in store test for localStorage support ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([6157783](https://github.com/OneStepAt4time/aegis/commit/6157783d002cda9147e7d7e2a3e3de234bc685a4))
* dead session detection verifies process is alive, not just window ([#69](https://github.com/OneStepAt4time/aegis/issues/69)) ([#101](https://github.com/OneStepAt4time/aegis/issues/101)) ([8826a77](https://github.com/OneStepAt4time/aegis/commit/8826a77ee2b4de457d648de7055ebf40b125942e))
* deadlock in createWindow() serialize callback — Issue [#393](https://github.com/OneStepAt4time/aegis/issues/393) ([03505d9](https://github.com/OneStepAt4time/aegis/commit/03505d9e380c83f3065a4061a947e1c78f410671))
* decouple SSE emit from caller via setImmediate ([#308](https://github.com/OneStepAt4time/aegis/issues/308)) ([21f2972](https://github.com/OneStepAt4time/aegis/commit/21f29726544275aba5845dbafb734b187de76695))
* default dashboard API base URL to relative path ([cc64a6d](https://github.com/OneStepAt4time/aegis/commit/cc64a6dd5cba085ef6a0e52f71c5d03842e3dfc7))
* default dashboard API base URL to relative path ([#295](https://github.com/OneStepAt4time/aegis/issues/295)) ([1a1492a](https://github.com/OneStepAt4time/aegis/commit/1a1492a15d32616ef1f2bb60222d317579d62d11))
* default to bypassPermissions for headless sessions ([718d736](https://github.com/OneStepAt4time/aegis/commit/718d7369ec70805e4bf7768b1ba785c04240abd6))
* default to bypassPermissions for headless sessions ([#320](https://github.com/OneStepAt4time/aegis/issues/320)) ([0f12145](https://github.com/OneStepAt4time/aegis/commit/0f12145d4f48c748425ff8679aac15db6e78759d))
* detect --bare flag, use filesystem discovery (issue [#16](https://github.com/OneStepAt4time/aegis/issues/16)) ([#18](https://github.com/OneStepAt4time/aegis/issues/18)) ([ffe39b3](https://github.com/OneStepAt4time/aegis/commit/ffe39b31ff2921e55598bd7fce6e92520d4910e2))
* detect CC process crash immediately via PID check ([#390](https://github.com/OneStepAt4time/aegis/issues/390)) ([#502](https://github.com/OneStepAt4time/aegis/issues/502)) ([e619882](https://github.com/OneStepAt4time/aegis/commit/e61988217e5d7b4efcdd795e69f884926798a149))
* distinguish API rate-limit from active work in stall detection ([71c770f](https://github.com/OneStepAt4time/aegis/commit/71c770fbd82c1fee838a061c551e743b113ad8c0))
* distinguish API rate-limit from active work in stall detection ([9787c55](https://github.com/OneStepAt4time/aegis/commit/9787c55bb3cd460a4210743b3b242dbd6fcf3a00))
* dynamic permission buttons matching CC's actual options ([#58](https://github.com/OneStepAt4time/aegis/issues/58)) ([c229cc8](https://github.com/OneStepAt4time/aegis/commit/c229cc86eb14f97f656c5396ce78acc283e39440))
* env vars no longer leaked via tmux send-keys (issue [#23](https://github.com/OneStepAt4time/aegis/issues/23)) ([#24](https://github.com/OneStepAt4time/aegis/issues/24)) ([4394c2a](https://github.com/OneStepAt4time/aegis/commit/4394c2aecbc9598b21cae8e4a68692acb4950105))
* expand permission prompt regex — MCP, workspace trust, batch edit ([#63](https://github.com/OneStepAt4time/aegis/issues/63)) ([#95](https://github.com/OneStepAt4time/aegis/issues/95)) ([960a00a](https://github.com/OneStepAt4time/aegis/commit/960a00a3a27b2323b59f2aceac3ef2bd45bfc47c))
* filter SSE events by missing sessionId instead of event name ([91dfa66](https://github.com/OneStepAt4time/aegis/commit/91dfa66bec1ff13dae4009fcb1f37e268e3d9dd0))
* flaky workdir-mkdir test cleanup — use force:true and stable root path ([#93](https://github.com/OneStepAt4time/aegis/issues/93)) ([c9eb0fa](https://github.com/OneStepAt4time/aegis/commit/c9eb0fad44aa2a646b55fcc950f2f5e3986aea1c))
* graceful shutdown and crash recovery — Issue [#361](https://github.com/OneStepAt4time/aegis/issues/361) ([2ccbb05](https://github.com/OneStepAt4time/aegis/commit/2ccbb052acdfb4c47c8de51dc9c0d72d78d10327))
* graceful shutdown and crash recovery gaps — Issue [#361](https://github.com/OneStepAt4time/aegis/issues/361) ([ab91263](https://github.com/OneStepAt4time/aegis/commit/ab912632bdad3f213dc6e9748824fe30a2e6e69d))
* guard emitEnded cleanup against fresh emitter race ([#308](https://github.com/OneStepAt4time/aegis/issues/308)) ([cf37633](https://github.com/OneStepAt4time/aegis/commit/cf37633dbc2a63f151400a7aba35a81508a8d92d))
* handle EADDRINUSE at boot — kill stale port holder + retry ([#99](https://github.com/OneStepAt4time/aegis/issues/99)) ([#100](https://github.com/OneStepAt4time/aegis/issues/100)) ([230958e](https://github.com/OneStepAt4time/aegis/commit/230958e56824de7123f38b4d3dd9eaf2cf5fa888))
* handle SSE back-pressure, disconnect slow clients ([#302](https://github.com/OneStepAt4time/aegis/issues/302)) ([6c214db](https://github.com/OneStepAt4time/aegis/commit/6c214db02ce2ed7175f03f2eac7536edf7cea51c))
* handle SSE back-pressure, disconnect slow clients ([#302](https://github.com/OneStepAt4time/aegis/issues/302)) ([9abb269](https://github.com/OneStepAt4time/aegis/commit/9abb269f913441c05d4bc4a08527fe32899acc2b))
* **high:** transcript offset, DELETE emitEnded, SSE filter, require() ESM ([#259](https://github.com/OneStepAt4time/aegis/issues/259) [#260](https://github.com/OneStepAt4time/aegis/issues/260) [#261](https://github.com/OneStepAt4time/aegis/issues/261) [#269](https://github.com/OneStepAt4time/aegis/issues/269)) ([f9483bb](https://github.com/OneStepAt4time/aegis/commit/f9483bb9b3c22d356daa70da8190ea56dac41e95))
* **high:** transcript offset, DELETE emitEnded, TranscriptViewer SSE filter, require() ESM ([#259](https://github.com/OneStepAt4time/aegis/issues/259) [#260](https://github.com/OneStepAt4time/aegis/issues/260) [#261](https://github.com/OneStepAt4time/aegis/issues/261) [#269](https://github.com/OneStepAt4time/aegis/issues/269)) ([14ac506](https://github.com/OneStepAt4time/aegis/commit/14ac506a7ba5eb2f29c141b4c0d11774b27b0305))
* **hooks:** correct CC HTTP hook response format ([#79](https://github.com/OneStepAt4time/aegis/issues/79)) ([2de41b8](https://github.com/OneStepAt4time/aegis/commit/2de41b8f7ed8774c32a1ba794b77313ddc5f42ff))
* **hooks:** correct CC HTTP hook response format ([#79](https://github.com/OneStepAt4time/aegis/issues/79)) ([afca501](https://github.com/OneStepAt4time/aegis/commit/afca50197a1c8ab5bc0ebfe373e219301d30cb55))
* **info:** focus trap, Zod schemas, autoFocus cleanup, CI improvements ([#240](https://github.com/OneStepAt4time/aegis/issues/240) [#246](https://github.com/OneStepAt4time/aegis/issues/246) [#250](https://github.com/OneStepAt4time/aegis/issues/250) [#251](https://github.com/OneStepAt4time/aegis/issues/251)) ([6e47bf9](https://github.com/OneStepAt4time/aegis/commit/6e47bf9e3af81eb49ad8de876ac37d63b0c3ec7c))
* **info:** focus trap, Zod schemas, autoFocus, CI improvements ([#240](https://github.com/OneStepAt4time/aegis/issues/240) [#246](https://github.com/OneStepAt4time/aegis/issues/246) [#250](https://github.com/OneStepAt4time/aegis/issues/250) [#251](https://github.com/OneStepAt4time/aegis/issues/251)) ([a7823c9](https://github.com/OneStepAt4time/aegis/commit/a7823c97d0bd3d32c5ccc9dd5c830eb3423c7ce1))
* input validation across all API routes — Issue [#359](https://github.com/OneStepAt4time/aegis/issues/359) ([3fdf986](https://github.com/OneStepAt4time/aegis/commit/3fdf98679cd8edf8ab7c3a19a19c2c91b8a31877))
* loosen flaky backoff assertions in channels test — Issue [#378](https://github.com/OneStepAt4time/aegis/issues/378) ([c1e63e0](https://github.com/OneStepAt4time/aegis/commit/c1e63e08ed038a2ec7367fefa3ac542f37dbec1f))
* loosen flaky backoff assertions in channels test — Issue [#378](https://github.com/OneStepAt4time/aegis/issues/378) ([db3a83b](https://github.com/OneStepAt4time/aegis/commit/db3a83b30f342bc12007b78aca30ad7dfeddcb34))
* map PermissionRequest hook to permission_prompt ([#257](https://github.com/OneStepAt4time/aegis/issues/257)) ([de39ba1](https://github.com/OneStepAt4time/aegis/commit/de39ba109e3a8cd62969b0d36c838d0483642684))
* map PermissionRequest hook to permission_prompt instead of ask_question ([#257](https://github.com/OneStepAt4time/aegis/issues/257)) ([6fab8c1](https://github.com/OneStepAt4time/aegis/commit/6fab8c181810846507dee68d7a59a874d924b3e8))
* MCP server polish — version, auth, errors, graceful degradation — Issue [#445](https://github.com/OneStepAt4time/aegis/issues/445) ([37bc8b6](https://github.com/OneStepAt4time/aegis/commit/37bc8b6d1459fdda7e3c2b516f804f56944155d8))
* MCP server polish — version, auth, errors, graceful degradation — Issue [#445](https://github.com/OneStepAt4time/aegis/issues/445) ([1a5def4](https://github.com/OneStepAt4time/aegis/commit/1a5def416ebccb587d4fc51296314d65f8e4dcd8))
* MCP server polish — version, auth, errors, graceful degradation — Issue [#445](https://github.com/OneStepAt4time/aegis/issues/445) ([8bfea10](https://github.com/OneStepAt4time/aegis/commit/8bfea1050a5da125659c7fff03bd0087d2917fbb))
* **medium:** Telegram XML, CreateSessionModal race, SSE relative URL ([#267](https://github.com/OneStepAt4time/aegis/issues/267) [#268](https://github.com/OneStepAt4time/aegis/issues/268) [#271](https://github.com/OneStepAt4time/aegis/issues/271)) ([b1920e6](https://github.com/OneStepAt4time/aegis/commit/b1920e64e394ea4746ee7b31dc7db8f49c66fce2))
* **medium:** Telegram XML, CreateSessionModal race, SSE relative URL ([#267](https://github.com/OneStepAt4time/aegis/issues/267) [#268](https://github.com/OneStepAt4time/aegis/issues/268) [#271](https://github.com/OneStepAt4time/aegis/issues/271)) ([6589171](https://github.com/OneStepAt4time/aegis/commit/65891718606aa1616b9413dd8e058137c36408dc))
* merge project settings into hook settings file ([c861d93](https://github.com/OneStepAt4time/aegis/commit/c861d93ebea368322316e564c3b6bd39a078b529))
* MetricCards fetchData stale closure ([#304](https://github.com/OneStepAt4time/aegis/issues/304)) ([0bfb021](https://github.com/OneStepAt4time/aegis/commit/0bfb021ff07e8ed195cf5f34348719d01edd9de3))
* mock assertion bugs and type errors in test files ([d17d1b1](https://github.com/OneStepAt4time/aegis/commit/d17d1b1bea58a949d65e2ed44cd160c2cef4b61c))
* monitor improvements — SSE stall/dead, dead check interval, idle debounce ([47052c5](https://github.com/OneStepAt4time/aegis/commit/47052c5788fc86d9686c38fbbcc1adbfd202ae5f))
* monitor improvements — SSE stall/dead, dead check interval, idle debounce ([9119bf1](https://github.com/OneStepAt4time/aegis/commit/9119bf1c40ab394d486227c569c4f80b28706d62))
* monitor stall detection edge cases — Issue [#356](https://github.com/OneStepAt4time/aegis/issues/356) ([74c3aaa](https://github.com/OneStepAt4time/aegis/commit/74c3aaa2533745d1060d559999c9d2e132a67bdf))
* monitor stall detection edge cases — Issue [#356](https://github.com/OneStepAt4time/aegis/issues/356) ([eb0d698](https://github.com/OneStepAt4time/aegis/commit/eb0d698ebacaf9a928b6e2ba9560fb636de52bfd))
* move permission guard backups to ~/.aegis/ — prevent secret leaks ([#104](https://github.com/OneStepAt4time/aegis/issues/104)) ([922e2f9](https://github.com/OneStepAt4time/aegis/commit/922e2f9bbd26d8b91d616f81b843329158170102))
* neutralize project-level bypassPermissions when autoApprove is false ([#60](https://github.com/OneStepAt4time/aegis/issues/60)) ([909cc3a](https://github.com/OneStepAt4time/aegis/commit/909cc3af170400df410bbd489657c10382df28bd))
* P0 prompt delivery reliability — timeout + retry + metrics ([#61](https://github.com/OneStepAt4time/aegis/issues/61)) ([6db4cc4](https://github.com/OneStepAt4time/aegis/commit/6db4cc4b7be5bb08121f526cf08eda4efdf7cd19))
* **P0:** always inject --settings to avoid workspace trust dialog ([c89de96](https://github.com/OneStepAt4time/aegis/commit/c89de9631eb5c0c26f772916c6a2cf216dfed075))
* **P0:** always inject --settings to avoid workspace trust dialog ([0120d6e](https://github.com/OneStepAt4time/aegis/commit/0120d6e7a134eb88f2e8bd1f3398ca1561b2fe67))
* **P0:** hook-based permission approval — Issue [#284](https://github.com/OneStepAt4time/aegis/issues/284) ([#288](https://github.com/OneStepAt4time/aegis/issues/288)) ([fe626cb](https://github.com/OneStepAt4time/aegis/commit/fe626cbd6743b828e4f4578625643ce5d001db55))
* **P0:** prompt delivery reliability — Issue [#285](https://github.com/OneStepAt4time/aegis/issues/285) ([#289](https://github.com/OneStepAt4time/aegis/issues/289)) ([d27af84](https://github.com/OneStepAt4time/aegis/commit/d27af848abc5f8840f2529c3ede1ffacefc7a9e3))
* **P0:** zombie session auto-reaper — removes dead sessions after grace period ([#283](https://github.com/OneStepAt4time/aegis/issues/283)) ([94dc4c0](https://github.com/OneStepAt4time/aegis/commit/94dc4c0476276d5bcb0d883e6f30daf7c2377dfb))
* **P0:** zombie session auto-reaper ([#283](https://github.com/OneStepAt4time/aegis/issues/283)) ([6ca3812](https://github.com/OneStepAt4time/aegis/commit/6ca3812a29ab252548923c043b034e8a516b7f79))
* P1 dead session detection — monitor detects dead tmux windows ([#62](https://github.com/OneStepAt4time/aegis/issues/62)) ([9626901](https://github.com/OneStepAt4time/aegis/commit/9626901f557b48ad249df4e22a4a98a15b58f559))
* package hygiene for npm publishing — Issue [#364](https://github.com/OneStepAt4time/aegis/issues/364) ([0a36e7e](https://github.com/OneStepAt4time/aegis/commit/0a36e7e8ccd80cd35aa36c33e3b181bf04838ecf))
* package hygiene for npm publishing — Issue [#364](https://github.com/OneStepAt4time/aegis/issues/364) ([3377e51](https://github.com/OneStepAt4time/aegis/commit/3377e514c09d80b68c4ea80152326aa4b12f5778))
* pass permission-mode flag to CC based on autoApprove ([#59](https://github.com/OneStepAt4time/aegis/issues/59)) ([5e26aba](https://github.com/OneStepAt4time/aegis/commit/5e26aba6b4983bbeb4f6b5b154152cea6fc3782a))
* path traversal bypass and DELETE 404 for missing sessions — Issues [#434](https://github.com/OneStepAt4time/aegis/issues/434) [#435](https://github.com/OneStepAt4time/aegis/issues/435) ([d3f21c5](https://github.com/OneStepAt4time/aegis/commit/d3f21c57ca312438510144f83384a21ca1b22c6b))
* path traversal bypass and DELETE 404 for missing sessions — Issues [#434](https://github.com/OneStepAt4time/aegis/issues/434) [#435](https://github.com/OneStepAt4time/aegis/issues/435) ([c4ada0c](https://github.com/OneStepAt4time/aegis/commit/c4ada0cd544f33b2beb052e039bc95abd118259f))
* permission system — check all 3 settings locations + smart approve ([9e78120](https://github.com/OneStepAt4time/aegis/commit/9e78120582fac1520db3e3e8fbf53eef2bb531f6))
* permission system — check all 3 settings locations + smart approve ([d610456](https://github.com/OneStepAt4time/aegis/commit/d61045666e75c5b1e5af8cf72f30ac3ef4164644))
* permission-guard supports acceptEdits and other non-bypass modes ([a5e041d](https://github.com/OneStepAt4time/aegis/commit/a5e041d918b298ccea8a9736309dd049b8659d3e))
* prevent AbortError retry and stale debounce timers ([#298](https://github.com/OneStepAt4time/aegis/issues/298), [#299](https://github.com/OneStepAt4time/aegis/issues/299)) ([f05b782](https://github.com/OneStepAt4time/aegis/commit/f05b782de585fea48de15f726a672c07e67ea16a))
* prevent AbortError retry and stale debounce timers ([#298](https://github.com/OneStepAt4time/aegis/issues/298), [#299](https://github.com/OneStepAt4time/aegis/issues/299)) ([4f0f64b](https://github.com/OneStepAt4time/aegis/commit/4f0f64b3439ce9a38adcbcb193540a37140c5a38))
* prevent dashboard crash on undefined sessionId in ActivityStream ([#294](https://github.com/OneStepAt4time/aegis/issues/294)) ([eaddd71](https://github.com/OneStepAt4time/aegis/commit/eaddd71c40f3f3da6c314a86751c5a8b67da2b54))
* prevent double gracefulShutdown on rapid SIGINT ([#415](https://github.com/OneStepAt4time/aegis/issues/415)) ([#490](https://github.com/OneStepAt4time/aegis/issues/490)) ([f32de59](https://github.com/OneStepAt4time/aegis/commit/f32de59e5a419b87b2aabe577457504cd8b66be2))
* prevent flaky auth test collision ([2c7142a](https://github.com/OneStepAt4time/aegis/commit/2c7142a5cb60d1d189b2f8f84c9a454bd968f71b))
* prevent path traversal in workDir validation — Issue [#435](https://github.com/OneStepAt4time/aegis/issues/435) ([8e9994e](https://github.com/OneStepAt4time/aegis/commit/8e9994ecd31750d2ab40c6b97e2994000bf22154))
* prevent path traversal in workDir validation — Issue [#435](https://github.com/OneStepAt4time/aegis/issues/435) ([e26f362](https://github.com/OneStepAt4time/aegis/commit/e26f362a42816d1fd2db2d6c8e4f9714c55f65d1))
* prompt delivery v2 — state-change detection, no blind re-send ([#53](https://github.com/OneStepAt4time/aegis/issues/53)) ([3fdc4af](https://github.com/OneStepAt4time/aegis/commit/3fdc4af05ea45457363d3618e900c86f4c9e5bfc))
* reject stale claudeSessionId via timestamp + mtime guards (issue [#6](https://github.com/OneStepAt4time/aegis/issues/6)) ([#8](https://github.com/OneStepAt4time/aegis/issues/8)) ([fb3d8f9](https://github.com/OneStepAt4time/aegis/commit/fb3d8f93a4a1aec012aee6670180be94c90dffbc))
* remove bearer token fallback in SSE — retry with backoff instead — Issue [#408](https://github.com/OneStepAt4time/aegis/issues/408) ([733f5b7](https://github.com/OneStepAt4time/aegis/commit/733f5b793d365a3f5e271816b332f033dfbe656b))
* remove bearer token fallback in SSE — retry with backoff instead — Issue [#408](https://github.com/OneStepAt4time/aegis/issues/408) ([b51800d](https://github.com/OneStepAt4time/aegis/commit/b51800d8a85666d63096aff076b0a3701aebdb95))
* remove dead sessionMessages store code ([#296](https://github.com/OneStepAt4time/aegis/issues/296)) ([6ad5890](https://github.com/OneStepAt4time/aegis/commit/6ad5890ee5beb540f06c51ebce1e2b33674e8ff5))
* remove dead sessionMessages store code and cap messages ([#296](https://github.com/OneStepAt4time/aegis/issues/296)) ([677fee1](https://github.com/OneStepAt4time/aegis/commit/677fee17e6a1bf6c8cd827efcd2ea12274ca6711))
* Remove decorateReply: false (default is true). ([118d883](https://github.com/OneStepAt4time/aegis/commit/118d88339f3be5f361d1ad7e567a62f13da04b84))
* remove fake email from SECURITY.md — use GitHub Security Advisory + issue template ([#290](https://github.com/OneStepAt4time/aegis/issues/290)) ([eabd354](https://github.com/OneStepAt4time/aegis/commit/eabd3547bd8a73b2ec58b1832dfdfc7e59dcd3c1))
* remove fake email from SECURITY.md — use GitHub Security Advisory + issue template ([#290](https://github.com/OneStepAt4time/aegis/issues/290)) ([d58ec65](https://github.com/OneStepAt4time/aegis/commit/d58ec658b865a408fd30c87c8cab245f678b4955))
* remove unused STATUS_COLORS from SessionHeader (CI fix) ([003f5c2](https://github.com/OneStepAt4time/aegis/commit/003f5c2b809c95376bf4aee3827a6e40900592b9))
* replace sync readFileSync with async I/O in transcript scanning ([#409](https://github.com/OneStepAt4time/aegis/issues/409)) ([#496](https://github.com/OneStepAt4time/aegis/issues/496)) ([3ccddc9](https://github.com/OneStepAt4time/aegis/commit/3ccddc95de762c289d94407a28361919d390a141))
* replace unsafe  cast with type guard for 404 detection ([dc7bc02](https://github.com/OneStepAt4time/aegis/commit/dc7bc02b2d432a307a437cafb134569518e3293d))
* replace unsafe `as any` cast with type guard for 404 detection ([#305](https://github.com/OneStepAt4time/aegis/issues/305)) ([d1b8aa7](https://github.com/OneStepAt4time/aegis/commit/d1b8aa72ef4f4c7605a0fea86f091fbb725a4596))
* require session validation on hook endpoints — Issue [#394](https://github.com/OneStepAt4time/aegis/issues/394) ([fb76540](https://github.com/OneStepAt4time/aegis/commit/fb765406482c4d0ab14982e03fd6d18e8e83f1c7))
* require session validation on hook endpoints — Issue [#394](https://github.com/OneStepAt4time/aegis/issues/394) ([09556cb](https://github.com/OneStepAt4time/aegis/commit/09556cbb901d90368b3ec8be40d2f4fd74509188))
* resolve all Critical issues [#120](https://github.com/OneStepAt4time/aegis/issues/120)-[#128](https://github.com/OneStepAt4time/aegis/issues/128) ([d4ee4bc](https://github.com/OneStepAt4time/aegis/commit/d4ee4bc8952e78f5c55e1253cc871cf19f0124c3))
* retry tmux window creation + session health check (issue [#7](https://github.com/OneStepAt4time/aegis/issues/7)) ([#9](https://github.com/OneStepAt4time/aegis/issues/9)) ([9a7b610](https://github.com/OneStepAt4time/aegis/commit/9a7b6108fc359abb3fc4d1373cddf7bc6e885efa))
* return 400 with INVALID_WORKDIR when workDir does not exist — Issue [#458](https://github.com/OneStepAt4time/aegis/issues/458) ([18022d8](https://github.com/OneStepAt4time/aegis/commit/18022d8e27dc2572ce70c809d9fe45cedb5c3ec6))
* return 400 with INVALID_WORKDIR when workDir does not exist — Issue [#458](https://github.com/OneStepAt4time/aegis/issues/458) ([b561ffe](https://github.com/OneStepAt4time/aegis/commit/b561ffe6c06723cedf876e4ec737c6349616615d))
* sanitize permission_request content in MessageBubble to prevent XSS ([#406](https://github.com/OneStepAt4time/aegis/issues/406)) ([#498](https://github.com/OneStepAt4time/aegis/issues/498)) ([20f33f7](https://github.com/OneStepAt4time/aegis/commit/20f33f79383e9d41de89cde5bb08567b98097478))
* security audit and dependency hardening ([8ed2a95](https://github.com/OneStepAt4time/aegis/commit/8ed2a95859d4505595d7c9ee64416e2ad7594832))
* security audit hardening — resolve vulns, block CI on high-sev, add lockfile lint ([0bd0162](https://github.com/OneStepAt4time/aegis/commit/0bd0162b87cc95875ccb25e207a63f6bb1a43860))
* security headers ([#145](https://github.com/OneStepAt4time/aegis/issues/145)) + cache-control ([#146](https://github.com/OneStepAt4time/aegis/issues/146)) ([d0575aa](https://github.com/OneStepAt4time/aegis/commit/d0575aa44ab99cfce38f5e5f2ce412c826a6e8e5))
* **security:** CORS, headers, token redaction, rate limit, Zod, catch typing ([#217](https://github.com/OneStepAt4time/aegis/issues/217)-[#230](https://github.com/OneStepAt4time/aegis/issues/230)) ([ef7cb13](https://github.com/OneStepAt4time/aegis/commit/ef7cb135be9e214fea2cd38e46807907ff8aa973))
* **security:** CORS, security headers, token redaction, rate limiting, catch typing, Zod validation ([#217](https://github.com/OneStepAt4time/aegis/issues/217) [#226](https://github.com/OneStepAt4time/aegis/issues/226) [#227](https://github.com/OneStepAt4time/aegis/issues/227) [#228](https://github.com/OneStepAt4time/aegis/issues/228) [#229](https://github.com/OneStepAt4time/aegis/issues/229) [#230](https://github.com/OneStepAt4time/aegis/issues/230)) ([0703b63](https://github.com/OneStepAt4time/aegis/commit/0703b63c7a37f919331578c3fac36f8466bfed34))
* **security:** path traversal, env injection, auth endpoints, SSRF, dashboard bugs ([3d0abba](https://github.com/OneStepAt4time/aegis/commit/3d0abba1c04d24ec167035c78bce8918673867f0))
* **security:** path traversal, env injection, auth endpoints, SSRF, dashboard bugs ([#212](https://github.com/OneStepAt4time/aegis/issues/212)-[#216](https://github.com/OneStepAt4time/aegis/issues/216) [#232](https://github.com/OneStepAt4time/aegis/issues/232)-[#235](https://github.com/OneStepAt4time/aegis/issues/235)) ([3293642](https://github.com/OneStepAt4time/aegis/commit/32936421a63a58c878c96416f8dce890ba0ed407))
* session reuse v2 — --session-id as primary defense ([#6](https://github.com/OneStepAt4time/aegis/issues/6)) ([#54](https://github.com/OneStepAt4time/aegis/issues/54)) ([1570f4e](https://github.com/OneStepAt4time/aegis/commit/1570f4e538c93b292e0ebbca8be88bef51916d40))
* shell injection vectors in tmux.ts — Issue [#358](https://github.com/OneStepAt4time/aegis/issues/358) ([237d7e5](https://github.com/OneStepAt4time/aegis/commit/237d7e5f4a2c073ba3e3f6f57a3d3bd7806121a8))
* shell injection vectors in tmux.ts — Issue [#358](https://github.com/OneStepAt4time/aegis/issues/358) ([f70ae77](https://github.com/OneStepAt4time/aegis/commit/f70ae77928c413bbcfc0eba8dc739dc2ec5323b2))
* skip dashboard tests requiring dist in CI + add dashboard build step ([328145a](https://github.com/OneStepAt4time/aegis/commit/328145a47b37002a946dd6afe2884a00e4f3f540))
* SPA fallback URL check too broad ([#144](https://github.com/OneStepAt4time/aegis/issues/144)) + kill session navigation ([#135](https://github.com/OneStepAt4time/aegis/issues/135)) ([571ebd5](https://github.com/OneStepAt4time/aegis/commit/571ebd5366102cd422a482f0f322a66412a0d7eb))
* SSE robustness — race, idle timeout, replay, circuit breaker ([#308](https://github.com/OneStepAt4time/aegis/issues/308)) ([436e97a](https://github.com/OneStepAt4time/aegis/commit/436e97ab6f55e9b5bc274c6ad7f8cae0e0446f4b))
* SSE token generation race condition — add mutex for per-key limit ([#414](https://github.com/OneStepAt4time/aegis/issues/414)) ([#487](https://github.com/OneStepAt4time/aegis/issues/487)) ([7139134](https://github.com/OneStepAt4time/aegis/commit/7139134344d6e1dd4bc108e81ab1f82fa4c4a80c))
* SSRF protection for webhook URLs and screenshot fetch — Issue [#346](https://github.com/OneStepAt4time/aegis/issues/346) ([877bb6e](https://github.com/OneStepAt4time/aegis/commit/877bb6ee47ce9a99f966b925494fe48f2b346f2f))
* StopFailure hook captures error_details, last_assistant_message, agent_id ([#64](https://github.com/OneStepAt4time/aegis/issues/64)) ([#96](https://github.com/OneStepAt4time/aegis/issues/96)) ([40c9a70](https://github.com/OneStepAt4time/aegis/commit/40c9a7028be2cdbc1f6114adef6cb6c71ef2b503))
* swarm parent matching via PID — Issue [#353](https://github.com/OneStepAt4time/aegis/issues/353) ([33de515](https://github.com/OneStepAt4time/aegis/commit/33de515fa50e5d8fd0eaa6ae612455eda62ec131))
* swarm parent matching via PID (Issue [#353](https://github.com/OneStepAt4time/aegis/issues/353)) ([6a98760](https://github.com/OneStepAt4time/aegis/commit/6a987607eed2d41017e96dfad07fef0691389ef0))
* **tech-debt:** L1 exponential backoff, L7 error handling, L16 Aborted detection ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([7e3df96](https://github.com/OneStepAt4time/aegis/commit/7e3df96d67ae06fa7b398c0817ac0224cb7840e2))
* **tech-debt:** L1 L7 L16 — backoff, error handling, Aborted ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([44b1f8a](https://github.com/OneStepAt4time/aegis/commit/44b1f8a913f05c09c79ff73ed2f595e8ca9441de))
* **tech-debt:** L10 L11 L17 — SSE heartbeat, tool metadata, status depth ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([fbe13ab](https://github.com/OneStepAt4time/aegis/commit/fbe13abb9ef4d2a69b3b2657c71a00dc80d3d507))
* **tech-debt:** L10 SSE heartbeat, L11 tool metadata, L17 parseStatusLine depth ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([c922049](https://github.com/OneStepAt4time/aegis/commit/c9220495181c82b65308aeff2bb12d739c6a3a8f))
* **tech-debt:** L12 L13 L33 — backpressure, webhook retry, system JSONL ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([cb60b89](https://github.com/OneStepAt4time/aegis/commit/cb60b89a2e738dcf1cc8c9aceaff0b7291b8fda0))
* **tech-debt:** L12 Telegram backpressure, L13 webhook retry 5x, L33 system JSONL ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([b8c1311](https://github.com/OneStepAt4time/aegis/commit/b8c13115a8901ab9d1704df96a39fde6fc2c7a45))
* **tech-debt:** L14 dead letter queue, L15 channel health, L28 telemetry ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([d4262db](https://github.com/OneStepAt4time/aegis/commit/d4262db187c77616d558b6d6844dbc12c7b4057b))
* **tech-debt:** L14 L15 L28 — dead letter queue, channel health, telemetry ([#89](https://github.com/OneStepAt4time/aegis/issues/89) COMPLETE) ([ebbc5da](https://github.com/OneStepAt4time/aegis/commit/ebbc5da7e337e9dd20f59e569932b9a4ff2c4901))
* **tech-debt:** L2 listWindows logging, L3 killWindow logging, L6 killSession, L9 permission auto-reject ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([5506856](https://github.com/OneStepAt4time/aegis/commit/5506856df08cb9aedcca2f6cd5df7f67ac192a09))
* **tech-debt:** L23 DCS stripping, L24 permission_mode validation, L25 model field capture ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([710d756](https://github.com/OneStepAt4time/aegis/commit/710d75681c2c725d476b1fc43a15a3514ad747c4))
* **tech-debt:** L23 L24 L25 — DCS stripping, permission validation, model capture ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([1a39334](https://github.com/OneStepAt4time/aegis/commit/1a39334734eca96bb37aa9d46ff7c201179276e2))
* **tech-debt:** L26 L27 L29 — worktree hooks, autoApprove warn, env vars ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([bf7de20](https://github.com/OneStepAt4time/aegis/commit/bf7de2022c5e0bdffc2d39f35c952f0ea7dd8555))
* **tech-debt:** L26 WorktreeCreate/Remove hooks, L27 auto-approve warn, L29 CC env vars ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([e10beff](https://github.com/OneStepAt4time/aegis/commit/e10beff4da944d0eb81e7204771cb88d9fa65874))
* **tech-debt:** L30 compacting state, L31 context warning, L32 waiting_for_input ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([a9abd1c](https://github.com/OneStepAt4time/aegis/commit/a9abd1cbfcfabcb4575aaa6f8e43db110dd41b7d))
* **tech-debt:** L30 L31 L32 — compacting, context warning, waiting_for_input ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([a26e457](https://github.com/OneStepAt4time/aegis/commit/a26e457ebcedd5e6e1e60d78a9b2da17dedae31a))
* **tech-debt:** L4 debounce, L5 atomic window name, L8 per-session stall threshold ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([db2f684](https://github.com/OneStepAt4time/aegis/commit/db2f684f754c1d7f265cf3fcc18cf7c0f0b6b645))
* **tech-debt:** L4 L5 L8 — debounce, atomic window, per-session stall ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([f5f8c38](https://github.com/OneStepAt4time/aegis/commit/f5f8c38017e5f37ead9f5c42bb55db9e05b71b49))
* **tech-debt:** test coverage + L2/L3/L6/L9 improvements ([#89](https://github.com/OneStepAt4time/aegis/issues/89)) ([aa8d2e2](https://github.com/OneStepAt4time/aegis/commit/aa8d2e2c443563f1a859fbd9b9e36634f382895f))
* Telegram message formatting — longer truncation, multi-line, pre blocks ([#43](https://github.com/OneStepAt4time/aegis/issues/43)) ([#44](https://github.com/OneStepAt4time/aegis/issues/44)) ([b5a79fd](https://github.com/OneStepAt4time/aegis/commit/b5a79fd60e1f0e3454e396662ec3c24cce09b671))
* Telegram messages never delivered — race condition ([#46](https://github.com/OneStepAt4time/aegis/issues/46)) ([#47](https://github.com/OneStepAt4time/aegis/issues/47)) ([45447ec](https://github.com/OneStepAt4time/aegis/commit/45447ec6422d05018025b0974ace3a7ee506118b))
* **telegram:** increase message truncation limits for readability ([#43](https://github.com/OneStepAt4time/aegis/issues/43)) ([2779634](https://github.com/OneStepAt4time/aegis/commit/27796345ecb8e2e3f2f483b8887a5fd2755174c5))
* **telegram:** increase message truncation limits for readability ([#43](https://github.com/OneStepAt4time/aegis/issues/43)) ([#45](https://github.com/OneStepAt4time/aegis/issues/45)) ([4b13af7](https://github.com/OneStepAt4time/aegis/commit/4b13af7b6fb133f4862ec18e1e8e774709ec035a))
* terminal parser edge cases — Issue [#362](https://github.com/OneStepAt4time/aegis/issues/362) ([87ac378](https://github.com/OneStepAt4time/aegis/commit/87ac3784a5d06b0721eadc986f7ac8973d0ac852))
* terminal parser edge cases and false positives — Issue [#362](https://github.com/OneStepAt4time/aegis/issues/362) ([2859c86](https://github.com/OneStepAt4time/aegis/commit/2859c866df0ecd506450e5f85cad46fed8f2fd7f))
* terminal parser improvements (M5, M6, M20, M21) ([6b50217](https://github.com/OneStepAt4time/aegis/commit/6b5021701c0dd743843e756172aab85cbd53ad8a))
* terminal parser improvements (M5, M6, M20, M21) ([896e23a](https://github.com/OneStepAt4time/aegis/commit/896e23aad69b602b8594b30f27dba40481f6012d))
* test mock assertion bugs and type errors ([44caf7f](https://github.com/OneStepAt4time/aegis/commit/44caf7fcaa576b59c01bf0d253c16d515f916fed))
* **tests:** MCP listSessions tests expect paginated response ([#254](https://github.com/OneStepAt4time/aegis/issues/254) followup) ([0077f06](https://github.com/OneStepAt4time/aegis/commit/0077f06562ad6cfe12b6fd1cfc4903c2194b902a))
* TmuxManager overhead and session creation latency — Issue [#363](https://github.com/OneStepAt4time/aegis/issues/363) ([093e25f](https://github.com/OneStepAt4time/aegis/commit/093e25fa1a5e9c9440d5d7f73a9d17b512b52401))
* TmuxManager overhead and session creation latency — Issue [#363](https://github.com/OneStepAt4time/aegis/issues/363) ([1355d6d](https://github.com/OneStepAt4time/aegis/commit/1355d6d3386872a310136876b717552de9110740))
* transcript parser — handle permission_request, progress, tool_error ([7cbf6c5](https://github.com/OneStepAt4time/aegis/commit/7cbf6c55e46513294baeea07103fef2a087916ac))
* transcript parser — handle permission_request, progress, tool_error ([ac9b072](https://github.com/OneStepAt4time/aegis/commit/ac9b0724b1c4ebfe36adb92198090638d82bad87))
* type MockWebSocket test helpers properly ([#310](https://github.com/OneStepAt4time/aegis/issues/310)) ([ce312b9](https://github.com/OneStepAt4time/aegis/commit/ce312b90167e8a118499b7493d340c752896f43f))
* type-safe resource content access in MCP resource tests ([1a16a1d](https://github.com/OneStepAt4time/aegis/commit/1a16a1d9362ab295033b324c4f0013b4b9f68439))
* unbounded maps and memory leaks — Issue [#357](https://github.com/OneStepAt4time/aegis/issues/357) ([b3983c3](https://github.com/OneStepAt4time/aegis/commit/b3983c30623d8ba16fd8b2b6bac5189023068926))
* unbounded maps and memory leaks across modules — Issue [#357](https://github.com/OneStepAt4time/aegis/issues/357) ([411b138](https://github.com/OneStepAt4time/aegis/commit/411b13891cdfb7cf08c682782bb397941b07d55c))
* unset $TMUX before launching CC — prevents swarm interference ([#68](https://github.com/OneStepAt4time/aegis/issues/68)) ([#92](https://github.com/OneStepAt4time/aegis/issues/92)) ([f80ec10](https://github.com/OneStepAt4time/aegis/commit/f80ec10dbf36e9fa91694a25fc29220522a572c1))
* update all call sites and frontend for permissionMode (follow-up [#98](https://github.com/OneStepAt4time/aegis/issues/98)) ([5b36ce2](https://github.com/OneStepAt4time/aegis/commit/5b36ce2b332da290940b1e0a063759c4a62e37ba))
* use short-lived SSE tokens ([5e32554](https://github.com/OneStepAt4time/aegis/commit/5e325540d7fbf0a490581eb6f030c56219db84ef)), closes [#297](https://github.com/OneStepAt4time/aegis/issues/297)
* use timingSafeEqual for token comparison — Issue [#402](https://github.com/OneStepAt4time/aegis/issues/402) ([d401183](https://github.com/OneStepAt4time/aegis/commit/d4011837bbd24a4160d1fa5de3e81c4b05bb4d7a))
* use timingSafeEqual for token comparison — Issue [#402](https://github.com/OneStepAt4time/aegis/issues/402) ([f1f26bd](https://github.com/OneStepAt4time/aegis/commit/f1f26bd4d19bd64f6be4709cc23851aac4ed09f0))
* useCallback stale closure ([#134](https://github.com/OneStepAt4time/aegis/issues/134)) + remove duplicate buttons ([#136](https://github.com/OneStepAt4time/aegis/issues/136)) ([da9adde](https://github.com/OneStepAt4time/aegis/commit/da9adde2fad79dbb319afe0c232f9563dedbc0a9))
* validate port numbers in CLI with parseIntSafe — Issue [#359](https://github.com/OneStepAt4time/aegis/issues/359) ([4246d0d](https://github.com/OneStepAt4time/aegis/commit/4246d0dd7a53a73516087026a5b0c52c655ef986))
* validate UUID format for session IDs and use exact workDir matching — Issue [#359](https://github.com/OneStepAt4time/aegis/issues/359) ([4e22b18](https://github.com/OneStepAt4time/aegis/commit/4e22b18fcd45261ccfc7e30df7bd249c6e95732e))
* wrap MetricCards fetchData in useCallback to prevent stale closure ([#304](https://github.com/OneStepAt4time/aegis/issues/304)) ([2690dd4](https://github.com/OneStepAt4time/aegis/commit/2690dd41486833ac0c3d236245c82d3e15d333d0))
* WS terminal security hardening ([9a49867](https://github.com/OneStepAt4time/aegis/commit/9a49867cde85f7e7a4ec675e6500f20cca4d8fb1))


### Performance Improvements

* **dashboard:** O(1) dedup in TranscriptViewer via Set ([#306](https://github.com/OneStepAt4time/aegis/issues/306)) ([51a8515](https://github.com/OneStepAt4time/aegis/commit/51a8515f0c7be98503a8d3f9012018cfdd68c847))

## [2.0.0] - 2026-03-29

### ⚠ BREAKING CHANGES
- MCP server expanded from 5 to 21 tools — clients using hardcoded tool lists may need updates

### Added
- **MCP tool completeness**: 15+ new tools — kill, approve, reject, health, escape, interrupt, pane, metrics, summary, bash, command, latency, batch, pipelines, swarm (#441)
- **MCP Resources**: 4 resources for session data discovery (#442)
- **MCP Prompts**: implement_issue, review_pr, debug_session workflow prompts (#443)
- **MCP test suite + README docs**: Comprehensive MCP server tests and documentation (#444)
- **MCP polish**: Version reporting, auth improvements, graceful degradation (#445)
- **GitHub Sponsors + Ko-fi**: Support the Project section in README
- **First external contribution**: File audit job by @tranhoangtu-it (#439)

### Fixed
- **Security: Path traversal bypass in workDir** (#435, #472)
- **Security: Timing attack on master token comparison** — use timingSafeEqual (#402, #473)
- **Security: Bearer token fallback in SSE** — retry with backoff instead (#408, #474)
- **Security: Path traversal + DELETE 404** for missing sessions (#434, #435, #438)
- **Security: Hook auth bypass** — require session validation on hook endpoints (#394, #401)
- **workDir validation**: Return 400 with INVALID_WORKDIR when workDir doesn't exist (#458, #461)
- **README field name**: Correct `brief` → `prompt` and update stale badges (#396, #400)
- **createWindow() deadlock**: Serialize callback fix (#393)

### Changed
- **Docs cleanup**: Removed 24 internal dev artifacts from docs/ (~300KB) (#462, #475)
- **Repo hygiene**: Remove junk files + update .gitignore (#453, #454)
- CI: Add file audit step to prevent tracking junk files

### Tests
- 1,449 tests — MCP server fully tested

## [1.4.1] - 2026-03-28

### Fixed
- **createWindow() deadlock**: Fix serialize callback deadlock in tmux window creation (#393)

## [1.4.0] - 2026-03-28

### Added
- **Automated release pipeline**: npm publish + GitHub Releases via CI (#365)
- **Headless question answering**: PreToolUse hook enables Q&A in headless mode
- **Pipeline management page**: Dashboard UI for pipeline orchestration
- **Zod validation for all API routes**: Input validation with safeParse (#359)
- **SSRF validation utility**: Shared DNS-check for webhook/screenshot URLs (#346)
- **SSE connection limits**: Per-IP and global connection limiting
- **WS terminal security hardening**: Token-based auth for WebSocket endpoints
- **Short-lived SSE tokens**: Time-limited tokens for EventSource connections

### Fixed
- **Security audit hardening**: Resolve vulns, block CI on high-sev, lockfile lint (#366)
- **Auth bypass via broad path matching**: Stricter middleware path matching (#349)
- **Command injection in hook.ts**: Sanitize TMUX_PANE env var (#347)
- **Shell injection in tmux.ts**: Escape all user inputs (#358)
- **Terminal parser edge cases**: Reduce false positives in state detection (#362)
- **Input validation gaps**: NaN/isFinite guards, UUID format, port clamping (#359)
- **Graceful shutdown and crash recovery**: Clean teardown on SIGTERM/SIGINT (#361)
- **Monitor stall detection edge cases**: Fix false stall detection (#356)
- **Swarm parent matching**: Use PID for teammate detection (#353)
- **TmuxManager overhead**: Reduce session creation latency (#363)
- **Unbounded maps and memory leaks**: Fix memory growth across modules (#357)
- **Authentication on inbound Telegram messages**: Proper auth for Telegram bot (#348)
- **Flaky backoff assertions**: Loosen timing in channel tests (#378)
- **Mock assertion bugs**: Fix type errors in test files (#360)
- **Package hygiene for npm**: Clean exports and module structure (#364)

### Tests
- 1,428 tests (62 test files) — coverage increased across all modules

### Known Issues
- #390: Crash detection relies only on stall timer (5 min), missing pane-exit detection
- #391: SSE /v1/sessions/:id/events not streaming pane-content for working sessions

## [1.3.3] - 2026-03-27

### Added
- **WebSocket terminal streaming**: Live terminal with xterm.js frontend + WS endpoint (#310)
- **Batch session creation UI**: Dashboard modal with single/batch tabs (#312)
- **ResilientEventSource**: Backoff + circuit breaker for SSE reconnection (#308)
- **SSE back-pressure**: Disconnect slow clients via SSEWriter (#302)
- **Global event ring buffer**: 50-event ring with Last-Event-ID replay (#301)
- **Expanded CC hook events**: PreCompact, PostCompact, Notification, Elicitation, FileChanged, CwdChanged (#208)
- **WebSocket terminal endpoint**: `WS /v1/sessions/:id/terminal` (#108 Sprint 3)
- **Session list pagination + paginated transcript**: `GET /v1/sessions?limit&cursor`, `GET /v1/sessions/:id/transcript?limit&offset` (#109, #206)
- **Agent swarm awareness**: Detect CC teammate sessions + Telegram `/swarm` command (#81, #71)
- **Tech debt cleared**: All 36 items from #89 (100%) — backoff, logging, error handling, DCS stripping, compacting state, etc.
- **Security hardening**: CORS, security headers, token redaction, rate limiting, Zod validation, path traversal protection, SSRF prevention (#217-#230)
- **Dashboard metrics**: Per-session latency endpoint (#87)

### Fixed
- **P0: Prompt delivery reliability** — capture-pane verification after send-keys (#285, #289)
- **P0: Hook-based permission approval** — auto-approve with audit logging (#284, #288)
- **P0: Zombie session reaper** — auto-remove dead sessions after grace period (#283)
- **P0: Workspace trust dialog** — always inject `--settings` flag (#194, confirmed in v1.3.2)
- **PermissionRequest hook mapping** — map to `permission_prompt` not `ask_question` (#257)
- **State persistence race condition** (#218), pipeline stage config loss (#219)
- **MCP listSessions pagination regression** (#254)
- **Rules of Hooks violation** in dashboard (#231)
- **Race conditions**: dashboard SSE flicker, double-submit, stale closures (#306)
- **AbortError retry defeated cancellation** (#298), stale debounce timers (#299)
- **SSE robustness**: emitter cleanup race, idle timeout, circuit breaker (#308)
- **Memory leak**: unbounded sessionMessages growth (#296)
- **Dashboard crash** on undefined sessionId (#294)
- **Default to bypassPermissions** for headless sessions (#320)
- **~50 additional dashboard/backend fixes** from comprehensive review

### Tests
- 1,246 → 2,176 tests (+74%)

## [1.3.2] - 2026-03-26

### Fixed
- **Workspace trust dialog**: Always inject `--settings` flag to prevent CC workspace trust prompts on first open (#194)

## [1.3.1] - 2026-03-26

### Added
- **Latency metrics dashboard**: Per-session latency tracking + `GET /v1/sessions/:id/latency` endpoint (#87)
