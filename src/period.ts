import {
  addMonths,
  addWeeks,
  addYears,
  getISOWeek,
  getISOWeekYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export type PeriodType = "weekly" | "monthly" | "yearly";

export const PERIOD_TYPES = ["weekly", "monthly", "yearly"] as const satisfies readonly PeriodType[];

const STEPPERS: Record<PeriodType, (d: Date, n: number) => Date> = {
  weekly: addWeeks,
  monthly: addMonths,
  yearly: addYears,
};

const STARTERS: Record<PeriodType, (d: Date) => Date> = {
  weekly: (d) => startOfWeek(d, { weekStartsOn: 1 }),
  monthly: startOfMonth,
  yearly: startOfYear,
};

export class InvalidParam extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidParam";
  }
}

export class Period {
  readonly type: PeriodType;
  readonly startsAt: Date;
  readonly timeZone: string;

  private _localStart?: Date;
  private _endsAt?: Date;
  private _param?: string;
  private _label?: string;
  private _subtitle: string | null | undefined = undefined;

  constructor(opts: { type: PeriodType; startsAt: Date; timeZone: string }) {
    if (!PERIOD_TYPES.includes(opts.type)) {
      throw new TypeError(`unknown period type: ${opts.type as string}`);
    }
    this.type = opts.type;
    this.timeZone = opts.timeZone;
    const local = toZonedTime(opts.startsAt, opts.timeZone);
    this.startsAt = fromZonedTime(STARTERS[opts.type](local), opts.timeZone);
  }

  static latestClosed(type: PeriodType, now: Date, timeZone: string): Period {
    const local = toZonedTime(now, timeZone);
    const prev = STEPPERS[type](STARTERS[type](local), -1);
    return new Period({ type, startsAt: fromZonedTime(prev, timeZone), timeZone });
  }

  static parse(type: PeriodType, param: string, timeZone: string): Period {
    return new Period({
      type,
      startsAt: fromZonedTime(parseWallStart(type, param), timeZone),
      timeZone,
    });
  }

  get endsAt(): Date {
    return (this._endsAt ??= fromZonedTime(STEPPERS[this.type](this.localStart, 1), this.timeZone));
  }

  prev(): Period {
    return this.step(-1);
  }

  next(): Period {
    return this.step(1);
  }

  isComplete(now: Date): boolean {
    return this.endsAt.getTime() <= now.getTime();
  }

  contains(time: Date): boolean {
    const t = time.getTime();
    return this.startsAt.getTime() <= t && t < this.endsAt.getTime();
  }

  get label(): string {
    return (this._label ??= this.computeLabel());
  }

  get subtitle(): string | null {
    if (this._subtitle === undefined) {
      this._subtitle = this.type === "weekly"
        ? `Week ${getISOWeek(this.localStart)} · ${getISOWeekYear(this.localStart)}`
        : null;
    }
    return this._subtitle;
  }

  get param(): string {
    return (this._param ??= this.computeParam());
  }

  equals(other: Period): boolean {
    return (
      this.type === other.type &&
      this.startsAt.getTime() === other.startsAt.getTime() &&
      this.timeZone === other.timeZone
    );
  }

  private get localStart(): Date {
    return (this._localStart ??= toZonedTime(this.startsAt, this.timeZone));
  }

  private fmt(d: Date, format: string): string {
    return formatInTimeZone(d, this.timeZone, format);
  }

  private computeLabel(): string {
    switch (this.type) {
      case "weekly": {
        const start = this.fmt(this.startsAt, "MMMM d");
        const end = this.fmt(subDays(this.endsAt, 1), "MMMM d");
        return `${start} — ${end}`;
      }
      case "monthly":
        return this.fmt(this.startsAt, "MMMM yyyy");
      case "yearly":
        return this.fmt(this.startsAt, "yyyy");
    }
  }

  private computeParam(): string {
    switch (this.type) {
      case "weekly":
        return `${getISOWeekYear(this.localStart)}-W${String(getISOWeek(this.localStart)).padStart(2, "0")}`;
      case "monthly":
        return this.fmt(this.startsAt, "yyyy-MM");
      case "yearly":
        return this.fmt(this.startsAt, "yyyy");
    }
  }

  private step(direction: -1 | 1): Period {
    const stepped = STEPPERS[this.type](this.localStart, direction);
    return new Period({
      type: this.type,
      startsAt: fromZonedTime(stepped, this.timeZone),
      timeZone: this.timeZone,
    });
  }
}

function parseWallStart(type: PeriodType, param: string): Date {
  switch (type) {
    case "weekly": {
      const m = param.match(/^(\d{4})-W(\d{1,2})$/);
      if (!m) throw new InvalidParam(`invalid weekly param: ${param}`);
      const date = isoCommercialDate(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
      if (!date) throw new InvalidParam(`invalid weekly param: ${param}`);
      return date;
    }
    case "monthly": {
      const m = param.match(/^(\d{4})-(\d{1,2})$/);
      if (!m) throw new InvalidParam(`invalid monthly param: ${param}`);
      const month = parseInt(m[2]!, 10);
      if (month < 1 || month > 12) throw new InvalidParam(`invalid monthly param: ${param}`);
      return new Date(parseInt(m[1]!, 10), month - 1, 1);
    }
    case "yearly": {
      const m = param.match(/^(\d{4})$/);
      if (!m) throw new InvalidParam(`invalid yearly param: ${param}`);
      return new Date(parseInt(m[1]!, 10), 0, 1);
    }
  }
}

function isoCommercialDate(year: number, week: number): Date | null {
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const week1Mon = new Date(year, 0, 4 - dow + 1);
  const target = addWeeks(week1Mon, week - 1);
  if (getISOWeekYear(target) !== year || getISOWeek(target) !== week) return null;
  return target;
}
