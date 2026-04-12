# Run Recovery Specification

失败或中断的 Run 可以恢复执行。

## Follow-up Run

当 Run 有 `parentRunId` 时，RunOrchestrator 执行 follow-up 路径：

```
1. 创建新 sandbox（不复用旧的）
2. 尝试从 parent 的 checkpoint 恢复：
   - CheckpointService.restoreCheckpoint(parentRunId)
   - 解析 events snapshot，提取文本上下文
   - 注入到 prompt 前缀
3. 如果恢复失败 → 降级为 Initial Run（不注入上下文）
4. 正常执行 → stream → finalize → checkpoint
```

## 降级策略

| 场景 | 行为 |
|------|------|
| Parent 无 checkpoint | 降级为 Initial Run |
| S3 snapshot 下载失败 | 降级为 Initial Run（日志告警） |
| Checkpoint 格式错误 | 降级为 Initial Run |
| Sandbox 创建失败 | 直接 failed |

## worker_unreachable 恢复

RunService.recoverStuckRuns() 每 2 分钟执行：
- 查找 `worker_unreachable` 状态超过阈值的 Run
- 标记为 `failed`
- 用户可通过 retry() 重新入队

## 测试要点

- [x] Follow-up run 从 checkpoint 恢复上下文
- [x] Checkpoint 不存在时降级为 initial
- [x] Checkpoint 恢复失败时降级为 initial
- [x] Initial run（无 parentRunId）不触发恢复
