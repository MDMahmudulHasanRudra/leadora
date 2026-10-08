export interface MessageSendJob {
  data: { messageId: string };
  attemptsMade: number;
  opts: { attempts?: number };
}

export interface MessageSendDeps {
  deliver: (messageId: string, finalAttempt: boolean) => Promise<{ status: string; conversationId?: string; organizationId?: string }>;
  publish: (organizationId: string, type: string, data: Record<string, unknown>) => Promise<void>;
}

export async function handleMessageSend(deps: MessageSendDeps, job: MessageSendJob): Promise<void> {
  const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  const result = await deps.deliver(job.data.messageId, finalAttempt);
  if (result.status === 'SENT' && result.organizationId) {
    await deps.publish(result.organizationId, 'message.updated', { conversationId: result.conversationId, messageId: job.data.messageId });
  }
}
