class Period
  TYPES = %i[weekly monthly yearly].freeze

  class InvalidParam < ArgumentError; end

  class << self
    def latest_closed(type, now: Time.current)
      local = now.in_time_zone(Time.zone)
      case type.to_sym
      when :weekly  then new(type: :weekly,  starts_at: local.beginning_of_week - 7.days)
      when :monthly then new(type: :monthly, starts_at: local.beginning_of_month.prev_month)
      when :yearly  then new(type: :yearly,  starts_at: local.beginning_of_year.prev_year)
      else raise ArgumentError, "unknown period type: #{type.inspect}"
      end
    end

    def parse(type, param)
      case type.to_sym
      when :weekly
        m = param.to_s.match(/\A(\d{4})-W(\d{1,2})\z/) or raise InvalidParam, "invalid weekly param: #{param.inspect}"
        date = Date.commercial(m[1].to_i, m[2].to_i, 1)
        new(type: :weekly, starts_at: Time.zone.local(date.year, date.month, date.day))
      when :monthly
        m = param.to_s.match(/\A(\d{4})-(\d{1,2})\z/) or raise InvalidParam, "invalid monthly param: #{param.inspect}"
        new(type: :monthly, starts_at: Time.zone.local(m[1].to_i, m[2].to_i, 1))
      when :yearly
        m = param.to_s.match(/\A(\d{4})\z/) or raise InvalidParam, "invalid yearly param: #{param.inspect}"
        new(type: :yearly, starts_at: Time.zone.local(m[1].to_i, 1, 1))
      else
        raise ArgumentError, "unknown period type: #{type.inspect}"
      end
    rescue Date::Error => e
      raise InvalidParam, e.message
    end
  end

  attr_reader :type, :starts_at

  def initialize(type:, starts_at:)
    @type = type.to_sym
    raise ArgumentError, "unknown period type: #{@type}" unless TYPES.include?(@type)
    @starts_at = normalize(starts_at)
  end

  def ends_at
    case type
    when :weekly  then starts_at + 7.days
    when :monthly then starts_at + 1.month
    when :yearly  then starts_at + 1.year
    end
  end

  def prev
    self.class.new(type: type, starts_at: step(-1))
  end

  def next
    self.class.new(type: type, starts_at: step(+1))
  end

  def complete?(now: Time.current)
    ends_at <= now
  end

  def contains?(time)
    t = time.in_time_zone(Time.zone)
    starts_at <= t && t < ends_at
  end

  def label
    case type
    when :weekly  then "#{starts_at.strftime('%B %-d')} — #{(ends_at - 1.day).strftime('%B %-d')}"
    when :monthly then starts_at.strftime("%B %Y")
    when :yearly  then starts_at.strftime("%Y")
    end
  end

  def subtitle
    case type
    when :weekly
      date = starts_at.to_date
      "Week #{date.cweek} · #{date.cwyear}"
    else
      nil
    end
  end

  def to_param
    case type
    when :weekly
      date = starts_at.to_date
      format("%d-W%02d", date.cwyear, date.cweek)
    when :monthly then starts_at.strftime("%Y-%m")
    when :yearly  then starts_at.strftime("%Y")
    end
  end

  def ==(other)
    other.is_a?(Period) && other.type == type && other.starts_at == starts_at
  end
  alias_method :eql?, :==

  def hash
    [type, starts_at].hash
  end

  private

  def step(direction)
    case type
    when :weekly  then starts_at + direction * 7.days
    when :monthly then direction.positive? ? starts_at.next_month : starts_at.prev_month
    when :yearly  then direction.positive? ? starts_at.next_year  : starts_at.prev_year
    end
  end

  def normalize(time)
    ts = time.in_time_zone(Time.zone)
    case type
    when :weekly  then ts.beginning_of_week
    when :monthly then ts.beginning_of_month
    when :yearly  then ts.beginning_of_year
    end
  end
end
