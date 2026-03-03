import { dispatchDueReminders } from '../modules/reminders/reminders.service.js';

export async function runReminderDispatchJob(): Promise<void> {
  const result = await dispatchDueReminders(200);
  // eslint-disable-next-line no-console
  console.log('Reminder dispatch result:', result);
}

