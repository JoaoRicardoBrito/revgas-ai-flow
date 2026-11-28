/** Horário do atendimento humano (issue #13). */
export interface BusinessHours {
  /** Minutos desde a meia-noite, no fuso da revenda. */
  opensAt: number;
  closesAt: number;
  /** 0 = domingo ... 6 = sábado. */
  days: readonly number[];
  timeZone: string;
}

export const HOURS_PATTERN =
  /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
export const DAYS_PATTERN = /^[0-6](,[0-6])*$/;

const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toMinutes = (time: string) => {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
};

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function isValidHours(value: string): boolean {
  if (!HOURS_PATTERN.test(value)) return false;
  const [open = '', close = ''] = value.split('-');
  return toMinutes(open) < toMinutes(close);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Sem `hours`, não há restrição de horário. */
export function parseBusinessHours(config: {
  hours?: string;
  days: string;
  timeZone: string;
}): BusinessHours | undefined {
  if (!config.hours) return undefined;
  const [open = '', close = ''] = config.hours.split('-');
  return {
    opensAt: toMinutes(open),
    closesAt: toMinutes(close),
    days: [...new Set(config.days.split(',').map(Number))].toSorted(
      (a, b) => a - b,
    ),
    timeZone: config.timeZone,
  };
}

export function isOpen(hours: BusinessHours, at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const day = WEEKDAYS.indexOf(part('weekday'));
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  return (
    hours.days.includes(day) &&
    minutes >= hours.opensAt &&
    minutes < hours.closesAt
  );
}

/** Ex.: "seg, ter, qua, das 08:00 às 18:00". */
export function describeHours(hours: BusinessHours): string {
  const days = hours.days.map((d) => DAY_NAMES[d]).join(', ');
  return `${days}, das ${toTime(hours.opensAt)} às ${toTime(hours.closesAt)}`;
}
