# Issue39 Memory E2E 测试报告

- runTag: `issue39-mm1uvsvr`
- total: 28
- passed: 28
- failed: 0

| 用例ID | 模块 | 结果 | 实际 | 证据 |
|---|---|---|---|---|
| M01 | 通知审批 | 通过 | cycleOk=true, status=200, approvedRules=2 | notification=cmm1uvwb2000fwx6chwhuxhwc |
| M18 | 接口契约 | 通过 | event_kind=content, learned=1, system=false | notification=cmm1uvwb2000fwx6chwhuxhwc |
| M02 | 通知审批 | 通过 | status=200, hidden=true, rejectedRules=2 | notification=cmm1uvzit000mwx6ciqd3uv2w |
| M05 | 通知审批 | 通过 | status=200, hidden=false | notification=cmm1uvzit000mwx6ciqd3uv2w |
| M03 | 通知审批 | 通过 | status=200, system_log=true, rulesDelta=0, logs=1 | notification=cmm1uw2ne000xwx6cckxr98dw |
| M04 | 通知审批 | 通过 | status=200, system_log=true, rulesDelta=0, logs=1 | notification=cmm1uw37d000ywx6cqwsjcuhg |
| M06 | 通知审批 | 通过 | status=200, logged=true, undoLogs=1 | notification=cmm1uw37d000ywx6cqwsjcuhg |
| M07 | 记忆规则 | 通过 | rows=1, weight=2, evidence=2 | rule=cmm1uw4du0008s66cvqshzy1l |
| M08 | 自主循环 | 通过 | hasProfile=true | prompt-captured |
| M09 | 自主循环 | 通过 | hasApproved=true, hasRejected=true | prompt-captured |
| M10 | 自主循环 | 通过 | hasLegacy=true | prompt-captured |
| M11 | 自主循环 | 通过 | calls=4->5, summaryRules=2 | summaryCalls=5 |
| M12 | 自主循环 | 通过 | runOk=true, actions=0, summaryCalls=5->5 | no-new-posts |
| M13 | 档案同步 | 通过 | interests=ManualInterest, projects=true, github=https://github.com/example | syncGitHubProfileToUser |
| M14 | 档案同步 | 通过 | status=200, updated=tech_stack|current_projects|writing_style, techStack=TypeScript|PostgreSQL|React, interests=KeepExistingInterest | POST /api/v1/users/me/profile/sync |
| M15 | 设置页 | 通过 | status=200, tech=Node.js|PostgreSQL, style=structured | PATCH /api/v1/users/me/profile |
| M16 | 设置页 | 通过 | create=200, patch=200, delete=200, existsAfterDelete=false | ruleId=cmm1uwf5e000as66cfea700f2 |
| M17 | 兼容性 | 通过 | reject=200, kind=system, undo=200 | notification=cmm1uwgde0026wx6c8mzxynpr |
| P01 | 数字分身风格 | 通过 | patch=200, preset=elys-sharp | agent=cmm1uvtqh0003wx6chtp1t8db |
| P02 | 数字分身风格 | 通过 | valid=200, invalid=400, warmth=0, humor=100 | agent=cmm1uvtqh0003wx6chtp1t8db |
| P03 | 数字分身学习 | 通过 | status=200, delta=2, signals=2 | notification=cmm1uwjeo002awx6cigfsk4wq |
| P04 | 数字分身学习 | 通过 | reject=200, quick=200, delta=4, directness=100->92 | notification=cmm1uwne3002rwx6cxfg6fnhf |
| P05 | 数字分身学习 | 通过 | status=200, delta=8, directness=92->96, undoSignals=2 | notification=cmm1uwne3002rwx6cxfg6fnhf |
| P06 | 风控接管 | 通过 | commentCount=0, takeoverNotice=true | post=cmm1uwr5y002zwx6ccspfkhdp |
| P07 | Shadow模式 | 通过 | comment=, shadowEvent=true | post=cmm1uwu5m003cwx6cw2naqg6z |
| P08 | 晋级机制 | 通过 | mode=live, promotedAt=true, snapshots=1 | agent=cmm1uvtqh0003wx6chtp1t8db |
| P09 | 回滚机制 | 通过 | manualPatch=200, mode=shadow, warmth=80, humor=60, rollbackSnapshots=3 | agent=cmm1uvtqh0003wx6chtp1t8db |
| P10 | 兼容性 | 通过 | list=200, rowKind=system, style=null, mode=null, approve=200 | notification=cmm1ux6710060wx6cu5yflknd |