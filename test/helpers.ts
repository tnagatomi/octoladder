import { fromZonedTime } from "date-fns-tz";

export const TZ = "Asia/Tokyo";

export function tokyo(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return fromZonedTime(new Date(year, month - 1, day, hour, minute, second), TZ);
}
