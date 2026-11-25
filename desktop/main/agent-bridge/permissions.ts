import type { PermissionMode } from '../../shared/security';
import { AgentError } from './types';

// Native “on request” approval is not Town's approval before every tool call.
export const externalApprovalNotice = '当前为「每次询问」。此执行器尚不支持客户端逐条工具审批，可同步和查看会话；执行任务请使用内置 Subagent。';
export const externalExecNotice = '客户端已关闭命令执行，外部执行器仅可同步和查看会话。';
export function requireExternalExecution(mode: PermissionMode, allowExec = true) {
  if (!allowExec) throw new AgentError(externalExecNotice, 409);
  if (mode !== 'full-access') throw new AgentError(externalApprovalNotice, 409);
}
