import type { ChannelProvider, OutboundEnvelope } from '@leadora/domain';
import nodemailer, { type Transporter } from 'nodemailer';

/** Maps the channel-neutral envelope to an RFC 5322 message with proper threading headers. */
export function toMailOptions(envelope: OutboundEnvelope) {
  return {
    from: { name: envelope.fromName, address: envelope.from },
    to: envelope.to,
    subject: envelope.subject,
    text: envelope.text,
    ...(envelope.inReplyTo ? { inReplyTo: envelope.inReplyTo } : {}),
    ...(envelope.references.length ? { references: envelope.references } : {}),
  };
}

export class SmtpEmailProvider implements ChannelProvider {
  private readonly transport: Transporter;

  constructor(smtpUrl: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(envelope: OutboundEnvelope) {
    const info = await this.transport.sendMail(toMailOptions(envelope));
    return { externalMessageId: info.messageId };
  }

  close() {
    this.transport.close();
  }
}
