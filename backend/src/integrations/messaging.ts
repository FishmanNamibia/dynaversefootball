import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { getChannelsDeliveryConfig } from '../modules/settings/settings.store.js';

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
};

export type SendWhatsAppInput = {
  to: string;
  message: string;
};

export type DeliveryResult = {
  success: boolean;
  simulated: boolean;
  providerMessageId?: string;
  error?: string;
};

function hasSmtpConfig(config: Awaited<ReturnType<typeof getChannelsDeliveryConfig>>): boolean {
  return Boolean(config.smtpHost && config.smtpPort && config.smtpUser && config.smtpPass);
}

export async function sendEmailMessage(input: SendEmailInput): Promise<DeliveryResult> {
  const channels = await getChannelsDeliveryConfig();

  if (!hasSmtpConfig(channels)) {
    if (channels.smtpSimulate) {
      return {
        success: true,
        simulated: true,
        providerMessageId: `sim-email-${Date.now()}`
      };
    }
    return {
      success: false,
      simulated: false,
      error: 'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.'
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: channels.smtpHost,
      port: channels.smtpPort,
      secure: channels.smtpSecure,
      auth: {
        user: channels.smtpUser,
        pass: channels.smtpPass
      }
    });

    const result = await transporter.sendMail({
      from: channels.emailFrom || env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments
    });

    return {
      success: true,
      simulated: false,
      providerMessageId: result.messageId
    };
  } catch (error) {
    return {
      success: false,
      simulated: false,
      error: error instanceof Error ? error.message : 'Unknown email error'
    };
  }
}

function hasWhatsAppConfig(config: Awaited<ReturnType<typeof getChannelsDeliveryConfig>>): boolean {
  return Boolean(config.whatsappApiUrl && config.whatsappApiToken);
}

function normalizePhoneForApi(value: string): string {
  return value.replace(/[^\d+]/g, '').trim().replace(/^\+/, '');
}

export async function sendWhatsAppMessage(input: SendWhatsAppInput): Promise<DeliveryResult> {
  const channels = await getChannelsDeliveryConfig();

  if (!hasWhatsAppConfig(channels)) {
    if (channels.whatsappSimulate) {
      return {
        success: true,
        simulated: true,
        providerMessageId: `sim-whatsapp-${Date.now()}`
      };
    }
    return {
      success: false,
      simulated: false,
      error: 'WhatsApp API is not configured. Set WHATSAPP_API_URL and WHATSAPP_API_TOKEN.'
    };
  }

  try {
    const url = channels.whatsappApiUrl as string;
    const isMetaCloudApi = url.includes('graph.facebook.com');
    const payload = isMetaCloudApi
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizePhoneForApi(input.to),
          type: 'text',
          text: {
            preview_url: false,
            body: input.message
          }
        }
      : {
          to: input.to,
          sender: channels.whatsappDefaultSender,
          message: input.message
        };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channels.whatsappApiToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        success: false,
        simulated: false,
        error: `WhatsApp API ${response.status}: ${body}`
      };
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const metaMessages =
      Array.isArray((data as { messages?: unknown[] }).messages) && (data as { messages?: unknown[] }).messages
        ? (data as { messages: Array<{ id?: unknown }> }).messages
        : [];
    const providerMessageId =
      typeof data.messageId === 'string'
        ? data.messageId
        : typeof metaMessages[0]?.id === 'string'
          ? metaMessages[0].id
        : typeof data.id === 'string'
          ? data.id
          : `wa-${Date.now()}`;

    return {
      success: true,
      simulated: false,
      providerMessageId
    };
  } catch (error) {
    return {
      success: false,
      simulated: false,
      error: error instanceof Error ? error.message : 'Unknown WhatsApp error'
    };
  }
}
