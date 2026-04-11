export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function sanitizeTimezone(input: unknown, fallback: string) {
  const value = String(input || "").trim();
  if (!value) {
    return fallback;
  }
  return isValidTimezone(value) ? value : fallback;
}

export function parseHHMM(value: string) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getLocalDateTime(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const mapped = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  ) as Record<string, string>;

  const year = mapped.year;
  const month = mapped.month;
  const day = mapped.day;
  const hour = mapped.hour;
  const minute = mapped.minute;

  return {
    dateKey: `${year}-${month}-${day}`,
    timeKey: `${hour}:${minute}`,
    minuteOfDay: Number(hour) * 60 + Number(minute)
  };
}

export function shouldTriggerNow(minuteOfDay: number, targetTime: string) {
  const target = parseHHMM(targetTime);
  if (target === null) {
    return false;
  }
  const diff = minuteOfDay - target;
  return diff >= 0 && diff < 5;
}
